// ============================================================
// Sionna/Friis -100dBm 연속 경계면의 고도별 최단 수평거리 비교표
// ============================================================
var COVERAGE_SURFACE_COMPARISON = (function () {
    "use strict";

    var SIONNA_URL = "Data/sionna/sionna_volume_surface.json";
    var FRIIS_URL = "Data/sionna/friis_volume_surface.json";
    var MIN_HORIZONTAL_DISTANCE_M = 200;
    var RING_SEGMENTS = 144;
    var cache = null;
    var currentRows = [];
    var lineEntities = [];
    var slicePrimitives = [];
    var activeRowIndex = null;
    var activeMode = null;

    function $(id) { return document.getElementById(id); }

    function altitudeLevels(maxAltitudeM) {
        var levels = [], value;
        for (value = 100; value <= 500; value += 100) levels.push(value);
        for (value = 1000; value <= 10000; value += 1000) levels.push(value);
        var upper = Math.floor(Number(maxAltitudeM || 0) / 10000) * 10000;
        for (value = 20000; value <= upper; value += 10000) levels.push(value);
        return levels;
    }

    function nearestPointAtAltitude(triangles, altitudeM, minimumHorizontalM) {
        var nearest = null;
        var epsilon = 1e-6;
        var minimum = Number(minimumHorizontalM);
        if (!isFinite(minimum)) minimum = MIN_HORIZONTAL_DISTANCE_M;
        function consider(x, y) {
            var distance = Math.sqrt(x * x + y * y);
            if (distance <= minimum) return;
            if (!nearest || distance < nearest.horizontalDistanceM) {
                nearest = {
                    eastM: x,
                    northM: y,
                    altitudeM: Number(altitudeM),
                    horizontalDistanceM: distance
                };
            }
        }
        function considerSegment(a, b) {
            var dx = b[0] - a[0], dy = b[1] - a[1];
            var lengthSquared = dx * dx + dy * dy;
            var ratio = lengthSquared > 0 ? -(a[0] * dx + a[1] * dy) / lengthSquared : 0;
            ratio = Math.max(0, Math.min(1, ratio));
            consider(a[0] + dx * ratio, a[1] + dy * ratio);
        }
        function edgeIntersections(triangle, a, b, intersections) {
            var za = Number(triangle[a * 3 + 2]);
            var zb = Number(triangle[b * 3 + 2]);
            var xa = Number(triangle[a * 3]), ya = Number(triangle[a * 3 + 1]);
            var xb = Number(triangle[b * 3]), yb = Number(triangle[b * 3 + 1]);
            var aOnPlane = Math.abs(za - altitudeM) < epsilon;
            var bOnPlane = Math.abs(zb - altitudeM) < epsilon;
            if (aOnPlane && bOnPlane) {
                considerSegment([xa, ya], [xb, yb]);
                return;
            }
            if (aOnPlane) intersections.push([xa, ya]);
            if (bOnPlane) intersections.push([xb, yb]);
            if (!aOnPlane && !bOnPlane &&
                    ((za < altitudeM && zb > altitudeM) || (za > altitudeM && zb < altitudeM))) {
                var ratio = (altitudeM - za) / (zb - za);
                intersections.push([xa + (xb - xa) * ratio, ya + (yb - ya) * ratio]);
            }
        }
        for (var i = 0; i < triangles.length; i++) {
            var intersections = [], unique = [];
            edgeIntersections(triangles[i], 0, 1, intersections);
            edgeIntersections(triangles[i], 1, 2, intersections);
            edgeIntersections(triangles[i], 2, 0, intersections);
            for (var pointIndex = 0; pointIndex < intersections.length; pointIndex++) {
                var duplicate = false;
                for (var uniqueIndex = 0; uniqueIndex < unique.length; uniqueIndex++) {
                    if (Math.abs(intersections[pointIndex][0] - unique[uniqueIndex][0]) < epsilon &&
                            Math.abs(intersections[pointIndex][1] - unique[uniqueIndex][1]) < epsilon) {
                        duplicate = true;
                        break;
                    }
                }
                if (!duplicate) unique.push(intersections[pointIndex]);
            }
            if (unique.length === 1) consider(unique[0][0], unique[0][1]);
            if (unique.length >= 2) considerSegment(unique[0], unique[1]);
        }
        return nearest;
    }

    function minHorizontalDistanceAtAltitude(triangles, altitudeM) {
        var point = nearestPointAtAltitude(triangles, altitudeM);
        return point ? point.horizontalDistanceM : null;
    }

    function farthestPointAtAltitude(triangles, altitudeM, minimumHorizontalM) {
        var farthest = null;
        var epsilon = 1e-6;
        var minimum = Number(minimumHorizontalM);
        if (!isFinite(minimum)) minimum = MIN_HORIZONTAL_DISTANCE_M;
        function consider(x, y) {
            var distance = Math.sqrt(x * x + y * y);
            if (distance <= minimum) return;
            if (!farthest || distance > farthest.horizontalDistanceM) {
                farthest = {
                    eastM: x,
                    northM: y,
                    altitudeM: Number(altitudeM),
                    horizontalDistanceM: distance
                };
            }
        }
        function edge(triangle, a, b) {
            var za = Number(triangle[a * 3 + 2]);
            var zb = Number(triangle[b * 3 + 2]);
            var xa = Number(triangle[a * 3]), ya = Number(triangle[a * 3 + 1]);
            var xb = Number(triangle[b * 3]), yb = Number(triangle[b * 3 + 1]);
            var aOnPlane = Math.abs(za - altitudeM) < epsilon;
            var bOnPlane = Math.abs(zb - altitudeM) < epsilon;
            if (aOnPlane) consider(xa, ya);
            if (bOnPlane) consider(xb, yb);
            if (!aOnPlane && !bOnPlane &&
                    ((za < altitudeM && zb > altitudeM) || (za > altitudeM && zb < altitudeM))) {
                var ratio = (altitudeM - za) / (zb - za);
                consider(xa + (xb - xa) * ratio, ya + (yb - ya) * ratio);
            }
        }
        for (var i = 0; i < triangles.length; i++) {
            edge(triangles[i], 0, 1);
            edge(triangles[i], 1, 2);
            edge(triangles[i], 2, 0);
        }
        return farthest;
    }

    function maximumAltitude(data) {
        if (data.meta && isFinite(Number(data.meta.maximumAltitudeM))) {
            return Number(data.meta.maximumAltitudeM);
        }
        var triangles = data.trianglesEnuM || [], maximum = 0;
        for (var i = 0; i < triangles.length; i++) {
            maximum = Math.max(maximum, Number(triangles[i][2]), Number(triangles[i][5]), Number(triangles[i][8]));
        }
        return maximum;
    }

    function minimumPointAtAltitude(data, altitudeM) {
        var point = nearestPointAtAltitude(
            data.trianglesEnuM || [], altitudeM, MIN_HORIZONTAL_DISTANCE_M
        );
        if (!point) return null;
        var antennaHeight = Number(data.meta && data.meta.antennaHeightM);
        if (!isFinite(antennaHeight)) antennaHeight = 0;
        var vertical = Number(altitudeM) - antennaHeight;
        point.distanceM = point.horizontalDistanceM;
        point.slantDistanceM = Math.sqrt(
            point.horizontalDistanceM * point.horizontalDistanceM + vertical * vertical
        );
        point.antennaHeightM = antennaHeight;
        return point;
    }

    function minimumDistanceAtAltitude(data, altitudeM) {
        var point = minimumPointAtAltitude(data, altitudeM);
        return point ? point.distanceM : null;
    }

    function maximumPointAtAltitude(data, altitudeM) {
        var point = farthestPointAtAltitude(
            data.trianglesEnuM || [], altitudeM, MIN_HORIZONTAL_DISTANCE_M
        );
        if (!point) return null;
        var antennaHeight = Number(data.meta && data.meta.antennaHeightM);
        if (!isFinite(antennaHeight)) antennaHeight = 0;
        var vertical = Number(altitudeM) - antennaHeight;
        point.distanceM = point.horizontalDistanceM;
        point.slantDistanceM = Math.sqrt(
            point.horizontalDistanceM * point.horizontalDistanceM + vertical * vertical
        );
        point.antennaHeightM = antennaHeight;
        return point;
    }

    function buildRows(sionna, friis) {
        var maximum = Math.max(maximumAltitude(sionna), maximumAltitude(friis));
        var levels = altitudeLevels(maximum), rows = [];
        for (var i = 0; i < levels.length; i++) {
            var sionnaPoint = minimumPointAtAltitude(sionna, levels[i]);
            var friisPoint = minimumPointAtAltitude(friis, levels[i]);
            var sionnaMaxPoint = maximumPointAtAltitude(sionna, levels[i]);
            var friisMaxPoint = maximumPointAtAltitude(friis, levels[i]);
            var sionnaDistance = sionnaPoint ? sionnaPoint.horizontalDistanceM : null;
            var friisDistance = friisPoint ? friisPoint.horizontalDistanceM : null;
            rows.push({
                altitudeM: levels[i],
                sionnaDistanceM: sionnaDistance,
                friisDistanceM: friisDistance,
                sionnaMaximumDistanceM: sionnaMaxPoint ? sionnaMaxPoint.horizontalDistanceM : null,
                friisMaximumDistanceM: friisMaxPoint ? friisMaxPoint.horizontalDistanceM : null,
                sionnaPoint: sionnaPoint,
                friisPoint: friisPoint,
                sionnaMaxPoint: sionnaMaxPoint,
                friisMaxPoint: friisMaxPoint,
                differenceM: sionnaDistance !== null && friisDistance !== null
                    ? friisDistance - sionnaDistance : null
            });
        }
        return rows;
    }

    function formatAltitude(value) {
        return value < 1000 ? value + "m" : (value / 1000) + "km";
    }
    function formatDistance(value) {
        if (value === null || !isFinite(value)) return "—";
        if (Math.abs(value) < 1000) return Math.round(value) + "m";
        return (value / 1000).toFixed(1) + "km";
    }
    function formatRange(minimum, maximum) {
        if (minimum === null || !isFinite(minimum)) return "—";
        if (maximum === null || !isFinite(maximum) || Math.abs(maximum - minimum) < 1) {
            return formatDistance(minimum);
        }
        return formatDistance(minimum) + "~" + formatDistance(maximum);
    }
    function intersectionSegmentsAtAltitude(triangles, altitudeM) {
        var segments = [], epsilon = 1e-6;
        function samePoint(a, b) {
            return Math.abs(a.eastM - b.eastM) < epsilon &&
                Math.abs(a.northM - b.northM) < epsilon;
        }
        function pointAt(triangle, index) {
            return {
                eastM: Number(triangle[index * 3]),
                northM: Number(triangle[index * 3 + 1]),
                altitudeM: Number(triangle[index * 3 + 2])
            };
        }
        function addUnique(points, point) {
            for (var i = 0; i < points.length; i++) {
                if (samePoint(points[i], point)) return;
            }
            points.push(point);
        }
        function edgeIntersection(a, b, points) {
            var aOn = Math.abs(a.altitudeM - altitudeM) < epsilon;
            var bOn = Math.abs(b.altitudeM - altitudeM) < epsilon;
            if (aOn) addUnique(points, {
                eastM: a.eastM, northM: a.northM, altitudeM: Number(altitudeM)
            });
            if (bOn) addUnique(points, {
                eastM: b.eastM, northM: b.northM, altitudeM: Number(altitudeM)
            });
            if (!aOn && !bOn &&
                    ((a.altitudeM < altitudeM && b.altitudeM > altitudeM) ||
                    (a.altitudeM > altitudeM && b.altitudeM < altitudeM))) {
                var ratio = (altitudeM - a.altitudeM) / (b.altitudeM - a.altitudeM);
                addUnique(points, {
                    eastM: a.eastM + (b.eastM - a.eastM) * ratio,
                    northM: a.northM + (b.northM - a.northM) * ratio,
                    altitudeM: Number(altitudeM)
                });
            }
        }
        for (var triangleIndex = 0; triangleIndex < triangles.length; triangleIndex++) {
            var triangle = triangles[triangleIndex];
            var points = [];
            var p0 = pointAt(triangle, 0), p1 = pointAt(triangle, 1), p2 = pointAt(triangle, 2);
            edgeIntersection(p0, p1, points);
            edgeIntersection(p1, p2, points);
            edgeIntersection(p2, p0, points);
            if (points.length === 2) {
                segments.push([points[0], points[1]]);
            } else if (points.length === 3) {
                segments.push([points[0], points[1]], [points[1], points[2]], [points[2], points[0]]);
            }
        }
        return segments;
    }
    function getViewer() {
        return (window.ws3d && window.ws3d.viewer) ? window.ws3d.viewer : null;
    }
    function terrainBase(viewer, data) {
        var bs = data && data.meta && data.meta.bs;
        if (!bs || !window.Cesium || !Cesium.sampleTerrainMostDetailed || !viewer.terrainProvider) {
            return Promise.resolve(0);
        }
        var cartographic = Cesium.Cartographic.fromDegrees(bs.lon, bs.lat);
        return Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cartographic]).then(function (result) {
            var height = result && result[0] ? Number(result[0].height) : 0;
            return isFinite(height) ? height : 0;
        }).catch(function () { return 0; });
    }
    function enuToCartesian(data, baseHeight, point) {
        var bs = data.meta.bs;
        var value = BEAMPATTERN.enuToEcef(
            bs.lon, bs.lat, baseHeight,
            Number(point.eastM), Number(point.northM), Number(point.altitudeM)
        );
        return new Cesium.Cartesian3(value.x, value.y, value.z);
    }
    function updateLineButtons() {
        var buttons = document.querySelectorAll(".distance-line-btn");
        for (var i = 0; i < buttons.length; i++) {
            var selected = activeMode === "radius" &&
                Number(buttons[i].getAttribute("data-row-index")) === activeRowIndex;
            buttons[i].className = "distance-line-btn" + (selected ? " active" : "");
            buttons[i].textContent = selected ? "반경 숨기기" : "반경 표시";
            buttons[i].setAttribute("aria-pressed", selected ? "true" : "false");
        }
        var sliceButtons = document.querySelectorAll(".distance-slice-btn");
        for (var sliceIndex = 0; sliceIndex < sliceButtons.length; sliceIndex++) {
            var sliceSelected = activeMode === "slice" &&
                Number(sliceButtons[sliceIndex].getAttribute("data-row-index")) === activeRowIndex;
            sliceButtons[sliceIndex].className = "distance-slice-btn" + (sliceSelected ? " active" : "");
            sliceButtons[sliceIndex].textContent = sliceSelected ? "단면 숨기기" : "단면 보기";
            sliceButtons[sliceIndex].setAttribute("aria-pressed", sliceSelected ? "true" : "false");
        }
    }
    function clearLines() {
        var viewer = getViewer();
        if (viewer) {
            for (var i = 0; i < lineEntities.length; i++) {
                try { viewer.entities.remove(lineEntities[i]); } catch (e) { /* 무시 */ }
            }
            for (var primitiveIndex = 0; primitiveIndex < slicePrimitives.length; primitiveIndex++) {
                try { viewer.scene.primitives.remove(slicePrimitives[primitiveIndex]); } catch (e2) { /* 무시 */ }
            }
        }
        lineEntities = [];
        slicePrimitives = [];
        activeRowIndex = null;
        activeMode = null;
        updateLineButtons();
    }
    function addModelLine(viewer, data, point, baseHeight, label, cssColor, rangeKind) {
        if (!point) return [];
        var start = enuToCartesian(data, baseHeight, {
            eastM: 0, northM: 0, altitudeM: point.altitudeM
        });
        var end = enuToCartesian(data, baseHeight, point);
        var isMaximum = rangeKind === "최장";
        var displayCssColor = isMaximum ?
            (cssColor === "#22d3ee" ? "#a5f3fc" : "#fde047") : cssColor;
        var color = Cesium.Color.fromCssColorString(displayCssColor);
        var lineColor = color.withAlpha(isMaximum ? 0.58 : 1);
        var line = viewer.entities.add({
            name: label + " " + rangeKind + " 수평거리 반경선",
            polyline: {
                positions: [start, end],
                width: isMaximum ? 3 : 5,
                material: lineColor,
                depthFailMaterial: color.withAlpha(isMaximum ? 0.22 : 0.45),
                arcType: Cesium.ArcType.NONE
            }
        });
        var ringPositions = [];
        for (var ringIndex = 0; ringIndex <= RING_SEGMENTS; ringIndex++) {
            var angle = ringIndex / RING_SEGMENTS * Math.PI * 2;
            ringPositions.push(enuToCartesian(data, baseHeight, {
                eastM: point.horizontalDistanceM * Math.sin(angle),
                northM: point.horizontalDistanceM * Math.cos(angle),
                altitudeM: point.altitudeM
            }));
        }
        var ring = viewer.entities.add({
            name: label + " " + rangeKind + " 수평거리 원형 반경",
            polyline: {
                positions: ringPositions,
                width: isMaximum ? 2 : 3,
                material: color.withAlpha(isMaximum ? 0.42 : 0.78),
                depthFailMaterial: color.withAlpha(isMaximum ? 0.16 : 0.32),
                arcType: Cesium.ArcType.NONE
            }
        });
        var marker = viewer.entities.add({
            name: label + " " + rangeKind + " 수평 도달 끝점",
            position: end,
            point: {
                pixelSize: isMaximum ? 8 : 11,
                color: lineColor,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                text: label + " " + rangeKind + " · 고도 " + formatAltitude(point.altitudeM) +
                    " · 수평 " + formatDistance(point.horizontalDistanceM),
                font: "bold 12px Malgun Gothic",
                fillColor: color,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -20),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        return [
            line, ring, marker, start, end,
            ringPositions[0], ringPositions[Math.floor(RING_SEGMENTS / 4)],
            ringPositions[Math.floor(RING_SEGMENTS / 2)],
            ringPositions[Math.floor(RING_SEGMENTS * 3 / 4)]
        ];
    }
    function drawAltitudeLines(rowIndex) {
        var viewer = getViewer();
        var row = currentRows[rowIndex];
        if (!viewer || !window.Cesium || !window.BEAMPATTERN) {
            setStatus("지도가 준비된 뒤 수평거리 반경을 표시하세요.", true);
            return;
        }
        if (!row || !cache) return;
        if (activeMode === "radius" && activeRowIndex === rowIndex) {
            clearLines();
            setStatus(formatAltitude(row.altitudeM) + " 수평거리 반경 숨김");
            return;
        }
        clearLines();
            setStatus(formatAltitude(row.altitudeM) + " 수평거리 반경을 계산하는 중...");
        Promise.all([terrainBase(viewer, cache[0]), terrainBase(viewer, cache[1])]).then(function (bases) {
            var focusPoints = [];
            var sionnaItems = addModelLine(
                viewer, cache[0], row.sionnaPoint, bases[0], "Sionna", "#22d3ee", "최단"
            );
            var friisItems = addModelLine(
                viewer, cache[1], row.friisPoint, bases[1], "Friis", "#f97316", "최단"
            );
            var sionnaMaximumItems = addModelLine(
                viewer, cache[0], row.sionnaMaxPoint, bases[0], "Sionna", "#22d3ee", "최장"
            );
            var friisMaximumItems = addModelLine(
                viewer, cache[1], row.friisMaxPoint, bases[1], "Friis", "#f97316", "최장"
            );
            var items = sionnaItems.concat(friisItems, sionnaMaximumItems, friisMaximumItems);
            for (var i = 0; i < items.length; i++) {
                if (items[i] && items[i].position === undefined && items[i].x !== undefined) focusPoints.push(items[i]);
                else if (items[i] && items[i].id !== undefined) lineEntities.push(items[i]);
            }
            if (!lineEntities.length) {
                setStatus(formatAltitude(row.altitudeM) + "에는 표시할 경계점이 없습니다.", true);
                return;
            }
            activeRowIndex = rowIndex;
            activeMode = "radius";
            updateLineButtons();
            if (focusPoints.length) {
                try {
                    viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(focusPoints), {
                        offset: new Cesium.HeadingPitchRange(
                            Cesium.Math.toRadians(20), Cesium.Math.toRadians(-55), 0
                        ),
                        duration: 1.2
                    });
                } catch (e) { /* 선 표시는 유지 */ }
            }
            var modelText = row.sionnaPoint && row.friisPoint ? "청록 Sionna / 주황 Friis" :
                (row.sionnaPoint ? "청록 Sionna" : "주황 Friis");
            setStatus(formatAltitude(row.altitudeM) + " 고도 평면 최단·최장 수평반경 표시 · " + modelText);
        }).catch(function (error) {
            clearLines();
            setStatus("수평거리 반경 표시 실패: " + error.message, true);
        });
    }
    function hideFullSurfaces() {
        if (window.SIONNA_ISOSURFACE && SIONNA_ISOSURFACE.clear) SIONNA_ISOSURFACE.clear();
        if (window.FRIIS_ISOSURFACE && FRIIS_ISOSURFACE.clear) FRIIS_ISOSURFACE.clear();
    }
    function addSliceContours(viewer, data, segments, baseHeight, label, cssColor) {
        if (!segments.length) return [];
        var collection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
        var material = Cesium.Material.fromType("Color", {
            color: Cesium.Color.fromCssColorString(cssColor).withAlpha(0.95)
        });
        var focusPoints = [];
        var sampleStep = Math.max(1, Math.floor(segments.length / 400));
        for (var i = 0; i < segments.length; i++) {
            var start = enuToCartesian(data, baseHeight, segments[i][0]);
            var end = enuToCartesian(data, baseHeight, segments[i][1]);
            collection.add({
                positions: [start, end],
                width: label === "Sionna" ? 3.5 : 3,
                material: material
            });
            if (i % sampleStep === 0) focusPoints.push(start, end);
        }
        slicePrimitives.push(collection);
        return focusPoints;
    }
    function drawAltitudeSlice(rowIndex) {
        var viewer = getViewer();
        var row = currentRows[rowIndex];
        if (!viewer || !window.Cesium || !window.BEAMPATTERN) {
            setStatus("지도가 준비된 뒤 고도 단면을 표시하세요.", true);
            return;
        }
        if (!row || !cache) return;
        if (activeMode === "slice" && activeRowIndex === rowIndex) {
            clearLines();
            setStatus(formatAltitude(row.altitudeM) + " 고도 단면 숨김");
            return;
        }
        clearLines();
        hideFullSurfaces();
        setStatus(formatAltitude(row.altitudeM) + " 고도 단면을 추출하는 중...");
        var sionnaSegments = intersectionSegmentsAtAltitude(
            cache[0].trianglesEnuM || [], row.altitudeM
        );
        var friisSegments = intersectionSegmentsAtAltitude(
            cache[1].trianglesEnuM || [], row.altitudeM
        );
        Promise.all([terrainBase(viewer, cache[0]), terrainBase(viewer, cache[1])]).then(function (bases) {
            var focusPoints = [];
            focusPoints = focusPoints.concat(addSliceContours(
                viewer, cache[0], sionnaSegments, bases[0], "Sionna", "#22d3ee"
            ));
            focusPoints = focusPoints.concat(addSliceContours(
                viewer, cache[1], friisSegments, bases[1], "Friis", "#f97316"
            ));
            if (!focusPoints.length) {
                clearLines();
                setStatus(formatAltitude(row.altitudeM) + "에는 교차하는 3D 경계면이 없습니다.", true);
                return;
            }
            var center = enuToCartesian(cache[0], bases[0], {
                eastM: 0, northM: 0, altitudeM: row.altitudeM
            });
            lineEntities.push(viewer.entities.add({
                name: formatAltitude(row.altitudeM) + " 고도 단면 기준점",
                position: center,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                label: {
                    text: "TX 수직선 기준 · 고도 " + formatAltitude(row.altitudeM) + " 단면",
                    font: "bold 13px Malgun Gothic",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -22),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
            }));
            activeRowIndex = rowIndex;
            activeMode = "slice";
            updateLineButtons();
            try {
                viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(focusPoints), {
                    offset: new Cesium.HeadingPitchRange(
                        0, Cesium.Math.toRadians(-72), 0
                    ),
                    duration: 1.2
                });
            } catch (e) { /* 단면 표시는 유지 */ }
            setStatus(formatAltitude(row.altitudeM) + " 고도 단면만 표시 · 청록 Sionna " +
                sionnaSegments.length.toLocaleString() + "개 / 주황 Friis " +
                friisSegments.length.toLocaleString() + "개 선분");
        }).catch(function (error) {
            clearLines();
            setStatus("고도 단면 표시 실패: " + error.message, true);
        });
    }
    function render(rows) {
        var box = $("coverage-distance-result");
        if (!box) return;
        clearLines();
        currentRows = rows;
        var pendingLoss = cache && cache[0] && cache[0].meta &&
            cache[0].meta.cableLossDb === undefined;
        var html = '<div class="distance-table-note"><strong>선택 고도에서 RSRP -100dBm 경계까지의 최단~최장 수평반경</strong>' +
            (pendingLoss ? '<br><strong>주의:</strong> Sionna는 케이블 손실 1dB 적용 전, Friis는 1dB 적용 결과입니다.' : '') +
            '<br>기지국 중심에서 200m 이하인 교차점은 제외합니다. 반경선·끝점·원형 보조원은 선택한 실제 고도 평면에 표시됩니다. 최단·최장 원은 방향별 3D 단면이 들어가는 범위를 나타내며 실제 경계 형상 자체는 아닙니다.</div>' +
            '<div class="distance-table-wrap"><table class="alt-table distance-table"><thead><tr>' +
            '<th>고도</th><th><span class="surface-key sionna"></span>Sionna 최단~최장</th>' +
            '<th><span class="surface-key friis"></span>Friis 최단~최장</th><th>최단차</th><th>지도</th>' +
            '</tr></thead><tbody>';
        for (var i = 0; i < rows.length; i++) {
            html += '<tr><td>' + formatAltitude(rows[i].altitudeM) + '</td>' +
                '<td>' + formatRange(rows[i].sionnaDistanceM, rows[i].sionnaMaximumDistanceM) + '</td>' +
                '<td>' + formatRange(rows[i].friisDistanceM, rows[i].friisMaximumDistanceM) + '</td>' +
                '<td>' + formatDistance(rows[i].differenceM) + '</td>' +
                '<td><div class="distance-map-actions"><button type="button" class="distance-line-btn" data-row-index="' + i +
                '" aria-label="' + formatAltitude(rows[i].altitudeM) + ' 수평거리 반경 표시" aria-pressed="false">반경 표시</button>' +
                '<button type="button" class="distance-slice-btn" data-row-index="' + i +
                '" aria-label="' + formatAltitude(rows[i].altitudeM) + ' 경계면 단면 보기" aria-pressed="false">단면 보기</button></div></td></tr>';
        }
        html += '</tbody></table></div><div class="distance-table-note">최단차 = Friis 최단 − Sionna 최단 · 반경 표시는 최단/최장 보조원, 단면 보기는 선택 고도와 실제 3D 경계면이 만나는 윤곽선만 표시합니다. · —는 200m 초과 경계점이 없음을 뜻합니다.</div>';
        box.innerHTML = html;
        box.style.display = "block";
        var buttons = box.querySelectorAll(".distance-line-btn");
        for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex++) {
            buttons[buttonIndex].addEventListener("click", function () {
                drawAltitudeLines(Number(this.getAttribute("data-row-index")));
            });
        }
        var sliceButtons = box.querySelectorAll(".distance-slice-btn");
        for (var sliceButtonIndex = 0; sliceButtonIndex < sliceButtons.length; sliceButtonIndex++) {
            sliceButtons[sliceButtonIndex].addEventListener("click", function () {
                drawAltitudeSlice(Number(this.getAttribute("data-row-index")));
            });
        }
    }
    function setStatus(message, isError) {
        var el = $("status");
        if (!el) return;
        el.textContent = message;
        el.className = isError ? "status error" : "status";
    }
    function toggle() {
        var box = $("coverage-distance-result");
        var button = $("btn-coverage-distance-table");
        if (!box || !button) return;
        if (box.style.display === "block") {
            clearLines();
            box.style.display = "none";
            button.textContent = "-100dBm 고도별 수평 도달거리 표";
            return;
        }
        button.textContent = "표를 계산하는 중...";
        button.disabled = true;
        var load = cache ? Promise.resolve(cache) : Promise.all([
            fetch(SIONNA_URL, {cache: "no-store"}).then(function (response) {
                if (!response.ok) throw new Error("Sionna HTTP " + response.status);
                return response.json();
            }),
            fetch(FRIIS_URL, {cache: "no-store"}).then(function (response) {
                if (!response.ok) throw new Error("Friis HTTP " + response.status);
                return response.json();
            })
        ]).then(function (data) { cache = data; return data; });
        load.then(function (data) {
            render(buildRows(data[0], data[1]));
            button.textContent = "고도별 수평 도달거리 표 숨기기";
            button.disabled = false;
            setStatus("Sionna/Friis 고도별 -100dBm 경계 수평 도달거리 비교 완료");
        }).catch(function (error) {
            button.textContent = "-100dBm 고도별 수평 도달거리 표";
            button.disabled = false;
            setStatus("고도별 수평 도달거리 표 생성 실패: " + error.message, true);
        });
    }
    function init() {
        var button = $("btn-coverage-distance-table");
        var hideButton = $("btn-coverage-surface-hide");
        if (button) button.addEventListener("click", toggle);
        if (hideButton) hideButton.addEventListener("click", clearLines);
    }
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();
    }
    return {
        altitudeLevels: altitudeLevels,
        minimumHorizontalDistanceM: MIN_HORIZONTAL_DISTANCE_M,
        nearestPointAtAltitude: nearestPointAtAltitude,
        farthestPointAtAltitude: farthestPointAtAltitude,
        minHorizontalDistanceAtAltitude: minHorizontalDistanceAtAltitude,
        minimumPointAtAltitude: minimumPointAtAltitude, maximumPointAtAltitude: maximumPointAtAltitude,
        minimumDistanceAtAltitude: minimumDistanceAtAltitude,
        maximumAltitude: maximumAltitude,
        intersectionSegmentsAtAltitude: intersectionSegmentsAtAltitude,
        buildRows: buildRows,
        formatDistance: formatDistance, formatRange: formatRange, clearLines: clearLines,
        toggle: toggle
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = COVERAGE_SURFACE_COMPARISON;
}
