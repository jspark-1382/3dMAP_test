// ============================================================
// 메인: VWORLD WebGL 3D지도 API 3.0 (Cesium) + CSV 좌표 이동
//      + RSRP 범례(10단위) + 두 점 거리 측정
// ------------------------------------------------------------
// 의존: config.js(globals) - head에서 먼저 로드된다.
// 라이브러리는 index.html에서 동기 포함된다.
// ============================================================
var MAIN = (function () {
    "use strict";

    var points = [];        // 파싱된 좌표 목록
    var currentIndex = -1;  // 선택된 좌표 인덱스
    var markerEntities = [];// CSV 마커 엔티티
    var measureEntities = [];// 측정(점/선) 엔티티
    var ready = false;      // 지도 생성 완료 여부
    var map = null;         // vw.Map 인스턴스
    var measureMode = false;// 두 점 거리 측정 모드
    var measurePts = [];    // 측정 클릭 포인트(Cartesian3)
    var measureHandler = null;
    var rsrpBins = [];      // RSRP 범례 빈(10단위)

    function $(id) { return document.getElementById(id); }

    function setStatus(msg, isError) {
        var el = $("status");
        if (!el) return;
        el.textContent = msg;
        el.className = isError ? "status error" : "status";
    }

    function fmt(v, digits) {
        return v.toFixed(digits === undefined ? 7 : digits);
    }

    function getViewer() {
        return (window.ws3d && window.ws3d.viewer) ? window.ws3d.viewer : null;
    }

    function flyTo(lon, lat, alt, headingDeg, pitchDeg) {
        var viewer = getViewer();
        if (!viewer || !window.Cesium) return;
        var h = (headingDeg === undefined) ? 0 : headingDeg;
        var p = (pitchDeg === undefined) ? -90 : pitchDeg;
        try {
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
                orientation: {
                    heading: Cesium.Math.toRadians(h),
                    pitch: Cesium.Math.toRadians(p),
                    roll: 0.0
                }
            });
        } catch (e) {
            try {
                viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt) });
            } catch (e2) {
                setStatus("카메라 이동 오류: " + e2.message, true);
            }
        }
    }

    function moveTo(index) {
        if (index < 0 || index >= points.length) return;
        if (!ready || !getViewer()) { setStatus("지도 준비 중...", true); return; }
        var p = points[index];
        currentIndex = index;
        flyTo(p.lon, p.lat, p.appliedAlt, 0, -90);
        updateListSelection();
        setStatus("이동: #" + (index + 1) + " (경도 " + fmt(p.lon) + ", 위도 " + fmt(p.lat) + ", 고도 " + fmt(p.appliedAlt, 2) + " m)");
    }

    // ================== RSRP 색상 / 범례(10단위) ==================
    function rsrpColorT(t) {
        var hue = Math.max(0, Math.min(120, t * 120)); // 0(빨강, 나쁨) ~ 120(초록, 좋음)
        return "hsl(" + hue + ", 78%, 50%)";
    }

    function computeRsrpBins(pts) {
        var minV = null, maxV = null;
        for (var i = 0; i < pts.length; i++) {
            var r = Number(pts[i].rsrp);
            if (isNaN(r)) continue;
            if (minV === null || r < minV) minV = r;
            if (maxV === null || r > maxV) maxV = r;
        }
        if (minV === null) return [];
        var start = Math.floor(minV / 10) * 10;
        var end = Math.floor(maxV / 10) * 10;
        var bins = [];
        for (var b = start; b <= end; b += 10) {
            var t = (end === start) ? 1 : (b - start) / (end - start);
            bins.push({ lo: b, hi: b + 10, color: rsrpColorT(t) });
        }
        return bins;
    }

    function colorForRsrp(v) {
        if (v === null || v === undefined || isNaN(Number(v))) return "#9ca3af";
        // 빈은 10dB 연속 구간 → 선형탐색 대신 인덱스 직접 계산
        if (rsrpBins.length) {
            var b = Math.floor(Number(v) / 10) * 10;
            var idx = (b - rsrpBins[0].lo) / 10;
            var i = Math.round(idx);
            if (i >= 0 && i < rsrpBins.length && rsrpBins[i].lo === b) return rsrpBins[i].color;
        }
        return "#9ca3af";
    }

    function renderLegend() {
        var el = $("legend");
        if (!el) return;
        el.innerHTML = "";
        if (!rsrpBins.length) { el.style.display = "none"; return; }
        el.style.display = "block";
        var title = document.createElement("div");
        title.className = "legend-title";
        title.textContent = "RSRP 범례 (dBm · 10단위)";
        el.appendChild(title);
        for (var i = rsrpBins.length - 1; i >= 0; i--) {
            var bin = rsrpBins[i];
            var row = document.createElement("div");
            row.className = "legend-row";
            var sw = document.createElement("span");
            sw.className = "legend-color";
            sw.style.background = bin.color;
            var lb = document.createElement("span");
            lb.className = "legend-label";
            lb.textContent = bin.lo + " 이상 ~ " + bin.hi + " 미만";
            row.appendChild(sw);
            row.appendChild(lb);
            el.appendChild(row);
        }
    }

    // ================== 마커 ==================
    function addMarker(p) {
        var viewer = getViewer();
        if (!viewer || !window.Cesium) return;
        var col = Cesium.Color.fromCssColorString(colorForRsrp(p.rsrp));
        var ent = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.appliedAlt),
            point: { pixelSize: 12, color: col, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
            label: {
                text: "P" + p.idx, font: "12px sans-serif",
                pixelOffset: new Cesium.Cartesian2(0, -14),
                style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM
            }
        });
        markerEntities.push(ent);
    }

    function clearMarkers() {
        var viewer = getViewer();
        if (viewer) {
            for (var i = 0; i < markerEntities.length; i++) viewer.entities.remove(markerEntities[i]);
        }
        markerEntities = [];
    }

    // ================== 목록 UI ==================
    function renderList() {
        var box = $("point-list");
        box.innerHTML = "";
        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            var item = document.createElement("div");
            item.className = "point-item";
            item.dataset.index = i;

            var head = document.createElement("div");
            head.className = "point-head";
            head.textContent = "#" + (i + 1) + "  (" + fmt(p.lat, 6) + ", " + fmt(p.lon, 6) + ")";
            item.appendChild(head);

            var sub = document.createElement("div");
            sub.className = "point-sub";
            var parts = [];
            parts.push("고도 " + fmt(p.alt, 2) + " -> " + fmt(p.appliedAlt, 2) + " m");
            if (!isNaN(Number(p.rsrp)) ) parts.push("RSRP " + Number(p.rsrp).toFixed(1));
            if (p.extra["Time"] !== undefined && p.extra["Time"] !== "") parts.push("시간 " + p.extra["Time"]);
            sub.textContent = parts.join("  ·  ");
            item.appendChild(sub);

            item.addEventListener("click", function (e) {
                var idx = parseInt(e.currentTarget.dataset.index, 10);
                moveTo(idx);
            });
            box.appendChild(item);
        }
    }

    function updateListSelection() {
        var items = document.querySelectorAll("#point-list .point-item");
        for (var i = 0; i < items.length; i++) {
            items[i].className = (i === currentIndex) ? "point-item active" : "point-item";
        }
    }

    function updateMeta() {
        $("meta-count").textContent = "포인트 수: " + points.length;
        var base = (points.length > 0) ? fmt(points[0].alt, 2) : "-";
        $("meta-base").textContent = "첫 행 고도(보정 기준): " + base + " m (첫 행을 0점 기준으로 보정)";
    }

    // ================== CSV 처리 ==================
    function loadCsvFile(file) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var text = e.target.result;
            var result = CSV.parse(text, "normalizeBase"); // 첫 행 고도값을 빼 0점 기준 보정
            points = result.points;

            if (result.errors.length > 0 && points.length === 0) {
                setStatus("CSV 오류: " + result.errors.join(" / "), true);
                return;
            }

            clearMarkers();
            clearPrediction();
            clearTxMarker();
            clearBeam();
            rsrpBins = computeRsrpBins(points);
            for (var i = 0; i < points.length; i++) addMarker(points[i]);
            renderLegend();
            renderList();
            updateMeta();
            currentIndex = -1;

            if (points.length > 0) {
                setStatus("로드 완료: " + points.length + "개 좌표. 첫 좌표로 이동합니다.");
                moveTo(0);
            } else {
                setStatus("해당 CSV에서 좌표를 찾지 못했습니다.", true);
            }
        };
        reader.onerror = function () { setStatus("파일을 읽지 못했습니다.", true); };
        reader.readAsText(file, "utf-8");
    }

    // ================== 두 점 거리 측정 ==================
    function initMeasureHandler() {
        var viewer = getViewer();
        if (!viewer || !window.Cesium || measureHandler) return;
        measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        measureHandler.setInputAction(function (movement) {
            if (!measureMode) return;
            var scene = viewer.scene;
            var cartesian = scene.pickPosition(movement.position);
            if (!Cesium.defined(cartesian) || (cartesian.x === 0 && cartesian.y === 0 && cartesian.z === 0)) {
                cartesian = viewer.camera.pickEllipsoid(movement.position);
            }
            if (!Cesium.defined(cartesian)) {
                setStatus("지점 선택 실패: 지형/건물 위를 클릭하세요.", true);
                return;
            }
            measurePts.push(cartesian);
            var pEnt = viewer.entities.add({
                position: cartesian,
                point: { pixelSize: 8, color: Cesium.Color.BLUE, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
                label: { text: "M" + measurePts.length, font: "12px sans-serif", pixelOffset: new Cesium.Cartesian2(0, -12), style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2 }
            });
            measureEntities.push(pEnt);
            if (measurePts.length === 1) {
                setStatus("1번 점 선택. 두 번째 점을 클릭하세요.");
            } else if (measurePts.length === 2) {
                var lineEnt = viewer.entities.add({
                    polyline: { positions: [measurePts[0], measurePts[1]], width: 3, material: Cesium.Color.BLUE }
                });
                measureEntities.push(lineEnt);
                var d = measureDistance(measurePts[0], measurePts[1]);
                showMeasureResult(d);
                measurePts = [];
                setStatus("측정 완료: " + fmtDist(d) + " · 새 측정은 다시 클릭");
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    function toggleMeasure() {
        var viewer = getViewer();
        if (!viewer || !window.Cesium) return;
        measureMode = !measureMode;
        var btn = $("btn-measure");
        if (measureMode) {
            if (btn) btn.classList.add("active");
            clearMeasureLine();
            initMeasureHandler();
            setStatus("측정 모드 ON - 첫 번째 점을 클릭하세요.");
        } else {
            if (btn) btn.classList.remove("active");
            setStatus("측정 모드 OFF");
        }
    }

    function measureDistance(c1, c2) {
        var ellipsoid = Cesium.Ellipsoid.WGS84;
        var g1 = Cesium.Cartographic.fromCartesian(c1, ellipsoid);
        var g2 = Cesium.Cartographic.fromCartesian(c2, ellipsoid);
        var geod = new Cesium.EllipsoidGeodesic(g1, g2, ellipsoid);
        return { surface: geod.surfaceDistance, straight: Cesium.Cartesian3.distance(c1, c2) };
    }

    function fmtDist(d) {
        if (!d || isNaN(d.surface)) return "";
        var m = d.surface;
        if (m >= 1000) return (m / 1000).toFixed(3) + " km (" + m.toFixed(1) + " m)";
        return m.toFixed(1) + " m";
    }

    function showMeasureResult(d) {
        var el = $("measure-result");
        if (el) {
            el.textContent = "측정 거리: " + fmtDist(d);
            el.style.display = "block";
        }
    }

    function clearMeasureLine() {
        var viewer = getViewer();
        if (viewer) {
            for (var i = 0; i < measureEntities.length; i++) viewer.entities.remove(measureEntities[i]);
        }
        measureEntities = [];
        measurePts = [];
        var el = $("measure-result");
        if (el) { el.textContent = ""; el.style.display = "none"; }
    }

    // ================== VWORLD WebGL 3D지도 API 3.0 ==================
    function initMap() {
        try {
            var opts = {
                mapId: "map",
                initPosition: new vw.CameraPosition(
                    new vw.CoordZ(DEFAULT_VIEW.longitude, DEFAULT_VIEW.latitude, DEFAULT_VIEW.altitude),
                    new vw.Direction(0, -90, 0)
                ),
                logo: false,
                navigation: false
            };
            map = new vw.Map();
            map.setOption(opts);
            map.start();
            ready = true;
            setTimeout(function () {
                setStatus("3D 지도가 준비되었습니다. CSV를 업로드하세요.");
            }, 500);
        } catch (e) {
            setStatus("지도 생성 오류: " + e.message, true);
        }
    }

    // 라이브러리는 index.html에서 동기 포함됨. vw가 정의될 때까지 대기 후 지도 생성
    function waitForLibrary() {
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            if (window.vw && window.vw.Map) {
                clearInterval(timer);
                initMap();
                return;
            }
            if (tries > 60) {
                clearInterval(timer);
                setStatus("브이월드 3D 라이브러리를 초기화하지 못했습니다. 3D지도 키와 허용 도메인을 확인하세요.", true);
            }
        }, 250);
    }

    // ================== UI 바인딩 ==================
    function init() {
        var fi = $("file-input");
        if (fi) {
            fi.addEventListener("change", function (e) {
                if (e.target.files && e.target.files.length > 0) loadCsvFile(e.target.files[0]);
            });
        }

        var dropZone = $("map");
        ["dragenter", "dragover"].forEach(function (ev) {
            dropZone.addEventListener(ev, function (e) { e.preventDefault(); });
        });
        dropZone.addEventListener("drop", function (e) {
            e.preventDefault();
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                loadCsvFile(e.dataTransfer.files[0]);
            }
        });

        $("btn-first").addEventListener("click", function () { if (points.length) moveTo(0); });
        $("btn-prev").addEventListener("click", function () {
            if (!points.length) return;
            var i = (currentIndex <= 0) ? points.length - 1 : currentIndex - 1;
            moveTo(i);
        });
        $("btn-next").addEventListener("click", function () {
            if (!points.length) return;
            var i = (currentIndex >= points.length - 1) ? 0 : currentIndex + 1;
            moveTo(i);
        });
        $("btn-last").addEventListener("click", function () { if (points.length) moveTo(points.length - 1); });
        $("btn-home").addEventListener("click", function () {
            if (!ready) return;
            flyTo(DEFAULT_VIEW.longitude, DEFAULT_VIEW.latitude, DEFAULT_VIEW.altitude, 0, -90);
            currentIndex = -1;
            updateListSelection();
            setStatus("초기 보기로 이동했습니다.");
        });

        $("btn-measure").addEventListener("click", toggleMeasure);
        $("btn-clear-measure").addEventListener("click", function () {
            clearMeasureLine();
            setStatus("측정 초기화");
        });

        $("btn-tx-apply").addEventListener("click", function () { setTxFromInput(); updateTxMarker(); });
        $("btn-predict").addEventListener("click", drawPredictions);
        var predHide = $("btn-predict-hide");
        if (predHide) predHide.addEventListener("click", hidePrediction);

        var beamBtn = $("btn-beam");
        if (beamBtn) beamBtn.addEventListener("click", toggleBeam);
        var beamScale = $("beam-scale");
        if (beamScale) {
            beamScale.addEventListener("input", function () {
                var v = parseInt(beamScale.value, 10);
                var label = $("beam-scale-val");
                if (label) label.textContent = v + "m";
                if (beamVisible) { clearBeam(); renderBeam(); }
            });
        }
        ["beam-tilt", "beam-swing"].forEach(function (id) {
            var inp = $(id);
            if (inp) {
                inp.addEventListener("change", function () {
                    if (beamVisible) { clearBeam(); renderBeam(); }
                    if (predictionVisible && points.length) refreshPrediction();
                });
            }
        });
        var calibChk = $("chk-beam-calib");
        if (calibChk) {
            calibChk.addEventListener("change", function () {
                if (predictionVisible && points.length) refreshPrediction();
            });
        }
        // ---- Sionna RT 예측 기반 빔패턴 체크박스 / 고도 선택 ----
        var sionnaChk = $("chk-beam-sionna");
        if (sionnaChk) {
            sionnaChk.addEventListener("change", function () {
                var row = $("beam-sionna-alt-row");
                if (row) row.style.display = sionnaChk.checked ? "flex" : "none";
                if (!sionnaChk.checked) {
                    if (beamVisible) { clearBeam(); renderBeam(); }   // 측정 패턴으로 복귀
                    return;
                }
                if (window.SIONNA && !SIONNA.hasData()) {
                    setStatus("Sionna RT 예측 결과를 로드하는 중...");
                    ensureBeamSionnaData(function (err, d) {
                        if (err || !d) {
                            setStatus("Sionna 결과 로드 실패: " + (err && err.message ? err.message : "데이터 없음"), true);
                            return;
                        }
                        populateBeamSionnaAlts(d);
                        if (beamVisible) { clearBeam(); renderBeam(); }
                    });
                } else if (window.SIONNA && SIONNA.hasData()) {
                    SIONNA.ensureData(function (_e, d2) { populateBeamSionnaAlts(d2); });
                    if (beamVisible) { clearBeam(); renderBeam(); }
                }
            });
        }
        var beamSionnaAlt = $("beam-sionna-alt");
        if (beamSionnaAlt) {
            beamSionnaAlt.addEventListener("change", function () {
                if (beamVisible) { clearBeam(); renderBeam(); }
            });
        }
        var predAlt = $("pred-alt");
        if (predAlt) {
            predAlt.addEventListener("change", function () {
                if (predictionVisible && points.length) refreshPrediction();
            });
        }
        var altCompareBtn = $("btn-alt-compare");


        prefillDefaultBs();   // 기본 기지국(config.js의 DEFAULT_BS) 입력란 자동 채움        if (altCompareBtn) altCompareBtn.addEventListener("click", compareAltitudes);

        setStatus("브이월드 3D 지도를 불러오는 중...");
    }

    document.addEventListener("DOMContentLoaded", function () {
        init();          // UI 이벤트 연결
        waitForLibrary();// 브이월드 라이브러리(vw) 준비 대기 후 지도 생성
    });

    // ================== 기지국 / 예측 구간 ==================
    var txRef = null;        // { lon, lat, alt, rsrpRef } 사용자 입력 기지국
    var predictionEntities = [];
    var predictionPrimitive = null;
    var predictionVisible = false;
    var txEntity = null;

// 기본 기지국 좌표를 입력란에 미리 채워 표시 (매번 입력하지 않도록)
function prefillDefaultBs() {
    if (typeof DEFAULT_BS === "undefined" || !DEFAULT_BS) return;
    var lon = Number(DEFAULT_BS.longitude), lat = Number(DEFAULT_BS.latitude);
    if (isNaN(lon) || isNaN(lat)) return;
    var alt = (typeof DEFAULT_BS.altitude === "number" && !isNaN(DEFAULT_BS.altitude))
              ? DEFAULT_BS.altitude : 0;
    var lonInp = $("tx-lon"), latInp = $("tx-lat"), altInp = $("tx-alt");
    if (lonInp && !lonInp.value) lonInp.value = String(lon);
    if (latInp && !latInp.value) latInp.value = String(lat);
    if (altInp && !altInp.value) altInp.value = String(alt);
}

    function setTxFromInput() {
        var lon = parseFloat($("tx-lon").value);
        var lat = parseFloat($("tx-lat").value);
        if (isNaN(lon) || isNaN(lat)) { setStatus("기지국 좌표를 올바르게 입력하세요.", true); return; }
        var alt = parseFloat($("tx-alt").value) || 0;
        txRef = { lon: lon, lat: lat, alt: alt };
        setStatus("기지국 설정: (" + fmt(lon) + ", " + fmt(lat) + ")");
    }

    function getTxRef() {
    if (txRef) return txRef;
    if (!points.length) return null;
        var best = points[0], maxR = -999;
        for (var i = 0; i < points.length; i++) {
            var r = Number(points[i].rsrp);
            if (!isNaN(r) && r > maxR) { maxR = r; best = points[i]; }
        }
        if (maxR === -999) return null;
        return { lon: best.lon, lat: best.lat, alt: best.appliedAlt };
    }

    function useGainCalib() {
        var chk = $("chk-beam-calib");
        return !!(chk && chk.checked && window.BEAMPATTERN);
    }

    // 측정점 i에서의 안테나 이득(dB): TX 기준 고도각/방위각 → 틸트/스윙 반영 패턴 조회
    function gainAtPoint(ref, pt) {
        if (!window.BEAMPATTERN) return 0;
        var d = distanceM(ref.lon, ref.lat, pt.lon, pt.lat);
        var dh = Math.max(d, 1);              // 수평거리
        var dz = (pt.appliedAlt || 0) - (ref.alt || 0);
        var el = Math.atan2(dz, dh) * 180 / Math.PI;
        var az = BEAMPATTERN.bearingDeg(ref.lon, ref.lat, pt.lon, pt.lat);
        return BEAMPATTERN.tiltedGain(el, az, getBeamTilt(), getBeamSwing());
    }

    function calibrateModel(ref, pts) {
        // OLS linear regression: RSRP = RSRP_0 - n * 10 * log10(d) (+ k * G(el))
        var x1s = [], gs = [], ys = [];
        for (var i = 0; i < pts.length; i++) {
            var r = Number(pts[i].rsrp);
            if (isNaN(r)) continue;
            var d = distanceM(ref.lon, ref.lat, pts[i].lon, pts[i].lat);
            if (d < 1) continue;
            x1s.push(Math.log10(d));
            ys.push(r);
            gs.push(useGainCalib() ? gainAtPoint(ref, pts[i]) : 0);
        }
        var rsrp0 = -70, n = 3.5;
        var hasGain = false, k = 0;
        for (i = 0; i < gs.length; i++) { if (gs[i] !== 0) { hasGain = true; break; } }
        var sol = null;
        if (hasGain) {
            // y = c0 + c1*x + c2*g  →  n = -c1/10, gainCoef = c2
            sol = BEAMPATTERN.solveOLS3(x1s, gs, ys);
        }
        // 절편 재계산 헬퍼: n 고정 시 rsrp0 = mean(y + 10n·x)
        function refitIntercept(nFixed) {
            var s = 0;
            for (var j = 0; j < x1s.length; j++) s += ys[j] + 10 * nFixed * x1s[j];
            return x1s.length ? s / x1s.length : -70;
        }
        // 절편 재계산(이득 고정 k): rsrp0 = mean((y − k·g) + 10n·x)
        function refitInterceptGain(nFixed, kFixed) {
            var s = 0;
            for (var j = 0; j < x1s.length; j++) s += ys[j] - kFixed * gs[j] + 10 * nFixed * x1s[j];
            return x1s.length ? s / x1s.length : -70;
        }
        if (!sol) {
            // 기존 2변수 피팅(이득 미사용 or 특이)
            var sol2 = BEAMPATTERN ? BEAMPATTERN.solveOLS2(x1s, ys) : null;
            if (sol2) {
                n = -sol2.c1 / 10;
                rsrp0 = sol2.c0;
                if (n < 1 || n > 6) { n = Math.max(1, Math.min(6, n)); rsrp0 = refitIntercept(n); }
            } else {
                // 최후 폴백: 기존 수식
                var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, count = 0;
                for (i = 0; i < x1s.length; i++) {
                    sumX += x1s[i]; sumY += ys[i];
                    sumXY += x1s[i] * ys[i]; sumXX += x1s[i] * x1s[i];
                    count++;
                }
                if (count > 1) {
                    var denom = count * sumXX - sumX * sumX;
                    if (Math.abs(denom) > 1e-10) {
                        n = (count * sumXY - sumX * sumY) / denom / -10;
                        if (n < 1 || n > 6) n = Math.max(1, Math.min(6, n));
                        rsrp0 = refitIntercept(n);
                    }
                }
            }
        } else {
            n = -sol.c1 / 10;
            rsrp0 = sol.c0;
            k = sol.c2;
            // 물리적 타당성 검사: n∈[1,6], k∈[-0.5,2] 벗어나면
            // (거리항-이득항 공선형 등 불안정 피팅) → 패턴 신뢰(k=1 고정) 후 2변수 재피팅
            var stable = (n >= 1 && n <= 6 && k >= -0.5 && k <= 2);
            if (!stable) {
                k = 1;
                var yFix = [];
                for (i = 0; i < x1s.length; i++) yFix.push(ys[i] - gs[i]);
                var solF = BEAMPATTERN.solveOLS2(x1s, yFix);
                if (solF) {
                    n = -solF.c1 / 10;
                    rsrp0 = solF.c0;
                    if (n < 1 || n > 6) {
                        n = Math.max(1, Math.min(6, n));
                        rsrp0 = refitInterceptGain(n, k);
                    }
                } else {
                    n = Math.max(1, Math.min(6, n));
                    rsrp0 = refitInterceptGain(n, k);
                }
            }
        }
        return { ref: ref, rsrp0: rsrp0, n: n, useGain: !!(hasGain && sol), gainCoef: k };
    }

    function distanceM(lon1, lat1, lon2, lat2) {
        var R = 6371000;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function generatePredictionGrid(ref, pts) {
        var maxDist = 25;
        for (var i = 0; i < pts.length; i++) {
            var d = distanceM(ref.lon, ref.lat, pts[i].lon, pts[i].lat);
            if (d > maxDist) maxDist = d;
        }
        var radius = maxDist * 1.5;
        var spacing = parseFloat($("pred-spacing").value) || 50;
        var avgLat = ref.lat;
        var degLat = spacing / 111320;
        var degLon = spacing / (111320 * Math.cos(avgLat * Math.PI / 180));
        var spanDeg = radius / 111320;
        var cLat = Math.cos(avgLat * Math.PI / 180);
        var fromLat = ref.lat - spanDeg;
        var toLat = ref.lat + spanDeg;
        var fromLon = ref.lon - spanDeg / (cLat || 1);
        var toLon = ref.lon + spanDeg / (cLat || 1);
        var grid = [];
        for (var lat = fromLat; lat <= toLat; lat += degLat) {
            for (var lon = fromLon; lon <= toLon; lon += degLon) {
                var dd = distanceM(ref.lon, ref.lat, lon, lat);
                if (dd > radius) continue;
                grid.push({ lon: lon, lat: lat, d: dd });
            }
        }
        return grid;
    }

    function renderPrediction(calib, grid, hTerm) {
        clearPrediction();
        var viewer = getViewer();
        if (!viewer || !window.Cesium) return;
        hTerm = (hTerm === undefined || hTerm === null) ? 0 : hTerm;
        // 측정 경로 폴리라인
        if (points.length > 1) {
            var pathPositions = [];
            for (var i = 0; i < points.length; i++) {
                pathPositions.push(Cesium.Cartesian3.fromDegrees(points[i].lon, points[i].lat, points[i].appliedAlt));
            }
            var pathEnt = viewer.entities.add({
                polyline: { positions: pathPositions, width: 2, material: Cesium.Color.GRAY.withAlpha(0.7) }
            });
            predictionEntities.push(pathEnt);
        }
        // 예측 점들 (틸트/스윙은 렌더당 1회만 읽음, 방위각은 점당 1회 사전 계산)
        var tilt = getBeamTilt(), swing = getBeamSwing();
        var useG = calib.useGain && calib.gainCoef && window.BEAMPATTERN;
        if (useG) {
            for (var jp = 0; jp < grid.length; jp++) {
                grid[jp].az = BEAMPATTERN.bearingDeg(calib.ref.lon, calib.ref.lat, grid[jp].lon, grid[jp].lat);
            }
        }
        var collection = new Cesium.PointPrimitiveCollection();
        for (var j = 0; j < grid.length; j++) {
            var g = grid[j];
            var predictedRSRP = predictedAt(calib, g, hTerm, tilt, swing, useG);
            var colorStr = colorForRsrp(predictedRSRP);
            var col = Cesium.Color.fromCssColorString(colorStr);
            collection.add({
                position: Cesium.Cartesian3.fromDegrees(g.lon, g.lat, hTerm),
                color: col,
                pixelSize: 6,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.05),
                outlineWidth: 1
            });
        }
        viewer.scene.primitives.add(collection);
        predictionEntities.push(collection);
        predictionPrimitive = collection;
        predictionVisible = true;
        var btn = $("btn-predict");
        if (btn) btn.classList.add("active");
        var refStr = " RSRP_0=" + calib.rsrp0.toFixed(1) + " dBm  n=" + calib.n.toFixed(2);
        if (calib.useGain) refStr += "  이득보정 k=" + calib.gainCoef.toFixed(2);
        refStr += "  · 단말 고도 " + hTerm + "m 커버리지";
        setStatus("예측 완료: 격자 " + grid.length + "점, n=" + calib.n.toFixed(2) + refStr);
    }

    // 단말(수신) 고도 시나리오 (m) — 커버리지 평면 높이
    function getTerminalAlt() {
        var sel = $("pred-alt");
        if (!sel) return 0;
        var v = parseFloat(sel.value);
        return isNaN(v) ? 0 : v;
    }

    function clearPrediction() {
        var viewer = getViewer();
        if (predictionPrimitive && viewer) {
            try { viewer.scene.primitives.remove(predictionPrimitive); } catch (e) {}
        }
        for (var i = 0; i < predictionEntities.length; i++) {
            if (viewer && predictionEntities[i]) {
                try { viewer.entities.remove(predictionEntities[i]); } catch (e) {}
            }
        }
        predictionEntities = [];
        predictionPrimitive = null;
        predictionVisible = false;
        var btn = $("btn-predict");
        if (btn) btn.classList.remove("active");
    }

    function clearTxMarker() {
        var viewer = getViewer();
        if (txEntity && viewer) { try { viewer.entities.remove(txEntity); } catch(e) {} }
        txEntity = null;
    }

    function updateTxMarker() {
        clearTxMarker();
        var viewer = getViewer();
        if (!viewer || !window.Cesium) return;
        var ref = getTxRef();
        if (!ref) return;
        txEntity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(ref.lon, ref.lat, (ref.alt || 0) + 30),
            point: { pixelSize: 16, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
            label: { text: "TX", font: "14px sans-serif bold", pixelOffset: new Cesium.Cartesian2(0, -20), style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, verticalOrigin: Cesium.VerticalOrigin.BOTTOM }
        });
    }

    // ================== 안테나 빔패턴 (900MHz 옴니) ==================
    var beamEntities = [];      // 와이어프레임 폴리라인 엔티티
    var beamPrimitive = null;   // 표면 프리미티브(지원 시)
    var beamVisible = false;
    var beamSurfaceUnsupported = false;
    var _beamTilt = 0, _beamSwing = 0;   // 렌더당 1회 읽어 캐시 (정점 루프의 DOM 접근 제거)

    function getBeamScale() {
        var v = parseInt($("beam-scale").value, 10);
        return isNaN(v) ? 500 : v;
    }

    function getBeamTilt() {
        var v = parseFloat($("beam-tilt").value);
        return isNaN(v) ? 0 : v;
    }

    function getBeamSwing() {
        var v = parseFloat($("beam-swing").value);
        return isNaN(v) ? 0 : v;
    }

    // ---- Sionna RT 예측 기반 패턴 모드 ----
    function isBeamSionnaChecked() {
        var c = $("chk-beam-sionna");
        return !!(c && c.checked);
    }

    function ensureBeamSionnaData(cb) {
        if (!window.SIONNA || !SIONNA.ensureData) {
            cb(new Error("sionna.js 모듈을 찾을 수 없습니다."), null);
            return;
        }
        SIONNA.ensureData(cb);
    }

    function populateBeamSionnaAlts(d) {
        var sel = $("beam-sionna-alt");
        if (!sel || !d || !d.meta) return;
        sel.innerHTML = "";
        var optAll = document.createElement("option");
        optAll.value = "all";
        optAll.textContent = "전체 고도 통합";
        sel.appendChild(optAll);
        var alts = d.meta.altitudesM || [];
        for (var i = 0; i < alts.length; i++) {
            var o = document.createElement("option");
            o.value = String(alts[i]);
            o.textContent = alts[i] + "m";
            sel.appendChild(o);
        }
    }

    function localToCartesian(e, n, u) {
        // 로컬 ENU(m) → 절대 ECEF (txRefForBeam 기준, 캐시된 틸트/스윙으로 회전)
        var rp = BEAMPATTERN.rotateENU(e, n, u, _beamTilt, _beamSwing);
        var p = BEAMPATTERN.enuToEcef(txRefForBeam.lon, txRefForBeam.lat, txRefForBeam.alt || 0, rp.e, rp.n, rp.u);
        return new Cesium.Cartesian3(p.x, p.y, p.z);
    }

    var txRefForBeam = null;

    function addBeamPolyline(positions, colorCss, alpha, width) {
        var viewer = getViewer();
        var ent = viewer.entities.add({
            polyline: {
                positions: positions,
                width: width,
                material: Cesium.Color.fromCssColorString(colorCss).withAlpha(alpha),
                clampToGround: false
            }
        });
        beamEntities.push(ent);
    }

    function renderBeam() {
        clearBeam();
        var viewer = getViewer();
        if (!viewer || !window.Cesium || !window.BEAMPATTERN) return;
        var ref = getTxRef();
        if (!ref) { setStatus("기준점이 없습니다. CSV 업로드 또는 기지국 좌표를 입력하세요.", true); return; }
        txRefForBeam = ref;
        var scale = getBeamScale();
        _beamTilt = getBeamTilt();
        _beamSwing = getBeamSwing();
        updateTxMarker();

        // ---- 이득 소스 선택: Sionna RT 예측 기반 또는 측정 옴니 패턴 ----
        var sionnaPat = null, gainFn = null, azDependent = false;
        if (isBeamSionnaChecked() && window.SIONNA && SIONNA.hasData()) {
            var selAlt = $("beam-sionna-alt");
            sionnaPat = SIONNA.getPattern(selAlt ? selAlt.value : "all");
            if (sionnaPat) {
                gainFn = SIONNA.makeGainFn(sionnaPat);
                azDependent = true;
                _beamTilt = 0;   // RT 예측은 세계좌표 기준 → 틸트/스윙 중복 적용 방지
                _beamSwing = 0;
            }
        }
        if (!gainFn) {
            gainFn = function (_az, el) { return BEAMPATTERN.gainAtElevation(el); };
        }

        // 방위각/고도각별 반경 계산 헬퍼 (진폭 비례)
        function rAt(azDeg, elDeg) {
            var g = gainFn(azDeg, elDeg);
            return { g: g, r: scale * Math.pow(10, g / 20) };
        }

        // ---- 고도각 테이블 (자오선 공용) ----
        var elTable = [];   // i: el = -90 + 5i → {sinE, cosE}
        for (var i5 = 0; i5 <= 36; i5++) {
            var erad = (-90 + i5 * 5) * Math.PI / 180;
            elTable.push({ sinE: Math.sin(erad), cosE: Math.cos(erad) });
        }
        // 방위각 원 테이블 (링 공용, 5° 스텝 73개)
        var azTable = [];
        for (var a5 = 0; a5 <= 72; a5++) {
            var aRad = a5 * 5 * Math.PI / 180;
            azTable.push({ c: Math.cos(aRad), s: Math.sin(aRad) });
        }

        // ---- 와이어프레임: 자오선(el 스캔) + 링(az 원) ----
        for (var azm = 0; azm < 24; azm++) {
            var meridAz = azm * 15;
            var arad = meridAz * Math.PI / 180;
            var cAz = Math.cos(arad), sAz = Math.sin(arad);
            var positions = [];
            for (var ie = 0; ie <= 36; ie++) {
                var t5 = rAt(meridAz, -90 + ie * 5);
                positions.push(localToCartesian(
                    t5.r * elTable[ie].cosE * cAz,
                    t5.r * elTable[ie].cosE * sAz,
                    t5.r * elTable[ie].sinE));
            }
            addBeamPolyline(positions, "#94a3b8", 0.6, 1.5);
        }
        for (var ir = 2; ir <= 34; ir += 2) {   // el = -80..80 step 10
            var elV = -90 + ir * 5;
            var eIdx = ir;
            if (azDependent) {
                // RT 예측(방위 의존): 링을 30° 세그먼트로 나눠 각각 이득에 맞는 색 적용
                for (var seg = 0; seg < 12; seg++) {
                    var aStart = seg * 6;   // 시작 스텝(1스텝=5°): 세그먼트 30° = 6스텝
                    var ringPts = [];
                    for (var s2 = 0; s2 <= 6; s2++) {
                        var aIdx = aStart + s2;      // azTable 인덱스 (최대 72)
                        var tS = rAt(aIdx * 5, elV);
                        ringPts.push(localToCartesian(
                            tS.r * elTable[eIdx].cosE * azTable[aIdx].c,
                            tS.r * elTable[eIdx].cosE * azTable[aIdx].s,
                            tS.r * elTable[eIdx].sinE));
                    }
                    var midG = rAt(aStart * 5 + 15, elV).g;   // 세그먼트 중앙 방위
                    var cMid = BEAMPATTERN.jetColor(BEAMPATTERN.gainToT(midG));
                    addBeamPolyline(ringPts,
                        "rgb(" + cMid.r + "," + cMid.g + "," + cMid.b + ")", 0.85, 1.5);
                }
            } else {
                // 측정 옴니(방위 무관): 기존 방식 — 링 전체 단일 색
                var tR = rAt(0, elV);
                var ringPts2 = [];
                for (var ia = 0; ia <= 72; ia++) {
                    ringPts2.push(localToCartesian(
                        tR.r * elTable[eIdx].cosE * azTable[ia].c,
                        tR.r * elTable[eIdx].cosE * azTable[ia].s,
                        tR.r * elTable[eIdx].sinE));
                }
                var tRing = BEAMPATTERN.gainToT(tR.g);
                var cRing = BEAMPATTERN.jetColor(tRing);
                addBeamPolyline(ringPts2, "rgb(" + cRing.r + "," + cRing.g + "," + cRing.b + ")", 0.85, 1.5);
            }
        }
        // 수직 축선 (패턴 중심축 표시)
        addBeamPolyline([
            localToCartesian(0, 0, 0),
            localToCartesian(0, 0, scale * 1.1)
        ], "#ffffff", 0.7, 1);

        // ---- 반투명 표면 (엔진이 커스텀 Primitive 미지원 시 생략) ----
        if (!beamSurfaceUnsupported) {
            try {
                var mesh = azDependent
                    ? BEAMPATTERN.buildPatternMeshFromGain(gainFn, scale, 15, 5)
                    : BEAMPATTERN.buildPatternMesh(scale, 15, 5);
                var flats = [];
                var cartesians = [];
                for (var i = 0; i < mesh.positions.length; i++) {
                    var lp = mesh.positions[i];
                    var cp = localToCartesian(lp.e, lp.n, lp.u);
                    cartesians.push(cp);
                    flats.push(cp.x, cp.y, cp.z);
                }
                var indices = [];
                for (i = 0; i < mesh.indices.length; i++) indices.push(mesh.indices[i]);
                var geometry = new Cesium.Geometry({
                    attributes: {
                        position: new Cesium.GeometryAttribute({
                            componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                            componentsPerAttribute: 3,
                            values: flats
                        })
                    },
                    indices: indices,
                    primitiveType: Cesium.PrimitiveType.TRIANGLES,
                    boundingSphere: Cesium.BoundingSphere.fromPoints(cartesians)
                });
                var prim = new Cesium.Primitive({
                    geometryInstances: new Cesium.GeometryInstance({
                        geometry: geometry,
                        attributes: {
                            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                                Cesium.Color.CYAN.withAlpha(0.12))
                        }
                    }),
                    appearance: new Cesium.PerInstanceColorAppearance({
                        flat: true,
                        translucent: true
                    }),
                    asynchronous: false
                });
                viewer.scene.primitives.add(prim);
                beamPrimitive = prim;
            } catch (e) {
                beamSurfaceUnsupported = true;
            }
        }

        beamVisible = true;
        var btn = $("btn-beam");
        if (btn) btn.classList.add("active");
        var msg;
        if (sionnaPat) {
            msg = "빔패턴 표시 [Sionna RT 예측 기반]: 크기 " + scale + "m · 고도 " +
                  sionnaPat.altitudes.join("/") + "m (" + sionnaPat.sampleCount +
                  "점 · 예측범위 " + sionnaPat.sourceMinDbm + "~" + sionnaPat.sourceMaxDbm + "dBm)";
        } else {
            msg = "빔패턴 표시: 크기 " + scale + "m · 900MHz 옴니 (수평 최대 0dB, 천정/저중 −30dB)";
            var tilt = getBeamTilt(), swing = getBeamSwing();
            if (tilt) msg += " · 틸트 " + tilt + "°";
            if (tilt || swing) msg += " · 스윙 " + swing + "°";
        }
        if (isBeamSionnaChecked() && window.SIONNA && SIONNA.hasData() && !sionnaPat) {
            msg += " · Sionna 패턴 추출 실패(측정 패턴으로 표시)";
        }
        if (beamSurfaceUnsupported) msg += " · 표면 렌더링 미지원(와이어프레임만)";
        setStatus(msg);
    }

    function clearBeam() {
        var viewer = getViewer();
        if (beamPrimitive && viewer) {
            try { viewer.scene.primitives.remove(beamPrimitive); } catch (e) {}
        }
        if (viewer) {
            for (var i = 0; i < beamEntities.length; i++) {
                try { viewer.entities.remove(beamEntities[i]); } catch (e) {}
            }
        }
        beamEntities = [];
        beamPrimitive = null;
        beamVisible = false;
        txRefForBeam = null;
        var btn = $("btn-beam");
        if (btn) btn.classList.remove("active");
    }

    function toggleBeam() {
        if (!ready || !getViewer()) { setStatus("지도 준비 중...", true); return; }
        if (!window.BEAMPATTERN) { setStatus("빔패턴 모듈(beampattern.js)을 찾을 수 없습니다.", true); return; }
        if (beamVisible) {
            clearBeam();
            setStatus("빔패턴 숨김");
            return;
        }
        // Sionna 예측 기반 모드인데 결과 미로드 시: 먼저 로드 후 렌더
        if (isBeamSionnaChecked() && window.SIONNA && !SIONNA.hasData()) {
            setStatus("Sionna RT 예측 결과를 로드하는 중...");
            ensureBeamSionnaData(function (err, d) {
                if (err || !d) {
                    setStatus("Sionna 결과 로드 실패: " + (err && err.message ? err.message : "데이터 없음") +
                              " — 측정 패턴으로 표시하려면 체크를 해제하세요.", true);
                    return;
                }
                populateBeamSionnaAlts(d);
                if (!beamVisible) renderBeam();
            });
            return;
        }
        renderBeam();
    }

    function refreshPrediction() {
        var ref = getTxRef();
        if (!ref) { setStatus("기준점을 찾을 수 없습니다.", true); return; }
        updateTxMarker();
        var calib = calibrateModel(ref, points);
        var grid = generatePredictionGrid(calib.ref, points);
        if (!grid.length) { setStatus("예측 그리드가 비었습니다.", true); return; }
        renderPrediction(calib, grid, getTerminalAlt());
    }

    // 그리기 버튼: 항상 (다시) 그림 — 토글 아님. 숨김은 별도 버튼
    function drawPredictions() {
        if (!points.length) { setStatus("먼저 CSV를 업로드하세요.", true); return; }
        if (!ready || !getViewer()) { setStatus("지도 준비 중...", true); return; }
        refreshPrediction();
    }

    function hidePrediction() {
        if (!predictionVisible) { setStatus("숨길 예측 구간이 없습니다."); return; }
        clearPrediction();
        setStatus("예측 구간 숨김");
    }

    // ================== 고도별 예측 비교 (100/200/300m) ==================
    var ALT_COMPARE_LIST = [100, 200, 300];
    var ALT_COVERAGE_THRESHOLD = -100; // dBm

    // 격자점 1점의 예측 RSRP (tilt/swing/useG는 호출자가 캐시해 전달 — 루프 내 DOM 읽기 방지)
    // hTerm: 단말(수신) 고도(m) — 고도각 = atan2(hTerm − 기지국고도, 수평거리)
    function predictedAt(calib, g, hTerm, tilt, swing, useG) {
        var r = calib.rsrp0 - 10 * calib.n * Math.log10(g.d > 1 ? g.d : 1);
        if (useG) {
            var elDeg = Math.atan2(hTerm - (calib.ref.alt || 0), Math.max(g.d, 1)) * 180 / Math.PI;
            r += calib.gainCoef * BEAMPATTERN.tiltedGain(elDeg, g.az, tilt, swing);
        }
        return r;
    }

    function compareAltitudes() {
        if (!points.length) { setStatus("먼저 CSV를 업로드하세요.", true); return; }
        if (!window.BEAMPATTERN) { setStatus("빔패턴 모듈을 찾을 수 없습니다.", true); return; }
        var ref = getTxRef();
        if (!ref) { setStatus("기준점을 찾을 수 없습니다.", true); return; }
        var calib = calibrateModel(ref, points);
        var grid = generatePredictionGrid(calib.ref, points);
        if (!grid.length) { setStatus("예측 그리드가 비었습니다.", true); return; }

        // 격자점별 불변값(방위각)은 1회만 계산 — 고도와 무관
        var tilt = getBeamTilt(), swing = getBeamSwing();
        var useG = calib.useGain && calib.gainCoef && window.BEAMPATTERN;
        if (useG) {
            for (var j = 0; j < grid.length; j++) {
                grid[j].az = BEAMPATTERN.bearingDeg(ref.lon, ref.lat, grid[j].lon, grid[j].lat);
            }
        }

        var box = $("alt-compare-result");
        if (!box) return;

        var html = '<table class="alt-table"><tr>' +
            '<th>단말 고도</th><th>평균 RSRP</th><th>최소</th><th>≥' + ALT_COVERAGE_THRESHOLD + 'dBm</th>' +
            '</tr>';
        for (var i = 0; i < ALT_COMPARE_LIST.length; i++) {
            var alt = ALT_COMPARE_LIST[i];
            var sum = 0, count = 0, good = 0, minV = Infinity;
            for (j = 0; j < grid.length; j++) {
                var pr = predictedAt(calib, grid[j], alt, tilt, swing, useG);
                sum += pr; count++;
                if (pr >= ALT_COVERAGE_THRESHOLD) good++;
                if (pr < minV) minV = pr;
            }
            var mean = sum / count;
            var cov = Math.round(good / count * 1000) / 10;
            html += '<tr>' +
                '<td>' + alt + 'm</td>' +
                '<td><span class="alt-chip" style="background:' + colorForRsrp(mean) + '"></span>' +
                    mean.toFixed(1) + ' dBm</td>' +
                '<td>' + minV.toFixed(1) + '</td>' +
                '<td>' + cov + '%</td>' +
                '</tr>';
        }
        html += '</table>';
        html += '<div class="alt-note">격자 ' + grid.length + '점 · 이득보정 ' +
            (calib.useGain ? "ON (k=" + calib.gainCoef.toFixed(2) + ")" : "OFF") +
            ' · 틸트 ' + tilt + '°/스윙 ' + swing + '°</div>';
        box.innerHTML = html;
        setStatus("단말 고도별 커버리지 비교 완료: " + ALT_COMPARE_LIST.join("/") + "m");
    }
    return { flyTo: flyTo, moveTo: moveTo };
})();








