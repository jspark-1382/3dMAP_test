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
        var b = Math.floor(Number(v) / 10) * 10;
        for (var i = 0; i < rsrpBins.length; i++) {
            if (rsrpBins[i].lo === b) return rsrpBins[i].color;
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
                logo: true,
                navigation: true
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

        setStatus("브이월드 3D 지도를 불러오는 중...");
    }

    document.addEventListener("DOMContentLoaded", function () {
        init();          // UI 이벤트 연결
        waitForLibrary();// 브이월드 라이브러리(vw) 준비 대기 후 지도 생성
    });

    return { flyTo: flyTo, moveTo: moveTo };
})();
