// ============================================================
// Friis 자유공간 식의 가변 RSRP 연속 3D 경계면 표시
//   - 북쪽 0도, 동쪽 90도 방위축을 지도 3D 방사 패턴과 공통 사용
//   - 선택한 RSRP 기준과 안테나 패턴으로 브라우저에서 메시 재계산
// ============================================================
var FRIIS_ISOSURFACE = (function () {
    "use strict";

    var DATA_URL = "Data/sionna/friis_volume_surface.json";
    var CATALOG_URL = "Data/sionna/antenna_pattern_catalog.json";
    var baseDataCache = null;
    var catalogCache = null;
    var primitive = null;
    var rings = null;
    var visible = false;
    var currentBaseHeight = 0;
    var currentData = null;

    function $(id) { return document.getElementById(id); }
    function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
    function getViewer() {
        return (window.ws3d && window.ws3d.viewer) ? window.ws3d.viewer : null;
    }
    function setStatus(message, isError) {
        var el = $("status");
        if (!el) return;
        el.textContent = message;
        el.className = isError ? "status error" : "status";
    }
    function selectedThreshold() {
        var value = Number($("friis-surface-threshold") && $("friis-surface-threshold").value);
        return isFinite(value) ? clamp(value, -130, -40) : -100;
    }
    function selectedPatternKey() {
        var select = $("friis-surface-pattern");
        return select ? select.value : "combined";
    }
    function loadBaseData() {
        if (baseDataCache) return Promise.resolve(baseDataCache);
        return fetch(DATA_URL, {cache: "no-store"}).then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        }).then(function (json) { baseDataCache = json; return json; });
    }
    function loadCatalog() {
        if (catalogCache) return Promise.resolve(catalogCache);
        return fetch(CATALOG_URL, {cache: "no-store"}).then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        }).then(function (json) { catalogCache = json; return json; });
    }
    function idealIsotropicPattern() {
        return {
            key: "isotropic", label: "이상적 등방성 (구형)",
            maxGainDbi: 0, thetaDeg: [0, 180], vertical3dRelativeGainDb: [0, 0],
            phiDeg: [-180, 180], horizontal3dRelativeGainDb: [0, 0]
        };
    }
    function resolvePattern(catalog, key) {
        var pattern;
        if (key === "idealOmni" && window.RADIATION_PATTERN && RADIATION_PATTERN.idealOmniPattern) {
            return RADIATION_PATTERN.idealOmniPattern();
        }
        if (key === "isotropic") return idealIsotropicPattern();
        pattern = catalog && catalog.patterns ? catalog.patterns[key] : null;
        if (!pattern && catalog && catalog.patterns) pattern = catalog.patterns.combined;
        if (!pattern) throw new Error("선택한 안테나 패턴 데이터가 없습니다.");
        pattern.key = key;
        return pattern;
    }
    function boundaryDistanceM(txGainDbi, thresholdDbm, txPowerDbm, frequencyMHz) {
        var wavelengthM = 299792458 / (Number(frequencyMHz) * 1000000);
        var allowedPathLossDb = Number(txPowerDbm) + Number(txGainDbi) - Number(thresholdDbm);
        return wavelengthM / (4 * Math.PI) * Math.pow(10, allowedPathLossDb / 20);
    }
    function thresholdScale(fromThresholdDbm, toThresholdDbm) {
        return Math.pow(10, (Number(fromThresholdDbm) - Number(toThresholdDbm)) / 20);
    }
    function compassPoint(distanceM, thetaDeg, azimuthDeg, antennaHeightM) {
        var theta = Number(thetaDeg) * Math.PI / 180;
        var azimuth = Number(azimuthDeg) * Math.PI / 180;
        var horizontal = Number(distanceM) * Math.sin(theta);
        return [
            horizontal * Math.sin(azimuth),
            horizontal * Math.cos(azimuth),
            Number(antennaHeightM) + Number(distanceM) * Math.cos(theta)
        ];
    }
    function interpolateGroundCrossing(previous, current) {
        var ratio = (0 - previous[2]) / (current[2] - previous[2]);
        return [
            previous[0] + (current[0] - previous[0]) * ratio,
            previous[1] + (current[1] - previous[1]) * ratio,
            0
        ];
    }
    function clipTriangleAboveGround(triangle) {
        var polygon = [];
        var previous = triangle[triangle.length - 1];
        var previousInside = previous[2] >= 0;
        for (var i = 0; i < triangle.length; i++) {
            var current = triangle[i], currentInside = current[2] >= 0;
            if (currentInside !== previousInside) polygon.push(interpolateGroundCrossing(previous, current));
            if (currentInside) polygon.push(current);
            previous = current;
            previousInside = currentInside;
        }
        if (polygon.length < 3) return [];
        var result = [];
        for (var index = 1; index < polygon.length - 1; index++) {
            result.push([polygon[0], polygon[index], polygon[index + 1]]);
        }
        return result;
    }
    function nonDegenerate(triangle) {
        var a = triangle[0], b = triangle[1], c = triangle[2];
        var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        var cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        return Math.sqrt(cx * cx + cy * cy + cz * cz) > 0.00001;
    }
    function flattenTriangle(triangle) {
        var result = [];
        for (var i = 0; i < 3; i++) {
            result.push(Number(triangle[i][0].toFixed(3)));
            result.push(Number(triangle[i][1].toFixed(3)));
            result.push(Number(triangle[i][2].toFixed(3)));
        }
        return result;
    }
    function buildFormulaSurface(templateData, pattern, thresholdDbm) {
        var templateMeta = templateData.meta || {};
        var azimuthStep = Number(templateMeta.azimuthStepDeg) || 3;
        var thetaStep = Number(templateMeta.thetaStepDeg) || 2;
        var referencePowerDbm = Number(templateMeta.rsrpReferencePowerDbm);
        var systemLossDb = Number(templateMeta.systemLossDb);
        var frequencyMHz = Number(templateMeta.frequencyMHz || pattern.frequencyMHz || 955);
        var antennaHeightM = Number(templateMeta.antennaHeightM) || 16;
        var peakGainDbi = Number(pattern.maxGainDbi) || 0;
        var azimuths = [], thetas = [], vertices = [], triangles = [];
        var minimumDistance = Infinity, maximumDistance = 0, maximumAltitude = 0;
        var azimuth, theta, azimuthIndex, thetaIndex;
        if (!isFinite(referencePowerDbm)) referencePowerDbm = Number(templateMeta.txPowerDbm);
        if (!isFinite(referencePowerDbm)) referencePowerDbm = 18.22;
        if (!isFinite(systemLossDb)) systemLossDb = Number(templateMeta.cableLossDb);
        if (!isFinite(systemLossDb)) systemLossDb = 0;
        for (azimuth = -180; azimuth < 180 - 0.000001; azimuth += azimuthStep) azimuths.push(azimuth);
        for (theta = 0; theta <= 180 + 0.000001; theta += thetaStep) thetas.push(theta);
        for (azimuthIndex = 0; azimuthIndex < azimuths.length; azimuthIndex++) {
            vertices[azimuthIndex] = [];
            for (thetaIndex = 0; thetaIndex < thetas.length; thetaIndex++) {
                var elevationDeg = 90 - thetas[thetaIndex];
                var relativeGain = RADIATION_PATTERN.directionGain(pattern, azimuths[azimuthIndex], elevationDeg);
                var distance = boundaryDistanceM(
                    peakGainDbi + relativeGain - systemLossDb,
                    thresholdDbm, referencePowerDbm, frequencyMHz
                );
                minimumDistance = Math.min(minimumDistance, distance);
                maximumDistance = Math.max(maximumDistance, distance);
                var point = compassPoint(distance, thetas[thetaIndex], azimuths[azimuthIndex], antennaHeightM);
                maximumAltitude = Math.max(maximumAltitude, point[2]);
                vertices[azimuthIndex][thetaIndex] = point;
            }
        }
        for (azimuthIndex = 0; azimuthIndex < azimuths.length; azimuthIndex++) {
            var nextAzimuth = (azimuthIndex + 1) % azimuths.length;
            for (thetaIndex = 0; thetaIndex < thetas.length - 1; thetaIndex++) {
                var candidates = [
                    [vertices[azimuthIndex][thetaIndex], vertices[nextAzimuth][thetaIndex],
                        vertices[azimuthIndex][thetaIndex + 1]],
                    [vertices[azimuthIndex][thetaIndex + 1], vertices[nextAzimuth][thetaIndex],
                        vertices[nextAzimuth][thetaIndex + 1]]
                ];
                for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
                    var clipped = clipTriangleAboveGround(candidates[candidateIndex]);
                    for (var clippedIndex = 0; clippedIndex < clipped.length; clippedIndex++) {
                        if (nonDegenerate(clipped[clippedIndex])) triangles.push(flattenTriangle(clipped[clippedIndex]));
                    }
                }
            }
        }
        return {
            meta: {
                tool: "Friis formula (browser analytical)", environment: "free space",
                calculation: "analytical RSRP threshold distance by azimuth/elevation",
                frequencyMHz: frequencyMHz,
                bandwidthMHz: templateMeta.bandwidthMHz,
                numberOfResourceBlocks: templateMeta.numberOfResourceBlocks,
                subcarriers: templateMeta.subcarriers,
                txPowerDbm: templateMeta.txPowerDbm,
                baseRePowerDbm: templateMeta.baseRePowerDbm,
                rsPowerOffsetDb: templateMeta.rsPowerOffsetDb,
                rsrpReferencePowerDbm: referencePowerDbm,
                cableLossDb: templateMeta.cableLossDb,
                systemLossDb: systemLossDb,
                antennaModel: pattern.label || pattern.model || "선택 안테나",
                antennaMaxGainDbi: peakGainDbi, thresholdDbm: Number(thresholdDbm),
                azimuthStepDeg: azimuthStep, thetaStepDeg: thetaStep,
                azimuthConvention: "0°=North, 90°=East (clockwise)",
                bs: templateMeta.bs, antennaHeightM: antennaHeightM,
                triangleCount: triangles.length,
                minimumBoundaryDistanceM: Number(minimumDistance.toFixed(1)),
                maximumBoundaryDistanceM: Number(maximumDistance.toFixed(1)),
                maximumAltitudeM: Number(maximumAltitude.toFixed(1))
            },
            trianglesEnuM: triangles
        };
    }
    function loadDisplayData() {
        return Promise.all([loadBaseData(), loadCatalog()]).then(function (values) {
            var pattern = resolvePattern(values[1], selectedPatternKey());
            return buildFormulaSurface(values[0], pattern, selectedThreshold());
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
                    bs, baseHeight, Number(triangle[vertex * 3]),
                    Number(triangle[vertex * 3 + 1]), Number(triangle[vertex * 3 + 2])
                );
                values[cursor++] = point.x;
                values[cursor++] = point.y;
                values[cursor++] = point.z;
                indices[i * 3 + vertex] = i * 3 + vertex;
            }
        }
        return new Cesium.Geometry({
            attributes: { position: new Cesium.GeometryAttribute({
                componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                componentsPerAttribute: 3, values: values
            })},
            indices: indices, primitiveType: Cesium.PrimitiveType.TRIANGLES,
            boundingSphere: Cesium.BoundingSphere.fromVertices(values)
        });
    }
    function addHorizontalRings(viewer, data, baseHeight) {
        var triangles = data.trianglesEnuM || [], bs = data.meta.bs;
        var candidates = [100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        var maximumAltitude = Number(data.meta.maximumAltitudeM) || 0, levels = [];
        for (var levelIndex = 0; levelIndex < candidates.length; levelIndex++) {
            if (candidates[levelIndex] < maximumAltitude) levels.push(candidates[levelIndex]);
        }
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
                bs, baseHeight, triangle[a * 3] + (triangle[b * 3] - triangle[a * 3]) * ratio,
                triangle[a * 3 + 1] + (triangle[b * 3 + 1] - triangle[a * 3 + 1]) * ratio, level
            );
        }
        for (levelIndex = 0; levelIndex < levels.length; levelIndex++) {
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
        var meta = data.meta || {}, box = $("friis-coverage-surface-summary");
        if (!box) return;
        box.className = "coverage-volume-summary friis-summary";
        box.style.display = "block";
        box.innerHTML = "<strong>Friis 자유공간 · RSRP = " + meta.thresholdDbm +
            "dBm 경계면</strong><br>" + (meta.antennaModel || "선택 안테나") +
            " · " + meta.frequencyMHz + "MHz · 기준신호 " +
            Number(meta.rsrpReferencePowerDbm).toFixed(2) + "dBm · 케이블 손실 " +
            Number(meta.cableLossDb || meta.systemLossDb || 0).toFixed(1) + "dB<br>" +
            "북 0°/동 90° · " + Number(meta.triangleCount).toLocaleString() + " triangles<br>" +
            "<strong>주황색 표면</strong> · 최대 경계거리 " +
            (Number(meta.maximumBoundaryDistanceM) / 1000).toFixed(1) + "km<br>" +
            "RSRP 기준은 전체 크기를 바꾸며, 원형 여부는 선택한 안테나의 H-Plane으로 결정됩니다.";
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
    function renderSurface(data, baseHeight, shouldFly) {
        clear();
        var viewer = getViewer();
        if (!viewer || !window.Cesium || !window.BEAMPATTERN) {
            setStatus("Friis 3D 경계면을 표시할 지도가 준비되지 않았습니다.", true);
            return;
        }
        var opacity = Number($("coverage-surface-opacity").value) / 100;
        if (!isFinite(opacity)) opacity = 0.4;
        currentBaseHeight = baseHeight;
        currentData = data;
        var geometry = buildGeometry(data, baseHeight);
        var instance = new Cesium.GeometryInstance({
            geometry: geometry,
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString("#f97316").withAlpha(opacity)
            )}
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
        if (shouldFly !== false) flyToSurface(viewer, data, baseHeight);
        setStatus("Friis 자유공간 " + data.meta.thresholdDbm + "dBm 연속 3D 경계면 · " +
            data.meta.antennaModel + " · 북 0°/동 90°");
    }
    function show(shouldFly) {
        var viewer = getViewer();
        if (!viewer || !window.Cesium) {
            setStatus("지도가 준비된 뒤 Friis 연속 3D 경계면을 표시하세요.", true);
            return;
        }
        setStatus("선택한 기준으로 Friis 3D 경계면을 계산하는 중...");
        loadDisplayData().then(function (data) {
            resolveTerrainBase(viewer, data, function (baseHeight) {
                renderSurface(data, baseHeight, shouldFly);
            });
        }).catch(function (error) {
            setStatus("Friis 3D 경계면 계산 실패: " + error.message, true);
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
        var threshold = $("friis-surface-threshold");
        var pattern = $("friis-surface-pattern");
        if (showButton) showButton.addEventListener("click", function () { show(true); });
        if (hideButton) hideButton.addEventListener("click", hide);
        if (opacity) opacity.addEventListener("change", function () {
            if (visible && currentData) renderSurface(currentData, currentBaseHeight, false);
        });
        if (threshold) threshold.addEventListener("change", function () { if (visible) show(false); });
        if (pattern) pattern.addEventListener("change", function () { if (visible) show(false); });
    }
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();
    }
    return {
        show: show, hide: hide, clear: clear, buildGeometry: buildGeometry,
        buildFormulaSurface: buildFormulaSurface, boundaryDistanceM: boundaryDistanceM,
        thresholdScale: thresholdScale, compassPoint: compassPoint
    };
})();

if (typeof module !== "undefined" && module.exports) module.exports = FRIIS_ISOSURFACE;
