// ============================================================
// 안테나 고유 방사 패턴 분석/지도 표시
//   - 2D H/V 극좌표와 지면 절단 없는 3D 미리보기
//   - 수신 고도, Pathloss, 지면 반사, RSRP를 사용하지 않는다.
//   - 원본 패턴 카탈로그는 로컬 파일이며 Git에 업로드하지 않는다.
// ============================================================
var RADIATION_PATTERN = (function () {
    "use strict";

    var CATALOG_URL = "Data/sionna/antenna_pattern_catalog.json";
    var entities = [];
    var visible = false;
    var catalog = null;
    var catalogPromise = null;
    var previewYaw = 35;
    var previewPitch = -24;
    var dragState = null;

    function $(id) { return document.getElementById(id); }
    function getViewer() { return (window.ws3d && window.ws3d.viewer) ? window.ws3d.viewer : null; }
    function getTxRef() {
        var ref = (window.MAIN && MAIN.getTxRef) ? MAIN.getTxRef() : null;
        if (ref) return ref;
        var lon = parseFloat($("tx-lon") && $("tx-lon").value);
        var lat = parseFloat($("tx-lat") && $("tx-lat").value);
        var alt = parseFloat($("tx-alt") && $("tx-alt").value) || 0;
        return (isFinite(lon) && isFinite(lat)) ? { lon: lon, lat: lat, alt: alt } : null;
    }
    function getNumber(id, fallback) {
        var value = parseFloat($(id) && $(id).value);
        return isFinite(value) ? value : fallback;
    }
    function setStatus(message, isError) {
        var el = $("status");
        if (!el) return;
        el.textContent = message;
        el.className = isError ? "status error" : "status";
    }
    function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }

    function radiusFactor(gainDb, mode, floorDb) {
        var gain = clamp(Number(gainDb), floorDb, 0);
        if (mode === "power") return Math.pow(10, gain / 10);
        if (mode === "amplitude") return Math.pow(10, gain / 20);
        return 0.05 + 0.95 * (gain - floorDb) / (0 - floorDb);
    }

    function linearInterp(xs, ys, value) {
        if (!xs || !ys || xs.length < 2 || xs.length !== ys.length) return 0;
        var x = Number(value);
        if (x <= Number(xs[0])) return Number(ys[0]);
        if (x >= Number(xs[xs.length - 1])) return Number(ys[ys.length - 1]);
        var lo = 0, hi = xs.length - 1;
        while (hi - lo > 1) {
            var mid = Math.floor((lo + hi) / 2);
            if (Number(xs[mid]) <= x) lo = mid;
            else hi = mid;
        }
        var x0 = Number(xs[lo]), x1 = Number(xs[hi]);
        var ratio = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
        return Number(ys[lo]) * (1 - ratio) + Number(ys[hi]) * ratio;
    }

    function directionGain(pattern, azDeg, elDeg) {
        if (!pattern || pattern.key === "isotropic") return 0;
        var theta = clamp(90 - Number(elDeg), 0, 180);
        var az = ((Number(azDeg) + 180) % 360 + 360) % 360 - 180;
        return linearInterp(pattern.thetaDeg, pattern.vertical3dRelativeGainDb, theta) +
               linearInterp(pattern.phiDeg, pattern.horizontal3dRelativeGainDb, az);
    }

    function idealPattern() {
        var angles = [], zeros = [], theta = [], phi = [], i;
        for (i = 0; i <= 360; i++) { angles.push(i); zeros.push(0); }
        for (i = 0; i <= 180; i++) theta.push(i);
        for (i = -180; i <= 180; i++) phi.push(i);
        return {
            key: "isotropic", label: "이상적 등방성 기준", model: "Ideal isotropic reference",
            sourceSheet: "수식 기준", frequencyMHz: 955, maxGainDbi: 0,
            cutAngleDeg: angles, horizontalCutRelativeGainDb: zeros.slice(0),
            verticalCutRelativeGainDb: zeros.slice(0), thetaDeg: theta,
            vertical3dRelativeGainDb: theta.map(function () { return 0; }), phiDeg: phi,
            horizontal3dRelativeGainDb: phi.map(function () { return 0; })
        };
    }

    function idealOmniPattern() {
        var angles = [], hCut = [], vCut = [], theta = [], v3d = [], phi = [], h3d = [];
        var i, thetaValue, sineValue, gain;
        for (i = 0; i <= 360; i++) {
            angles.push(i);
            hCut.push(0);
            thetaValue = i <= 180 ? i : 360 - i;
            sineValue = Math.abs(Math.sin(thetaValue * Math.PI / 180));
            gain = sineValue < 0.000001 ? -120 : 20 * Math.log(sineValue) / Math.LN10;
            vCut.push(gain);
        }
        for (i = 0; i <= 180; i++) {
            theta.push(i);
            sineValue = Math.abs(Math.sin(i * Math.PI / 180));
            v3d.push(sineValue < 0.000001 ? -120 : 20 * Math.log(sineValue) / Math.LN10);
        }
        for (i = -180; i <= 180; i++) { phi.push(i); h3d.push(0); }
        return {
            key: "idealOmni", label: "이상적 옴니 기준 (도넛형)",
            model: "Ideal azimuth-omnidirectional reference", sourceSheet: "수식 기준",
            frequencyMHz: 955, maxGainDbi: 0, cutAngleDeg: angles,
            horizontalCutRelativeGainDb: hCut, verticalCutRelativeGainDb: vCut,
            thetaDeg: theta, vertical3dRelativeGainDb: v3d,
            phiDeg: phi, horizontal3dRelativeGainDb: h3d
        };
    }

    function currentFallbackPattern() {
        var angles = [], hCut = [], vCut = [], theta = [], v3d = [], phi = [], h3d = [];
        var i, angle, thetaValue;
        for (i = 0; i <= 360; i++) {
            angle = i === 360 ? 0 : i;
            angles.push(i);
            hCut.push(BEAMPATTERN.horizontalGainAtAzimuth(angle));
            thetaValue = i <= 180 ? i : 360 - i;
            vCut.push(BEAMPATTERN.gainAtElevation(90 - thetaValue));
        }
        for (i = 0; i <= 180; i++) { theta.push(i); v3d.push(BEAMPATTERN.gainAtElevation(90 - i)); }
        for (i = -180; i <= 180; i++) { phi.push(i); h3d.push(BEAMPATTERN.horizontalGainAtAzimuth(i)); }
        var meta = BEAMPATTERN.getPatternMeta ? BEAMPATTERN.getPatternMeta() : {};
        return {
            key: "combined", label: "현재 H/V 합성 패턴", model: meta.model || "현재 안테나 패턴",
            sourceSheet: meta.sourceSheet || "antenna_pattern.json", frequencyMHz: meta.frequencyMHz || 955,
            maxGainDbi: meta.maxGainDbi || 0, cutAngleDeg: angles,
            horizontalCutRelativeGainDb: hCut, verticalCutRelativeGainDb: vCut,
            thetaDeg: theta, vertical3dRelativeGainDb: v3d,
            phiDeg: phi, horizontal3dRelativeGainDb: h3d
        };
    }

    function normalizeCatalog(json) {
        var patterns = {}, source = json && json.patterns ? json.patterns : {}, key;
        for (key in source) {
            if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
            patterns[key] = source[key];
            patterns[key].key = key;
        }
        if (!patterns.combined) patterns.combined = currentFallbackPattern();
        patterns.idealOmni = idealOmniPattern();
        patterns.isotropic = idealPattern();
        return { meta: (json && json.meta) || {}, patterns: patterns };
    }

    function ensureCatalog(callback) {
        if (catalog) { callback(null, catalog); return; }
        if (!catalogPromise) {
            catalogPromise = fetch(CATALOG_URL, { cache: "no-store" })
                .then(function (response) {
                    if (!response.ok) throw new Error("HTTP " + response.status);
                    return response.json();
                })
                .then(function (json) { catalog = normalizeCatalog(json); return catalog; })
                .catch(function () {
                    catalog = normalizeCatalog({ patterns: { combined: currentFallbackPattern() } });
                    return catalog;
                });
        }
        catalogPromise.then(function (value) { callback(null, value); })
            .catch(function (error) { callback(error); });
    }

    function selectedPattern() {
        if (!catalog) return currentFallbackPattern();
        var select = $("radiation-pattern-source");
        var key = select ? select.value : "combined";
        return catalog.patterns[key] || catalog.patterns.combined || idealPattern();
    }
    function selectedMode() {
        var select = $("radiation-radius-mode");
        return select ? select.value : "db";
    }
    function modeLabel(mode) {
        if (mode === "power") return "전력 비례";
        if (mode === "amplitude") return "진폭 비례";
        return "dB 가시화";
    }
    function populatePatternSelect() {
        var select = $("radiation-pattern-source");
        if (!select || !catalog) return;
        var previous = select.value || "combined";
        var order = ["combined", "omni", "yagi", "idealOmni", "isotropic"];
        var targets = [select, $("pattern-analyzer-source")];
        for (var targetIndex = 0; targetIndex < targets.length; targetIndex++) {
            var target = targets[targetIndex];
            if (!target) continue;
            target.innerHTML = "";
            for (var i = 0; i < order.length; i++) {
                var pattern = catalog.patterns[order[i]];
                if (!pattern) continue;
                var option = document.createElement("option");
                option.value = order[i];
                option.textContent = pattern.label;
                target.appendChild(option);
            }
            target.value = catalog.patterns[previous] ? previous : "combined";
        }
    }
    function syncAnalyzerControls() {
        var source = $("radiation-pattern-source"), modalSource = $("pattern-analyzer-source");
        var mode = $("radiation-radius-mode"), modalMode = $("pattern-analyzer-mode");
        var floor = $("radiation-db-floor"), modalFloor = $("pattern-analyzer-floor");
        if (source && modalSource) modalSource.value = source.value;
        if (mode && modalMode) modalMode.value = mode.value;
        if (floor && modalFloor) {
            modalFloor.value = floor.value;
            var valueLabel = $("pattern-analyzer-floor-val");
            if (valueLabel) valueLabel.textContent = weakDetailLabel(Number(floor.value));
        }
    }

    function weakDetailLabel(floorDb) {
        if (floorDb <= -55) return "약한 부분까지 (" + floorDb + "dB)";
        if (floorDb >= -25) return "강한 부분만 (" + floorDb + "dB)";
        return "보통 (" + floorDb + "dB)";
    }

    function gainColor(gainDb, alpha) {
        var floor = getNumber("radiation-db-floor", -40);
        var t = clamp((Number(gainDb) - floor) / (0 - floor), 0, 1);
        var c = BEAMPATTERN.beamColor(t);
        return alpha === undefined ? "rgb(" + c.r + "," + c.g + "," + c.b + ")" :
            "rgba(" + c.r + "," + c.g + "," + c.b + "," + alpha + ")";
    }
    function localToCartesian(ref, e, n, u) {
        var point = BEAMPATTERN.enuToEcef(ref.lon, ref.lat, ref.alt || 0, e, n, u);
        return new Cesium.Cartesian3(point.x, point.y, point.z);
    }
    function addPolyline(viewer, positions, colorCss, alpha, width) {
        var color = Cesium.Color.fromCssColorString(colorCss) || Cesium.Color.WHITE;
        var entity = viewer.entities.add({ polyline: {
            positions: positions, width: width, material: color.withAlpha(alpha), clampToGround: false
        }});
        entities.push(entity);
    }
    function pointFor(ref, pattern, azDeg, elDeg, scale, tilt, swing, mode, floorDb) {
        var gain = directionGain(pattern, azDeg, elDeg);
        var radius = scale * radiusFactor(gain, mode, floorDb);
        var az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
        var rotated = BEAMPATTERN.rotateENU(
            radius * Math.cos(el) * Math.sin(az), radius * Math.cos(el) * Math.cos(az),
            radius * Math.sin(el), tilt, swing
        );
        return { gain: gain, position: localToCartesian(ref, rotated.e, rotated.n, rotated.u) };
    }

    function showLegend(pattern, mode) {
        var el = $("radiation-legend");
        if (!el) return;
        var bins = BEAMPATTERN.BEAM_BINS;
        var collapsed = el.getAttribute("data-collapsed") === "true";
        var html = (window.RF_COLOR ? RF_COLOR.legendHeader(pattern.label + " 상대이득 (dB)") :
            '<div class="legend-title">' + pattern.label + ' 상대이득 (dB)</div>') +
            '<div class="legend-panel-body"><div class="legend-source">' + modeLabel(mode) +
            ' · RSRP 아님 · 지면 절단 없음</div>';
        for (var i = 0; i < bins.length; i++) {
            var label = bins[i].lo === -Infinity ? '-30 dB 미만' : bins[i].lo + ' ~ ' + bins[i].hi + ' dB';
            html += '<div class="legend-row"><span class="legend-color" style="background:' +
                bins[i].color + '"></span><span class="legend-label">' + label + '</span></div>';
        }
        el.innerHTML = html + '</div>';
        el.style.display = "block";
        if (window.RF_COLOR) RF_COLOR.setLegendCollapsed(el, collapsed);
    }
    function hideLegend() { var el = $("radiation-legend"); if (el) el.style.display = "none"; }
    function clear() {
        var viewer = getViewer();
        if (viewer) for (var i = 0; i < entities.length; i++) {
            try { viewer.entities.remove(entities[i]); } catch (e) { /* 무시 */ }
        }
        entities = [];
        visible = false;
        var button = $("btn-radiation");
        if (button) button.classList.remove("active");
        hideLegend();
    }

    function render() {
        ensureCatalog(function () {
            clear();
            var viewer = getViewer(), ref = getTxRef();
            if (!viewer || !window.Cesium || !window.BEAMPATTERN || !ref) {
                setStatus("안테나 방사 패턴을 표시할 지도 또는 기지국 위치가 없습니다.", true);
                return;
            }
            var pattern = selectedPattern(), mode = selectedMode();
            var floorDb = getNumber("radiation-db-floor", -40);
            var scale = getNumber("radiation-scale", 300);
            var tilt = getNumber("radiation-tilt", 0), swing = getNumber("radiation-swing", 0);
            var az, el, p, positions;
            for (az = 0; az < 360; az += 15) {
                positions = [];
                for (el = -90; el <= 90; el += 5) {
                    positions.push(pointFor(ref, pattern, az, el, scale, tilt, swing, mode, floorDb).position);
                }
                addPolyline(viewer, positions, "#94a3b8", 0.55, 1.2);
            }
            for (el = -80; el <= 80; el += 10) {
                for (var segment = 0; segment < 12; segment++) {
                    positions = [];
                    var gainSum = 0, gainCount = 0;
                    for (var step = 0; step <= 6; step++) {
                        az = segment * 30 + step * 5;
                        p = pointFor(ref, pattern, az, el, scale, tilt, swing, mode, floorDb);
                        positions.push(p.position); gainSum += p.gain; gainCount++;
                    }
                    addPolyline(viewer, positions, gainColor(gainSum / gainCount), 0.92, el === 0 ? 2.8 : 1.5);
                }
            }
            positions = [];
            for (az = 0; az <= 360; az += 3) positions.push(pointFor(ref, pattern, az, 0, scale, tilt, swing, mode, floorDb).position);
            addPolyline(viewer, positions, "#0ea5e9", 1.0, 3.2);
            for (az = 0; az <= 180; az += 180) {
                positions = [];
                for (el = -90; el <= 90; el += 2) positions.push(pointFor(ref, pattern, az, el, scale, tilt, swing, mode, floorDb).position);
                addPolyline(viewer, positions, "#fb923c", 1.0, 3.0);
            }
            visible = true;
            var button = $("btn-radiation");
            if (button) button.classList.add("active");
            showLegend(pattern, mode);
            try {
                var marginDeg = Math.max(0.002, scale / 85000);
                viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(
                    ref.lon - marginDeg, ref.lat - marginDeg, ref.lon + marginDeg, ref.lat + marginDeg
                )});
            } catch (cameraError) { /* 패턴 표시는 유지 */ }
            setStatus(pattern.label + " 지도 3D 방사 패턴 · " + modeLabel(mode) + " · 피크 " +
                Number(pattern.maxGainDbi || 0).toFixed(1) +
                "dBi · Pathloss/RSRP/지면 절단 미사용 · 표시배율 " + scale + "m");
        });
    }

    function fitCanvas(canvas, minimumHeight) {
        var rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
        var minHeight = minimumHeight === undefined ? 320 : minimumHeight;
        var width = Math.max(320, Math.round(rect.width)), height = Math.max(minHeight, Math.round(rect.height));
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
            canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
        }
        var context = canvas.getContext("2d");
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        return { ctx: context, width: width, height: height };
    }
    function polarPoint(cx, cy, radius, angleDeg) {
        var angle = angleDeg * Math.PI / 180;
        return { x: cx + radius * Math.sin(angle), y: cy - radius * Math.cos(angle) };
    }
    function drawPolarCurve(ctx, pattern, values, color, cx, cy, radius, floorDb) {
        var angles = pattern.cutAngleDeg || [];
        ctx.beginPath();
        for (var i = 0; i < angles.length; i++) {
            var gain = clamp(Number(values[i]), floorDb, 0);
            var r = radius * (gain - floorDb) / (0 - floorDb);
            var point = polarPoint(cx, cy, r, Number(angles[i]));
            if (i === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
        }
        ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.stroke();
    }
    function drawPolar(pattern) {
        var canvas = $("pattern-polar-canvas");
        if (!canvas || !pattern) return;
        var fitted = fitCanvas(canvas), ctx = fitted.ctx, width = fitted.width, height = fitted.height;
        var cx = width / 2, cy = height / 2 + 8;
        var radius = Math.max(100, Math.min(width, height) * 0.39);
        var floorDb = getNumber("radiation-db-floor", -40), radialSteps = [], stepDb;
        for (stepDb = 0; stepDb >= floorDb; stepDb -= 10) radialSteps.push(stepDb);
        if (radialSteps[radialSteps.length - 1] !== floorDb) radialSteps.push(floorDb);
        ctx.font = "12px Malgun Gothic, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (var i = 0; i < radialSteps.length; i++) {
            var ringRadius = radius * (radialSteps[i] - floorDb) / (0 - floorDb);
            ctx.beginPath(); ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = i === 0 ? "#94a3b8" : "#d8dee8"; ctx.lineWidth = i === 0 ? 1.4 : 1; ctx.stroke();
            ctx.fillStyle = "#64748b"; ctx.fillText(radialSteps[i] + "", cx + 16, cy - ringRadius + 11);
        }
        for (var angle = 0; angle < 360; angle += 30) {
            var edge = polarPoint(cx, cy, radius, angle);
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(edge.x, edge.y);
            ctx.strokeStyle = angle % 90 === 0 ? "#94a3b8" : "#e2e8f0";
            ctx.lineWidth = angle % 90 === 0 ? 1.3 : 1; ctx.stroke();
            var labelPoint = polarPoint(cx, cy, radius + 20, angle);
            ctx.fillStyle = "#475569"; ctx.fillText(angle + "°", labelPoint.x, labelPoint.y);
        }
        drawPolarCurve(ctx, pattern, pattern.horizontalCutRelativeGainDb, "#087cc1", cx, cy, radius, floorDb);
        drawPolarCurve(ctx, pattern, pattern.verticalCutRelativeGainDb, "#fb923c", cx, cy, radius, floorDb);
        ctx.textAlign = "left"; ctx.fillStyle = "#0f172a"; ctx.font = "bold 14px Malgun Gothic, sans-serif";
        ctx.fillText(pattern.label + " · 상대이득", 14, 20);
        ctx.font = "13px Malgun Gothic, sans-serif"; ctx.fillStyle = "#087cc1"; ctx.fillText("━ 수평 H-Plane", 14, 44);
        ctx.fillStyle = "#fb923c"; ctx.fillText("━ 수직 V-Plane", 14, 65);
    }

    function horizontalCutStats(pattern) {
        var angles = pattern.cutAngleDeg || [], values = pattern.horizontalCutRelativeGainDb || [];
        var strongest = { angle: 0, gain: -Infinity }, weakest = { angle: 0, gain: Infinity };
        for (var i = 0; i < angles.length && i < values.length; i++) {
            var angle = Number(angles[i]), gain = Number(values[i]);
            if (!isFinite(angle) || !isFinite(gain) || angle >= 360) continue;
            if (gain > strongest.gain) strongest = { angle: angle, gain: gain };
            if (gain < weakest.gain) weakest = { angle: angle, gain: gain };
        }
        if (!isFinite(strongest.gain)) strongest = { angle: 0, gain: 0 };
        if (!isFinite(weakest.gain)) weakest = { angle: 0, gain: 0 };
        return { strongest: strongest, weakest: weakest, spread: strongest.gain - weakest.gain };
    }

    function drawFloorPolar(ctx, pattern, cx, cy, radius, floorDb, mode, color) {
        var angles = pattern.cutAngleDeg || [], values = pattern.horizontalCutRelativeGainDb || [];
        ctx.beginPath();
        for (var i = 0; i < angles.length && i < values.length; i++) {
            var r = radius * radiusFactor(Number(values[i]), mode, floorDb);
            var point = polarPoint(cx, cy, r, Number(angles[i]));
            if (i === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
        }
        ctx.closePath();
        ctx.fillStyle = color === "#2563eb" ? "rgba(37,99,235,0.16)" : "rgba(100,116,139,0.10)";
        ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = color === "#2563eb" ? 2.4 : 1.8; ctx.stroke();
    }

    function drawFloorComparison(pattern) {
        var panel = $("pattern-shape-explainer"), canvas = $("pattern-floor-canvas");
        if (!panel || panel.hidden || !canvas || !pattern) return;
        var fitted = fitCanvas(canvas, 200), ctx = fitted.ctx, width = fitted.width, height = fitted.height;
        var currentFloor = getNumber("radiation-db-floor", -40), mode = selectedMode();
        var floors = [-20, currentFloor, -60];
        var labels = ["강한 부분만", "현재 설정", "약한 부분까지"];
        var cellWidth = width / 3;
        for (var section = 0; section < 3; section++) {
            var cx = cellWidth * (section + 0.5), cy = height * 0.55;
            var radius = Math.min(cellWidth * 0.31, height * 0.31);
            if (section === 1) {
                ctx.fillStyle = "rgba(219,234,254,0.58)";
                ctx.fillRect(cellWidth, 0, cellWidth, height);
            }
            ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
            ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
            ctx.strokeStyle = "#e2e8f0"; ctx.stroke();
            drawFloorPolar(ctx, pattern, cx, cy, radius, floors[section], mode,
                section === 1 ? "#2563eb" : "#64748b");
            ctx.textAlign = "center"; ctx.fillStyle = section === 1 ? "#1d4ed8" : "#334155";
            ctx.font = "bold 13px Malgun Gothic, sans-serif";
            ctx.fillText((section === 1 ? "현재 " : "") + floors[section] + "dB", cx, 20);
            ctx.fillStyle = "#64748b"; ctx.font = "11px Malgun Gothic, sans-serif";
            ctx.fillText(labels[section], cx, height - 13);
        }
        ctx.textAlign = "left";
    }

    function evidenceCard(title, angle, gain, radiusPercent, color) {
        return '<div class="pattern-evidence-card"><strong>' + title + '</strong>' +
            Math.round(angle) + '° · ' + gain.toFixed(1) + 'dB' +
            '<div class="pattern-radius-meter"><span style="width:' +
            clamp(radiusPercent, 0, 100).toFixed(1) + '%;background:' + color + '"></span></div>' +
            '현재 화면 반경 ' + radiusPercent.toFixed(1) + '%</div>';
    }

    function updateFloorExplanation(pattern) {
        var panel = $("pattern-shape-explainer"), evidence = $("pattern-floor-evidence");
        if (!panel || panel.hidden || !evidence || !pattern) return;
        var floorDb = getNumber("radiation-db-floor", -40), mode = selectedMode();
        var stats = horizontalCutStats(pattern);
        var strongRadius = radiusFactor(stats.strongest.gain, mode, floorDb) * 100;
        var weakRadius = radiusFactor(stats.weakest.gain, mode, floorDb) * 100;
        var badge = $("pattern-floor-badge");
        if (badge) badge.textContent = weakDetailLabel(floorDb) + " · " + modeLabel(mode);
        evidence.innerHTML = evidenceCard("H-Plane 강한 방향", stats.strongest.angle,
                stats.strongest.gain, strongRadius, "#2563eb") +
            evidenceCard("H-Plane 약한 방향", stats.weakest.angle,
                stats.weakest.gain, weakRadius, "#f97316") +
            '<div class="pattern-evidence-card"><strong>해석 근거</strong>' +
            '실측 편차 ' + stats.spread.toFixed(1) + 'dB · 화면 반경 차이 ' +
            Math.abs(strongRadius - weakRadius).toFixed(1) + '%p<br>' +
            (mode === "db" ? 'dB 가시화: 반경 = 5% + 95% × (이득−바닥)/(0−바닥)' :
             mode === "amplitude" ? '진폭 비례: 반경 = 10^(이득/20)' :
             '전력 비례: 반경 = 10^(이득/10)') +
            '<br>이 설정은 원본 이득을 바꾸지 않고 화면에서 약한 로브를 어디까지 보일지만 정합니다.</div>';
        drawFloorComparison(pattern);
    }

    function toggleFloorExplanation() {
        var panel = $("pattern-shape-explainer"), button = $("btn-pattern-shape-analysis");
        if (!panel || !button) return;
        panel.hidden = !panel.hidden;
        button.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
        button.textContent = panel.hidden ? "형상 해석 보기" : "형상 해석 닫기";
        if (!panel.hidden) updateFloorExplanation(selectedPattern());
    }

    function projectPreview(point, width, height) {
        var yaw = previewYaw * Math.PI / 180, pitch = previewPitch * Math.PI / 180;
        var x1 = point.x * Math.cos(yaw) - point.y * Math.sin(yaw);
        var y1 = point.x * Math.sin(yaw) + point.y * Math.cos(yaw), z1 = point.z;
        var y2 = y1 * Math.cos(pitch) - z1 * Math.sin(pitch);
        var z2 = y1 * Math.sin(pitch) + z1 * Math.cos(pitch);
        var scale = Math.min(width, height) * 0.38;
        return { x: width / 2 + x1 * scale, y: height / 2 - z2 * scale, depth: y2 };
    }
    function previewPoint(pattern, azDeg, elDeg, mode, floorDb) {
        var gain = directionGain(pattern, azDeg, elDeg), radius = radiusFactor(gain, mode, floorDb);
        var az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
        return { x: radius * Math.cos(el) * Math.sin(az), y: radius * Math.cos(el) * Math.cos(az),
            z: radius * Math.sin(el), gain: gain };
    }
    function drawPreviewAxes(ctx, width, height) {
        var axes = [
            { p: { x: 1.2, y: 0, z: 0 }, color: "#0ea5e9", label: "E" },
            { p: { x: 0, y: 1.2, z: 0 }, color: "#22c55e", label: "N" },
            { p: { x: 0, y: 0, z: 1.2 }, color: "#ef4444", label: "UP" }
        ];
        var origin = projectPreview({ x: 0, y: 0, z: 0 }, width, height);
        for (var i = 0; i < axes.length; i++) {
            var end = projectPreview(axes[i].p, width, height);
            ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(end.x, end.y);
            ctx.strokeStyle = axes[i].color; ctx.lineWidth = 1.8; ctx.stroke();
            ctx.fillStyle = axes[i].color; ctx.font = "bold 12px Malgun Gothic, sans-serif";
            ctx.fillText(axes[i].label, end.x + 4, end.y - 3);
        }
    }
    function draw3dPreview(pattern) {
        var canvas = $("pattern-3d-canvas");
        if (!canvas || !pattern) return;
        var fitted = fitCanvas(canvas), ctx = fitted.ctx, width = fitted.width, height = fitted.height;
        var floorDb = getNumber("radiation-db-floor", -40), mode = selectedMode();
        var azs = [], els = [], points = [], faces = [], az, el, ia, ie;
        for (az = 0; az < 360; az += 10) azs.push(az);
        for (el = -90; el <= 90; el += 10) els.push(el);
        for (ia = 0; ia < azs.length; ia++) {
            points[ia] = [];
            for (ie = 0; ie < els.length; ie++) {
                var raw = previewPoint(pattern, azs[ia], els[ie], mode, floorDb);
                points[ia][ie] = { raw: raw, screen: projectPreview(raw, width, height) };
            }
        }
        for (ia = 0; ia < azs.length; ia++) {
            var next = (ia + 1) % azs.length;
            for (ie = 0; ie < els.length - 1; ie++) {
                var quad = [points[ia][ie], points[next][ie], points[next][ie + 1], points[ia][ie + 1]];
                faces.push({ points: quad,
                    depth: (quad[0].screen.depth + quad[1].screen.depth + quad[2].screen.depth + quad[3].screen.depth) / 4,
                    gain: (quad[0].raw.gain + quad[1].raw.gain + quad[2].raw.gain + quad[3].raw.gain) / 4 });
            }
        }
        faces.sort(function (a, b) { return a.depth - b.depth; });
        for (var i = 0; i < faces.length; i++) {
            var face = faces[i];
            ctx.beginPath(); ctx.moveTo(face.points[0].screen.x, face.points[0].screen.y);
            for (var q = 1; q < face.points.length; q++) ctx.lineTo(face.points[q].screen.x, face.points[q].screen.y);
            ctx.closePath(); ctx.fillStyle = gainColor(face.gain, 0.34); ctx.fill();
            ctx.strokeStyle = gainColor(face.gain, 0.28); ctx.lineWidth = 0.7; ctx.stroke();
        }
        drawPreviewAxes(ctx, width, height);
        ctx.fillStyle = "#0f172a"; ctx.font = "bold 14px Malgun Gothic, sans-serif";
        ctx.fillText("3D 상대 방사 패턴 · " + modeLabel(mode), 14, 20);
        ctx.fillStyle = "#64748b"; ctx.font = "12px Malgun Gothic, sans-serif";
        ctx.fillText("마우스로 드래그하여 회전", 14, 42);
    }

    function updateAnalyzerSummary(pattern) {
        var summary = $("pattern-analyzer-summary");
        if (!summary || !pattern) return;
        summary.innerHTML = "<strong>" + pattern.label + "</strong> · " + (pattern.frequencyMHz || 955) +
            "MHz · 피크 " + Number(pattern.maxGainDbi || 0).toFixed(2) + "dBi · " +
            weakDetailLabel(getNumber("radiation-db-floor", -40)) + "<br>" +
            "파란색=수평 H-Plane · 주황색=수직 V-Plane · 상대이득 전용(거리/RSRP 아님)";
    }
    function redrawAnalyzer() {
        var modal = $("pattern-analyzer-modal");
        if (!modal || modal.hidden) return;
        var pattern = selectedPattern();
        drawPolar(pattern); draw3dPreview(pattern); updateAnalyzerSummary(pattern);
        updateFloorExplanation(pattern);
    }
    function openAnalyzer() {
        ensureCatalog(function () {
            populatePatternSelect();
            syncAnalyzerControls();
            var modal = $("pattern-analyzer-modal");
            if (!modal) return;
            modal.hidden = false; document.body.classList.add("pattern-analyzer-open"); redrawAnalyzer();
        });
    }
    function closeAnalyzer() {
        var modal = $("pattern-analyzer-modal");
        if (modal) modal.hidden = true;
        document.body.classList.remove("pattern-analyzer-open");
    }
    function setPreviewView(view) {
        if (view === "top") { previewYaw = 0; previewPitch = -90; }
        else if (view === "side") { previewYaw = 90; previewPitch = 0; }
        else { previewYaw = 35; previewPitch = -24; }
        redrawAnalyzer();
    }
    function toggle() {
        if (visible) { clear(); setStatus("안테나 고유 방사 패턴 숨김"); }
        else render();
    }
    function refreshIfVisible() { redrawAnalyzer(); if (visible) render(); }
    function bindPreviewDrag(canvas) {
        if (!canvas) return;
        canvas.addEventListener("pointerdown", function (event) {
            dragState = { x: event.clientX, y: event.clientY, yaw: previewYaw, pitch: previewPitch };
            try { canvas.setPointerCapture(event.pointerId); } catch (e) { /* 무시 */ }
        });
        canvas.addEventListener("pointermove", function (event) {
            if (!dragState) return;
            previewYaw = dragState.yaw + (event.clientX - dragState.x) * 0.5;
            previewPitch = clamp(dragState.pitch + (event.clientY - dragState.y) * 0.35, -90, 90);
            redrawAnalyzer();
        });
        canvas.addEventListener("pointerup", function () { dragState = null; });
        canvas.addEventListener("pointercancel", function () { dragState = null; });
    }
    function init() {
        var button = $("btn-radiation"), analyzerButton = $("btn-radiation-analyzer");
        var explanationButton = $("btn-pattern-shape-analysis");
        var closeButton = $("btn-pattern-analyzer-close"), scale = $("radiation-scale");
        var tilt = $("radiation-tilt"), swing = $("radiation-swing");
        var source = $("radiation-pattern-source"), mode = $("radiation-radius-mode");
        var floor = $("radiation-db-floor");
        var modalSource = $("pattern-analyzer-source"), modalMode = $("pattern-analyzer-mode");
        var modalFloor = $("pattern-analyzer-floor");
        if (button) button.addEventListener("click", toggle);
        if (analyzerButton) analyzerButton.addEventListener("click", openAnalyzer);
        if (explanationButton) explanationButton.addEventListener("click", toggleFloorExplanation);
        if (closeButton) closeButton.addEventListener("click", closeAnalyzer);
        if (scale) scale.addEventListener("input", function () {
            var label = $("radiation-scale-val");
            if (label) label.textContent = scale.value + "m";
            if (visible) render();
        });
        if (tilt) tilt.addEventListener("change", function () { if (visible) render(); });
        if (swing) swing.addEventListener("change", function () { if (visible) render(); });
        if (source) source.addEventListener("change", refreshIfVisible);
        if (mode) mode.addEventListener("change", refreshIfVisible);
        if (floor) floor.addEventListener("input", function () {
            var label = $("radiation-db-floor-val");
            if (label) label.textContent = weakDetailLabel(Number(floor.value));
            refreshIfVisible();
        });
        if (modalSource) modalSource.addEventListener("change", function () {
            if (source) source.value = modalSource.value;
            refreshIfVisible();
        });
        if (modalMode) modalMode.addEventListener("change", function () {
            if (mode) mode.value = modalMode.value;
            refreshIfVisible();
        });
        if (modalFloor) modalFloor.addEventListener("input", function () {
            if (floor) floor.value = modalFloor.value;
            var sidebarLabel = $("radiation-db-floor-val");
            var modalLabel = $("pattern-analyzer-floor-val");
            if (sidebarLabel) sidebarLabel.textContent = weakDetailLabel(Number(modalFloor.value));
            if (modalLabel) modalLabel.textContent = weakDetailLabel(Number(modalFloor.value));
            refreshIfVisible();
        });
        var viewButtons = document.querySelectorAll("[data-pattern-view]");
        for (var i = 0; i < viewButtons.length; i++) viewButtons[i].addEventListener("click", function () {
            setPreviewView(this.getAttribute("data-pattern-view"));
        });
        var modal = $("pattern-analyzer-modal");
        if (modal) modal.addEventListener("click", function (event) { if (event.target === modal) closeAnalyzer(); });
        document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeAnalyzer(); });
        window.addEventListener("resize", redrawAnalyzer);
        bindPreviewDrag($("pattern-3d-canvas"));
        ensureCatalog(function () { populatePatternSelect(); });
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();
    }
    return { render: render, clear: clear, toggle: toggle, openAnalyzer: openAnalyzer,
        closeAnalyzer: closeAnalyzer, radiusFactor: radiusFactor,
        linearInterp: linearInterp, directionGain: directionGain,
        idealOmniPattern: idealOmniPattern };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RADIATION_PATTERN;
