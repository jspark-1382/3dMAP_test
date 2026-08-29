// ============================================================
// 별도 Sionna 3D 계산 결과의 -100dBm 연속 등가면 표시
// 기존 Sionna 고도면/적층/빔 렌더러와 독립된 Primitive를 사용한다.
// ============================================================
var SIONNA_ISOSURFACE = (function () {
    "use strict";

    var DATA_URL = "Data/sionna/sionna_volume_surface.json";
    var dataCache = null;
    var primitive = null;
    var rings = null;
    var txEntity = null;
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
        return fetch(DATA_URL, {cache: "no-store"}).then(function (response) {
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
            if (txEntity) {
                try { viewer.entities.remove(txEntity); } catch (e3) { /* 무시 */ }
            }
        }
        primitive = null;
        rings = null;
        txEntity = null;
        visible = false;
        var button = $("btn-coverage-surface");
        if (button) button.classList.remove("active");
        var summary = $("coverage-surface-summary");
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
                    bs,
                    baseHeight,
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
        var levels = [500, 1000, 2000, 4000, 6000, 8000, 10000];
        var collection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
        var material = Cesium.Material.fromType("Color", {
            color: Cesium.Color.fromCssColorString("#c084fc").withAlpha(0.72)
        });

        function edgePoint(triangle, a, b, level) {
            var za = triangle[a * 3 + 2];
            var zb = triangle[b * 3 + 2];
            if ((za < level && zb < level) || (za > level && zb > level) || za === zb) return null;
            var ratio = (level - za) / (zb - za);
            if (ratio < 0 || ratio > 1) return null;
            return enuToCartesian(
                bs,
                baseHeight,
                triangle[a * 3] + (triangle[b * 3] - triangle[a * 3]) * ratio,
                triangle[a * 3 + 1] + (triangle[b * 3 + 1] - triangle[a * 3 + 1]) * ratio,
                level
            );
        }

        for (var levelIndex = 0; levelIndex < levels.length; levelIndex++) {
            var level = levels[levelIndex];
            for (var i = 0; i < triangles.length; i++) {
                var triangle = triangles[i];
                var points = [];
                var point;
                point = edgePoint(triangle, 0, 1, level); if (point) points.push(point);
                point = edgePoint(triangle, 1, 2, level); if (point) points.push(point);
                point = edgePoint(triangle, 2, 0, level); if (point) points.push(point);
                if (points.length === 2) {
                    collection.add({ positions: points, width: 1.35, material: material });
                }
            }
        }
        return collection;
    }

    function showSummary(data) {
        var meta = data.meta || {};
        var box = $("coverage-surface-summary");
        if (!box) return;
        var boundary = meta.boundaryReached || {};
        var closed = !boundary.west && !boundary.east && !boundary.south && !boundary.north && !boundary.top;
        box.className = "coverage-volume-summary" + (closed ? "" : " warning");
        box.style.display = "block";
        box.innerHTML = "<strong>Sionna RT · RSRP = " + meta.thresholdDbm +
            "dBm 연속 경계면</strong><br>" + meta.frequencyMHz +
            "MHz · 기준신호 " +
            Number(meta.rsrpReferencePowerDbm || meta.txPowerDbm).toFixed(2) +
            "dBm · 별도 3D 계산 " +
            (meta.horizontalSizeM / 1000).toFixed(0) + "km × " +
            (meta.horizontalSizeM / 1000).toFixed(0) + "km · 고도 0.1~" +
            (Math.max.apply(null, meta.altitudesM) / 1000).toFixed(0) + "km · " +
            Number(meta.triangleCount).toLocaleString() + " triangles" +
            (meta.cableLossDb === undefined ?
                "<br><strong>참고: 케이블 손실 1dB 적용 전 Sionna 결과</strong>" : "") +
            (closed ? "<br><strong>✓ 수평·상단 계산 경계 안에서 닫힌 형상</strong>" :
                "<br><strong>⚠ 계산영역 경계에 도달한 형상</strong>");
    }

    function flyToSurface(viewer, data, baseHeight) {
        var triangles = data.trianglesEnuM || [];
        var bs = data.meta.bs;
        if (!triangles.length) return;
        var samplePoints = [];
        var step = Math.max(1, Math.floor(triangles.length / 500));
        for (var i = 0; i < triangles.length; i += step) {
            var triangle = triangles[i];
            samplePoints.push(enuToCartesian(bs, baseHeight, triangle[0], triangle[1], triangle[2]));
            samplePoints.push(enuToCartesian(bs, baseHeight, triangle[3], triangle[4], triangle[5]));
            samplePoints.push(enuToCartesian(bs, baseHeight, triangle[6], triangle[7], triangle[8]));
        }
        try {
            viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(samplePoints), {
                offset: new Cesium.HeadingPitchRange(
                    Cesium.Math.toRadians(20),
                    Cesium.Math.toRadians(-28),
                    0
                ),
                duration: 1.4
            });
        } catch (e) { /* 표시 유지 */ }
    }

    function renderSurface(data, baseHeight) {
        clear();
        var viewer = getViewer();
        if (!viewer || !window.Cesium || !window.BEAMPATTERN) {
            setStatus("3D 커버리지 경계면을 표시할 지도가 준비되지 않았습니다.", true);
            return;
        }
        var opacity = Number($("coverage-surface-opacity").value) / 100;
        if (!isFinite(opacity)) opacity = 0.38;
        currentBaseHeight = baseHeight;
        var geometry = buildGeometry(data, baseHeight);
        var instance = new Cesium.GeometryInstance({
            geometry: geometry,
            attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                    Cesium.Color.fromCssColorString("#22d3ee").withAlpha(opacity)
                )
            }
        });
        primitive = viewer.scene.primitives.add(new Cesium.Primitive({
            geometryInstances: instance,
            appearance: new Cesium.PerInstanceColorAppearance({
                translucent: true,
                closed: false,
                flat: true
            }),
            asynchronous: true
        }));
        rings = addHorizontalRings(viewer, data, baseHeight);

        var bs = data.meta.bs;
        txEntity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(
                bs.lon,
                bs.lat,
                baseHeight + Number(data.meta.antennaHeightM || 0)
            ),
            point: {
                pixelSize: 14,
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
        });

        visible = true;
        $("btn-coverage-surface").classList.add("active");
        showSummary(data);
        flyToSurface(viewer, data, baseHeight);
        var meta = data.meta || {};
        var altitudes = meta.altitudesM || [];
        var maxAltKm = altitudes.length ? Number(altitudes[altitudes.length - 1]) / 1000 : 0;
        setStatus(
            "Sionna -100dBm 연속 3D 커버리지 경계면 표시 · " +
            (Number(meta.horizontalSizeM) / 1000).toFixed(0) + "km × " +
            (Number(meta.horizontalSizeM) / 1000).toFixed(0) + "km / 고도 " +
            maxAltKm.toFixed(0) + "km 계산 · " +
            Number(meta.triangleCount).toLocaleString() + " triangles"
        );
    }

    function show() {
        var viewer = getViewer();
        if (!viewer || !window.Cesium) {
            setStatus("지도가 준비된 뒤 연속 3D 경계면을 표시하세요.", true);
            return;
        }
        setStatus("별도 Sionna -100dBm 3D 경계면을 불러오는 중...");
        loadData().then(function (data) {
            resolveTerrainBase(viewer, data, function (baseHeight) {
                renderSurface(data, baseHeight);
            });
        }).catch(function (error) {
            setStatus("Sionna 3D 경계면 로드 실패: " + error.message, true);
        });
    }

    function hide() {
        clear();
        setStatus("Sionna -100dBm 연속 3D 커버리지 경계면 숨김");
    }

    function init() {
        var showButton = $("btn-coverage-surface");
        var hideButton = $("btn-coverage-surface-hide");
        var opacity = $("coverage-surface-opacity");
        if (showButton) showButton.addEventListener("click", show);
        if (hideButton) hideButton.addEventListener("click", hide);
        if (opacity) opacity.addEventListener("input", function () {
            $("coverage-surface-opacity-val").textContent = opacity.value + "%";
        });
        if (opacity) opacity.addEventListener("change", function () {
            if (visible && dataCache) renderSurface(dataCache, currentBaseHeight);
        });
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();
    }

    return { show: show, hide: hide, clear: clear };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = SIONNA_ISOSURFACE;
}
