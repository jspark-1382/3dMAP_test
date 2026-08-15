// ============================================================
// 메인: VWORLD WebGL 3D지도 API 3.0 (Cesium) + CSV 좌표 이동
// ------------------------------------------------------------
// 의존: config.js(globals) - head에서 먼저 로드된다.
// 라이브러리는 index.html에서 동기 포함된다.
// ============================================================
var MAIN = (function () {
    "use strict";

    var points = [];        // 파싱된 좌표 목록
    var currentIndex = -1;  // 선택된 좌표 인덱스
    var markerEntities = [];// Cesium 마커 엔티티 목록
    var ready = false;      // 지도 생성 완료 여부
    var map = null;         // vw.Map 인스턴스

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

    function addMarker(p) {
        var viewer = getViewer();
        if (!viewer || !window.Cesium) return;
        var ent = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.appliedAlt),
            point: { pixelSize: 10, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
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

    // ---- 목록 UI ----
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
            if (p.extra["Time"] !== undefined && p.extra["Time"] !== "") parts.push("시간 " + p.extra["Time"]);
            if (p.extra["[LTE][L1][RF]RSRP (dBm)(dBm)"] !== undefined) parts.push("RSRP " + p.extra["[LTE][L1][RF]RSRP (dBm)(dBm)"]);
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

    // ---- CSV 처리 ----
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
            for (var i = 0; i < points.length; i++) addMarker(points[i]);
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

    // ---- VWORLD WebGL 3D지도 API 3.0 ----
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

        setStatus("브이월드 3D 지도를 불러오는 중...");
    }

    document.addEventListener("DOMContentLoaded", function () {
        init();          // UI 이벤트 연결
        waitForLibrary();// 브이월드 라이브러리(vw) 준비 대기 후 지도 생성
    });

    return { flyTo: flyTo, moveTo: moveTo };
})();
