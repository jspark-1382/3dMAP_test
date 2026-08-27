// ============================================================
// Friis 자유공간 식으로 계산한 -100dBm 연속 3D 경계면 표시
// 기존 Sionna 등가면과 독립된 Primitive를 사용해 동시 비교할 수 있다.
// ============================================================
var FRIIS_ISOSURFACE = (function () {
    "use strict";

    var DATA_URL = "Data/sionna/friis_volume_surface.json";
    var dataCache = null;
    var primitive = null;
    var rings = null;
    var visible = false;
    var currentBaseHeight = 0;

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
    function loadData() {
        if (dataCache) return Promise.resolve(dataCache);
        return fetch(DATA_URL).then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        }).then(function (json) {
            dataCache = json;
            return json;
        });
    }
    function resolveTerrainBase(viewer, data, callback) {
        var bs = data.meta && data.meta.bs;
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
    function enuToCartesian(bs, baseHeight, east, north, up) {
        var point = BEAMPATTERN.enuToEcef(bs.lon, bs.lat, baseHeight, east, north, up);
        return new Cesium.Cartesian3(point.x, point.y, point.z);
    }
    function clear() {
        var viewer = getViewer();
        if (viewer) {
            if (primitive) {
                try { viewer.scene.primitives.remove(primitive); } catch (e) { /* 무시 */ }
            }
            if (rings) {
                try { viewer.scene.primitives.remove(rings); } catch (e2) { /* 무시 */ }
            }
        }
        primitive = null;
        rings = null;
        visible = false;
        var button = $("btn-friis-coverage-surface");
        if (button) button.classList.remove("active");
        var summary = $("friis-coverage-surface-summary");
        if (summary) summary.style.display = "none";
    }
    function buildGeometry(data, baseHeight) {
        var triangles = data.trianglesEnuM || [];
        var bs = data.meta.bs;
        var values = new Float64Array(triangles.length * 9);
        var indices = new Uint32Array(triangles.length * 3);
        var cursor = 0;
        for (var i = 0; i < triangles.length; i++) {
            var triangle = triangles[i];
            for (var vertex = 0; vertex < 3; vertex++) {
                var point = enuToCartesian(
                    bs, baseHeight,
                    Number(triangle[vertex * 3]),
                    Number(triangle[vertex * 3 + 1]),
                    Number(triangle[vertex * 3 + 2])
                );
                values[cursor++] = point.x;
                values[cursor++] = point.y;
                values[cursor++] = point.z;
                indices[i * 3 + vertex] = i * 3 + vertex;
            }
        }
        return new Cesium.Geometry({
            attributes: {
                position: new Cesium.GeometryAttribute({
                    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                    componentsPerAttribute: 3,
                    values: values
                })
            },
            indices: indices,
            primitiveType: Cesium.PrimitiveType.TRIANGLES,
            boundingSphere: Cesium.BoundingSphere.fromVertices(values)
        });
    }
    function addHorizontalRings(viewer, data, baseHeight) {
        var triangles = data.trianglesEnuM || [];
        var bs = data.meta.bs;
        var levels = [500, 1000, 2000, 5000, 10000];
        var collection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
        var material = Cesium.Material.fromType("Color", {
            color: Cesium.Color.fromCssColorString("#fb923c").withAlpha(0.82)
        });
        function edgePoint(triangle, a, b, level) {
            var za = triangle[a * 3 + 2], zb = triangle[b * 3 + 2];
            if ((za < level && zb < level) || (za > level && zb > level) || za === zb) return null;
            var ratio = (level - za) / (zb - za);
            if (ratio < 0 || ratio > 1) return null;
            return enuToCartesian(
                bs, baseHeight,
                triangle[a * 3] + (triangle[b * 3] - triangle[a * 3]) * ratio,
                triangle[a * 3 + 1] + (triangle[b * 3 + 1] - triangle[a * 3 + 1]) * ratio,
                level
            );
        }
        for (var levelIndex = 0; levelIndex < levels.length; levelIndex++) {
            for (var i = 0; i < triangles.length; i++) {
                var triangle = triangles[i], points = [], point;
                point = edgePoint(triangle, 0, 1, levels[levelIndex]); if (point) points.push(point);
                point = edgePoint(triangle, 1, 2, levels[levelIndex]); if (point) points.push(point);
                point = edgePoint(triangle, 2, 0, levels[levelIndex]); if (point) points.push(point);
                if (points.length === 2) collection.add({positions: points, width: 1.35, material: material});
            }
        }
        return collection;
    }
    function showSummary(data) {
        var meta = data.meta || {};
        var box = $("friis-coverage-surface-summary");
        if (!box) return;
        box.className = "coverage-volume-summary friis-summary";
        box.style.display = "block";
        box.innerHTML = "<strong>Friis 자유공간 · RSRP = " + meta.thresholdDbm +
            "dBm 경계면</strong><br>Sionna 미사용 · " +
            (meta.antennaModel || "이중 야기 + 옴니") + " H/V 방향이득 적용 · " +
            Number(meta.triangleCount).toLocaleString() + " triangles<br>" +
            "<strong>주황색 표면</strong> · 최대 경계거리 " +
            (Number(meta.maximumBoundaryDistanceM) / 1000).toFixed(1) + "km";
    }
    function flyToSurface(viewer, data, baseHeight) {
        var triangles = data.trianglesEnuM || [];
        if (!triangles.length) return;
        var bs = data.meta.bs, samplePoints = [];
        var step = Math.max(1, Math.floor(triangles.length / 500));
        for (var i = 0; i < triangles.length; i += step) {
            var triangle = triangles[i];
            samplePoints.push(enuToCartesian(bs, baseHeight, triangle[0], triangle[1], triangle[2]));
            samplePoints.push(enuToCartesian(bs, baseHeight, triangle[3], triangle[4], triangle[5]));
            samplePoints.push(enuToCartesian(bs, baseHeight, triangle[6], triangle[7], triangle[8]));
        }
        try {
            viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(samplePoints), {
                offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(20), Cesium.Math.toRadians(-28), 0),
                duration: 1.4
            });
        } catch (e) { /* 표시 유지 */ }
    }
    function renderSurface(data, baseHeight) {
        clear();
        var viewer = getViewer();
        if (!viewer || !window.Cesium || !window.BEAMPATTERN) {
            setStatus("Friis 3D 경계면을 표시할 지도가 준비되지 않았습니다.", true);
            return;
        }
        var opacity = Number($("coverage-surface-opacity").value) / 100;
        if (!isFinite(opacity)) opacity = 0.4;
        currentBaseHeight = baseHeight;
        var geometry = buildGeometry(data, baseHeight);
        var instance = new Cesium.GeometryInstance({
            geometry: geometry,
            attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                    Cesium.Color.fromCssColorString("#f97316").withAlpha(opacity)
                )
            }
        });
        primitive = viewer.scene.primitives.add(new Cesium.Primitive({
            geometryInstances: instance,
            appearance: new Cesium.PerInstanceColorAppearance({translucent: true, closed: false, flat: true}),
            asynchronous: true
        }));
        rings = addHorizontalRings(viewer, data, baseHeight);
        visible = true;
        $("btn-friis-coverage-surface").classList.add("active");
        showSummary(data);
        flyToSurface(viewer, data, baseHeight);
        setStatus("Friis 자유공간 -100dBm 연속 3D 경계면 표시 · 주황색 · " +
            Number(data.meta.triangleCount).toLocaleString() + " triangles");
    }
    function show() {
        var viewer = getViewer();
        if (!viewer || !window.Cesium) {
            setStatus("지도가 준비된 뒤 Friis 연속 3D 경계면을 표시하세요.", true);
            return;
        }
        setStatus("Friis 자유공간 -100dBm 3D 경계면을 불러오는 중...");
        loadData().then(function (data) {
            resolveTerrainBase(viewer, data, function (baseHeight) { renderSurface(data, baseHeight); });
        }).catch(function (error) {
            setStatus("Friis 3D 경계면 로드 실패: " + error.message, true);
        });
    }
    function hide() {
        clear();
        setStatus("Sionna/Friis 연속 3D 커버리지 경계면 숨김");
    }
    function init() {
        var showButton = $("btn-friis-coverage-surface");
        var hideButton = $("btn-coverage-surface-hide");
        var opacity = $("coverage-surface-opacity");
        if (showButton) showButton.addEventListener("click", show);
        if (hideButton) hideButton.addEventListener("click", hide);
        if (opacity) opacity.addEventListener("change", function () {
            if (visible && dataCache) renderSurface(dataCache, currentBaseHeight);
        });
    }
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();
    }
    return {show: show, hide: hide, clear: clear, buildGeometry: buildGeometry};
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = FRIIS_ISOSURFACE;
}
