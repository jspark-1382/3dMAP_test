// ============================================================
// Sionna RSRP 임계값 기반 3D 수신 가능 볼륨
//   - 기존 Sionna 고도면/빔 렌더러와 별도 Primitive를 사용한다.
//   - 실제 계산 고도면은 색상점과 경계로, 고도 사이는 세로 연결로 표시한다.
// ============================================================
var SIONNA_VOLUME = (function () {
    "use strict";

    var SOURCE = {
        reflected: {
            url: "Data/sionna/sionna_coverage.json",
            label: "평탄 지면 RT"
        },
        freeSpace: {
            url: "Data/sionna/sionna_free_space.json",
            label: "Sionna 직접파"
        }
    };
    var cache = {};
    var primitives = [];
    var entities = [];
    var visible = false;

    function $(id) { return document.getElementById(id); }

    function getViewer() {
        return (window.ws3d && window.ws3d.viewer) ? window.ws3d.viewer : null;
    }

    function setStatus(message, isError) {
        var el = $("status");
        if (!el) return;
        el.textContent = message;
        el.className = isError ? "status error" : "status";
    }

    function sourceInfo(key) {
        return SOURCE[key] || SOURCE.reflected;
    }

    function fetchData(key) {
        var info = sourceInfo(key);
        if (cache[key]) return Promise.resolve(cache[key]);
        return fetch(info.url).then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        }).then(function (json) {
            cache[key] = json;
            return json;
        });
    }

    function colorForDbm(dbm, alpha) {
        var rgb = (window.RF_COLOR && RF_COLOR.rgb01) ? RF_COLOR.rgb01(dbm) : [0.1, 0.7, 1.0];
        return new Cesium.Color(rgb[0], rgb[1], rgb[2], alpha);
    }

    function removeAll() {
        var viewer = getViewer();
        if (viewer) {
            for (var i = 0; i < primitives.length; i++) {
                try { viewer.scene.primitives.remove(primitives[i]); } catch (e) { /* 무시 */ }
            }
            for (var j = 0; j < entities.length; j++) {
                try { viewer.entities.remove(entities[j]); } catch (e2) { /* 무시 */ }
            }
        }
        primitives = [];
        entities = [];
        visible = false;
        var button = $("btn-coverage-volume");
        if (button) button.classList.remove("active");
        var summary = $("coverage-volume-summary");
        if (summary) summary.style.display = "none";
    }

    function resolveTerrainBase(viewer, data, callback) {
        var bs = data && data.meta && data.meta.bs;
        if (!bs || !Cesium.sampleTerrainMostDetailed || !viewer.terrainProvider) {
            callback(0);
            return;
        }
        var cartographic = Cesium.Cartographic.fromDegrees(bs.lon, bs.lat);
        Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cartographic]).then(function (result) {
            var height = result && result[0] ? Number(result[0].height) : 0;
            callback(isFinite(height) ? height : 0);
        }).catch(function () { callback(0); });
    }

    function gridSizeFor(points) {
        var size = Math.round(Math.sqrt(points.length));
        return size * size === points.length ? size : 0;
    }

    function addContourSegments(lines, points, values, size, threshold, height) {
        function crossing(a, b) {
            var va = values[a], vb = values[b];
            if ((va >= threshold) === (vb >= threshold) || va === vb) return null;
            var t = (threshold - va) / (vb - va);
            return Cesium.Cartesian3.fromDegrees(
                points[a][1] + (points[b][1] - points[a][1]) * t,
                points[a][0] + (points[b][0] - points[a][0]) * t,
                height
            );
        }

        var material = Cesium.Material.fromType("Color", {
            color: Cesium.Color.WHITE.withAlpha(0.92)
        });
        for (var row = 0; row < size - 1; row++) {
            for (var col = 0; col < size - 1; col++) {
                var tl = row * size + col;
                var tr = tl + 1;
                var bl = tl + size;
                var br = bl + 1;
                var crossings = [];
                var p;
                p = crossing(tl, tr); if (p) crossings.push(p);
                p = crossing(tr, br); if (p) crossings.push(p);
                p = crossing(br, bl); if (p) crossings.push(p);
                p = crossing(bl, tl); if (p) crossings.push(p);
                if (crossings.length === 2) {
                    lines.add({ positions: crossings, width: 2.2, material: material });
                } else if (crossings.length === 4) {
                    lines.add({ positions: [crossings[0], crossings[1]], width: 2.2, material: material });
                    lines.add({ positions: [crossings[2], crossings[3]], width: 2.2, material: material });
                }
            }
        }
    }

    function touchesBoundary(values, size, threshold) {
        if (!size) return false;
        for (var i = 0; i < size; i++) {
            if (values[i] >= threshold ||
                    values[(size - 1) * size + i] >= threshold ||
                    values[i * size] >= threshold ||
                    values[i * size + size - 1] >= threshold) return true;
        }
        return false;
    }

    function addVerticalRuns(lines, grids, altitudes, size, threshold, baseHeight, step) {
        var material = Cesium.Material.fromType("Color", {
            color: Cesium.Color.CYAN.withAlpha(0.34)
        });
        for (var row = 0; row < size; row += step) {
            for (var col = 0; col < size; col += step) {
                var index = row * size + col;
                var run = [];
                for (var a = 0; a < altitudes.length; a++) {
                    var grid = grids[String(altitudes[a])];
                    var point = grid && grid.points[index];
                    if (point && Number(point[2]) >= threshold) {
                        run.push(Cesium.Cartesian3.fromDegrees(point[1], point[0], baseHeight + Number(altitudes[a])));
                    } else {
                        if (run.length > 1) lines.add({ positions: run, width: 1.2, material: material });
                        run = [];
                    }
                }
                if (run.length > 1) lines.add({ positions: run, width: 1.2, material: material });
            }
        }
    }

    function showSummary(data, sourceKey, threshold, qualified, total, clipped) {
        var box = $("coverage-volume-summary");
        if (!box) return;
        var pct = total ? qualified / total * 100 : 0;
        box.className = "coverage-volume-summary" + (clipped ? " warning" : "");
        box.style.display = "block";
        box.innerHTML = "<strong>" + sourceInfo(sourceKey).label + " · RSRP ≥ " + threshold +
            "dBm</strong><br>계산 고도 " + (data.meta.altitudesM || []).join("/") +
            "m · 조건 충족 " + qualified.toLocaleString() + "/" + total.toLocaleString() +
            "셀 (" + pct.toFixed(1) + "%)" +
            (clipped ? "<br><strong>⚠ 계산 격자 경계까지 도달:</strong> 실제 커버리지 끝이 아니라 3km 시뮬레이션 영역에서 잘린 결과입니다." : "");
    }

    function flyToVolume(viewer, firstPoints, maxHeight) {
        if (!firstPoints || !firstPoints.length) return;
        var lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
        for (var i = 0; i < firstPoints.length; i++) {
            latMin = Math.min(latMin, firstPoints[i][0]);
            latMax = Math.max(latMax, firstPoints[i][0]);
            lonMin = Math.min(lonMin, firstPoints[i][1]);
            lonMax = Math.max(lonMax, firstPoints[i][1]);
        }
        try {
            var corners = [
                Cesium.Cartesian3.fromDegrees(lonMin, latMin, 0),
                Cesium.Cartesian3.fromDegrees(lonMax, latMin, 0),
                Cesium.Cartesian3.fromDegrees(lonMin, latMax, 0),
                Cesium.Cartesian3.fromDegrees(lonMax, latMax, 0),
                Cesium.Cartesian3.fromDegrees(lonMin, latMin, maxHeight),
                Cesium.Cartesian3.fromDegrees(lonMax, latMin, maxHeight),
                Cesium.Cartesian3.fromDegrees(lonMin, latMax, maxHeight),
                Cesium.Cartesian3.fromDegrees(lonMax, latMax, maxHeight)
            ];
            viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(corners), {
                offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-32), 0),
                duration: 1.3
            });
        } catch (e) { /* 카메라 이동 실패는 표시 결과에 영향 없음 */ }
    }

    function renderVolume(data, sourceKey, threshold, baseHeight) {
        removeAll();
        var viewer = getViewer();
        var altitudes = data.meta.altitudesM || [];
        if (!viewer || !window.Cesium || !altitudes.length) {
            setStatus("3D 커버리지 볼륨을 표시할 지도 또는 고도 데이터가 없습니다.", true);
            return;
        }

        var firstGrid = data.grids[String(altitudes[0])];
        var firstPoints = firstGrid && firstGrid.points;
        var size = firstPoints ? gridSizeFor(firstPoints) : 0;
        if (!size) {
            setStatus("Sionna 격자가 정사각 배열이 아니어서 3D 볼륨을 만들 수 없습니다.", true);
            return;
        }

        var pointCloud = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
        var lines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
        var labels = viewer.scene.primitives.add(new Cesium.LabelCollection());
        primitives.push(pointCloud, lines, labels);

        var displayStep = Math.max(1, Math.ceil(size / 75));
        var qualified = 0;
        var total = 0;
        var clipped = false;

        for (var a = 0; a < altitudes.length; a++) {
            var altitude = Number(altitudes[a]);
            var grid = data.grids[String(altitudes[a])];
            var points = grid && grid.points;
            if (!points || points.length !== size * size) continue;
            var values = new Array(points.length);
            for (var v = 0; v < points.length; v++) {
                values[v] = Number(points[v][2]);
                total++;
                if (values[v] >= threshold) qualified++;
            }
            clipped = clipped || touchesBoundary(values, size, threshold);

            for (var row = 0; row < size; row += displayStep) {
                for (var col = 0; col < size; col += displayStep) {
                    var index = row * size + col;
                    if (values[index] < threshold) continue;
                    pointCloud.add({
                        position: Cesium.Cartesian3.fromDegrees(points[index][1], points[index][0], baseHeight + altitude),
                        color: colorForDbm(values[index], 0.52),
                        pixelSize: 4.5,
                        outlineColor: Cesium.Color.BLACK.withAlpha(0.18),
                        outlineWidth: 0.5
                    });
                }
            }

            addContourSegments(lines, points, values, size, threshold, baseHeight + altitude);
            labels.add({
                position: Cesium.Cartesian3.fromDegrees(points[0][1], points[0][0], baseHeight + altitude),
                text: altitude + "m",
                font: "13px Malgun Gothic",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(6, -6)
            });
        }

        addVerticalRuns(lines, data.grids, altitudes, size, threshold, baseHeight, Math.max(4, displayStep * 3));

        var bs = data.meta.bs;
        if (bs) {
            entities.push(viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(bs.lon, bs.lat, baseHeight + Number(data.meta.antennaHeightM || 0)),
                point: {
                    pixelSize: 13,
                    color: Cesium.Color.YELLOW,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3
                },
                label: {
                    text: "TX",
                    font: "bold 13px Malgun Gothic",
                    fillColor: Cesium.Color.YELLOW,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -22)
                }
            }));
        }

        visible = true;
        $("btn-coverage-volume").classList.add("active");
        showSummary(data, sourceKey, threshold, qualified, total, clipped);
        flyToVolume(viewer, firstPoints, baseHeight + Number(altitudes[altitudes.length - 1]));
        setStatus(
            "Sionna 3D 수신 가능 볼륨 표시: " + sourceInfo(sourceKey).label +
            " · RSRP ≥ " + threshold + "dBm · 계산 고도 " + altitudes.join("/") + "m" +
            (clipped ? " · 격자 경계에서 잘림" : "")
        );
    }

    function show() {
        var viewer = getViewer();
        var sourceSelect = $("coverage-volume-source");
        var sourceKey = sourceSelect && SOURCE[sourceSelect.value] ? sourceSelect.value : "reflected";
        var threshold = Number($("coverage-volume-threshold").value);
        if (!viewer || !window.Cesium) {
            setStatus("지도가 준비된 뒤 3D 커버리지 볼륨을 표시하세요.", true);
            return;
        }
        if (!isFinite(threshold)) threshold = -100;
        setStatus(sourceInfo(sourceKey).label + " 3D 수신 가능 볼륨을 불러오는 중...");
        fetchData(sourceKey).then(function (data) {
            resolveTerrainBase(viewer, data, function (baseHeight) {
                renderVolume(data, sourceKey, threshold, baseHeight);
            });
        }).catch(function (error) {
            setStatus("3D 커버리지 볼륨 로드 실패: " + error.message, true);
        });
    }

    function hide() {
        removeAll();
        setStatus("Sionna 3D 수신 가능 볼륨 숨김");
    }

    function init() {
        var showButton = $("btn-coverage-volume");
        var hideButton = $("btn-coverage-volume-hide");
        if (showButton) showButton.addEventListener("click", show);
        if (hideButton) hideButton.addEventListener("click", hide);
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();
    }

    return {
        show: show,
        hide: hide,
        clear: removeAll,
        gridSizeFor: gridSizeFor,
        touchesBoundary: touchesBoundary
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = SIONNA_VOLUME;
}
