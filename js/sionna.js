// ============================================================
// Sionna RT 커버리지 예측 표시 모듈
//   - python/run_coverage.py 가 생성한 Data/sionna/sionna_coverage.json 로드
//   - 단말 고도(100~500m)별 수신 전력(dBm)을 지도 위 컬러 포인트로 표시
//   - Cesium 비의존 순수 계산 함수는 node 테스트 가능 (module export)
//   - 전역: window.SIONNA
// ------------------------------------------------------------
var SIONNA = (function () {
    "use strict";

    var DATA_SOURCES = {
        reflected: {
            url: "Data/sionna/sionna_coverage.json",
            label: "평탄 지면 (직접파 + 지면 반사)"
        },
        freeSpace: {
            url: "Data/sionna/sionna_free_space.json",
            label: "자유공간 (Sionna 직접파만)"
        },
        formula: {
            url: "Data/sionna/formula_pathloss.json",
            label: "자유공간 (Friis 수식 · Sionna 미사용)"
        }
    };

    var data = null;            // 로드된 JSON
    var dataBySource = {};       // 환경별 JSON 캐시
    var currentSource = "reflected";
    var collections = {};       // altStr -> Cesium.PointPrimitiveCollection
    var currentAlt = null;      // 화면에 표시 중인 고도
    var loading = false;
    var comparisonSets = null;
    var txMarker = null;        // 기지국 확인용 마커 엔티티
    var displayBaseHeightM = null; // VWorld terrain의 기지국 지표 높이
    var terrainHeightLoading = false;
    var TERRAIN_BASE_FALLBACK_M = 0.0;

    function $(id) { return document.getElementById(id); }


    function dbmToT(v) {
        return (typeof RF_COLOR !== "undefined") ? RF_COLOR.dbmToT(v) : 0;
    }

    function colorForDbm(v) {
        return (typeof RF_COLOR !== "undefined") ? RF_COLOR.colorForDbm(v) : "#9ca3af";
    }

    function dbmToRgb01(v) {
        return (typeof RF_COLOR !== "undefined") ? RF_COLOR.rgb01(v) : [0.61, 0.64, 0.69];
    }

    // 격자점 [[lat,lon,dBm],...] 통계 (threshold 이상 비율 = 커버리지 %)
    function computeStats(points, threshold) {
        if (!points || !points.length) {
            return { count: 0, meanDbm: NaN, minDbm: NaN, maxDbm: NaN, coveragePct: 0 };
        }
        var sum = 0, minV = Infinity, maxV = -Infinity, good = 0;
        for (var i = 0; i < points.length; i++) {
            var v = points[i][2];
            sum += v;
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
            if (v >= threshold) good++;
        }
        return {
            count: points.length,
            meanDbm: sum / points.length,
            minDbm: minV,
            maxDbm: maxV,
            coveragePct: good / points.length * 100
        };
    }

    // 전체 고도 요약 행 목록 [{alt, stats}]
    function summarize(dataObj) {
        var out = [];
        var alts = dataObj.meta.altitudesM || [];
        for (var i = 0; i < alts.length; i++) {
            var g = dataObj.grids[String(alts[i])];
            if (!g) continue;
            out.push({ alt: alts[i], stats: g.stats });
        }
        return out;
    }

    // 동일 고도의 두 환경 통계를 나란히 비교한다.
    function compareDatasets(reflected, freeSpace) {
        var out = [];
        if (!reflected || !freeSpace || !reflected.meta || !freeSpace.meta) return out;
        var alts = reflected.meta.altitudesM || [];
        for (var i = 0; i < alts.length; i++) {
            var key = String(alts[i]);
            var rg = reflected.grids && reflected.grids[key];
            var fg = freeSpace.grids && freeSpace.grids[key];
            if (!rg || !fg || !rg.stats || !fg.stats) continue;
            var deltas = [];
            var groundStronger = 0, freeStronger = 0, equal = 0;
            var pointCount = Math.min(
                rg.points ? rg.points.length : 0,
                fg.points ? fg.points.length : 0
            );
            for (var p = 0; p < pointCount; p++) {
                var rp = rg.points[p], fp = fg.points[p];
                if (!rp || !fp || rp[0] !== fp[0] || rp[1] !== fp[1]) continue;
                var delta = Number(rp[2]) - Number(fp[2]);
                if (!isFinite(delta)) continue;
                deltas.push(delta);
                if (delta > 0.05) groundStronger++;
                else if (delta < -0.05) freeStronger++;
                else equal++;
            }
            deltas.sort(function (a, b) { return a - b; });
            var median = NaN, minDelta = NaN, maxDelta = NaN;
            if (deltas.length) {
                var mid = Math.floor(deltas.length / 2);
                median = deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2;
                minDelta = deltas[0];
                maxDelta = deltas[deltas.length - 1];
            }
            out.push({
                alt: alts[i],
                reflected: rg.stats,
                freeSpace: fg.stats,
                meanDeltaDb: rg.stats.meanDbm - fg.stats.meanDbm,
                medianDeltaDb: median,
                minDeltaDb: minDelta,
                maxDeltaDb: maxDelta,
                pointCount: deltas.length,
                groundStrongerPct: deltas.length ? groundStronger / deltas.length * 100 : 0,
                freeStrongerPct: deltas.length ? freeStronger / deltas.length * 100 : 0,
                equalPct: deltas.length ? equal / deltas.length * 100 : 0
            });
        }
        return out;
    }

    function sourceInfo(key) {
        return DATA_SOURCES[key] || DATA_SOURCES.reflected;
    }

    // ================== 방향별(코리도) 계산 ==================

    // 위경도 → 기지국 기준 ENU 오프셋(m) [동쪽+, 북쪽+]
    function enuOffsetM(bsLat, bsLon, lat, lon) {
        var mPerDegLat = 111320;
        var mPerDegLon = 111320 * Math.cos(bsLat * Math.PI / 180);
        return [(lon - bsLon) * mPerDegLon, (lat - bsLat) * mPerDegLat];
    }

    // 기지국에서 방위각(북=0°, 시계방향) 방향의 일직선 코리도 안의 점만 필터링
    //   along: 기지국으로부터 방향 거리(m), cross: 방향에 수직인 오프셋(m)
    function filterCorridor(points, bsLat, bsLon, azimuthDeg, halfWidthM, maxRangeM) {
        if (!points) return [];
        var az = azimuthDeg * Math.PI / 180;
        var e = Math.sin(az), n = Math.cos(az);   // 방향 단위벡터 (동, 북 성분)
        var out = [];
        for (var i = 0; i < points.length; i++) {
            var en = enuOffsetM(bsLat, bsLon, points[i][0], points[i][1]);
            var along = en[0] * e + en[1] * n;
            var cross = en[0] * n - en[1] * e;
            if (along < 0) continue;                              // 기지국 뒤쪽 제외
            if (maxRangeM > 0 && along > maxRangeM) continue;     // 거리 제한
            if (Math.abs(cross) > halfWidthM) continue;           // 폭 제한
            out.push(points[i]);
        }
        return out;
    }

    // ================== 렌더링 ==================

    function getViewer() {
        return (window.ws3d && window.ws3d.viewer) ? window.ws3d.viewer : null;
    }

    // ---- 모든 RF 레이어가 공유하는 통합 RSRP 범례 ----
    function showLegend() {
        var el = $("legend");
        if (el && typeof RF_COLOR !== "undefined") RF_COLOR.renderLegend(el);
    }

    function hideLegend() {
        // 공통 범례는 다른 RF 레이어에서도 사용하므로 숨기지 않는다.
    }

    function setStatus(msg, isError) {
        var el = $("status");
        if (!el) return;
        el.textContent = msg;
        el.className = isError ? "status error" : "status";
    }

    function clearCollections() {
        var viewer = getViewer();
        if (!viewer || !window.Cesium) return;
        for (var k in collections) {
            if (Object.prototype.hasOwnProperty.call(collections, k)) {
                try { viewer.scene.primitives.remove(collections[k]); } catch (e) { /* 무시 */ }
            }
        }
        collections = {};
        currentAlt = null;
        removeCenterline();
        if (txMarker) {
            try { viewer.entities.remove(txMarker); } catch (e) { /* 무시 */ }
            txMarker = null;
        }
    }

    var mode = "full";          // "full" | "corridor"
    var centerline = null;      // 코리도 중심선 엔티티

    function removeCenterline() {
        var viewer = getViewer();
        if (centerline && viewer) {
            try { viewer.entities.remove(centerline); } catch (e) { /* 무시 */ }
        }
        centerline = null;
    }

    function resolveBaseTerrainHeight(cb) {
        if (displayBaseHeightM !== null) { cb(displayBaseHeightM); return; }
        if (terrainHeightLoading) { setTimeout(function(){ resolveBaseTerrainHeight(cb); }, 100); return; }
        terrainHeightLoading = true;
        var viewer = getViewer();
        var bs = data && data.meta && data.meta.bs;
        function done(h) {
            displayBaseHeightM = isFinite(h) ? Number(h) : TERRAIN_BASE_FALLBACK_M;
            terrainHeightLoading = false;
            cb(displayBaseHeightM);
        }
        if (!viewer || !window.Cesium || !bs) { done(TERRAIN_BASE_FALLBACK_M); return; }
        try {
            var carto = Cesium.Cartographic.fromDegrees(bs.lon, bs.lat);
            if (Cesium.sampleTerrainMostDetailed && viewer.terrainProvider) {
                Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [carto]).then(function (r) {
                    done(r && r[0] && isFinite(r[0].height) ? r[0].height : TERRAIN_BASE_FALLBACK_M);
                }).catch(function () {
                    try { done(viewer.scene.globe.getHeight(carto)); } catch (e2) { done(TERRAIN_BASE_FALLBACK_M); }
                });
            } else {
                done(viewer.scene.globe.getHeight(carto));
            }
        } catch (e) { done(TERRAIN_BASE_FALLBACK_M); }
    }

    function displayHeightForAlt(altStr) {
        return (displayBaseHeightM || 0) + parseFloat(altStr);
    }

    // 실제 cellSizeM x cellSizeM 공간 셀을 RectangleGeometry로 그린다.
    // pixelSize 기반 PointPrimitive를 사용하지 않으므로 줌 레벨에 따라 셀 크기가 변하지 않는다.
    function buildCollection(altStr, ptsOverride) {
        var viewer = getViewer();
        if (!viewer || !window.Cesium || !data) {
            setStatus("지도(Cesium viewer)가 아직 준비되지 않았습니다.", true);
            return null;
        }
        var g = data.grids[altStr];
        var pts = ptsOverride || (g && g.points);
        if (!pts || !pts.length) { setStatus("고도 " + altStr + "m 데이터가 비어 있습니다.", true); return null; }

        var cellM = Number(data.meta.cellSizeM) || 20;
        var half = cellM / 2.0;
        var height = displayHeightForAlt(altStr);
        var instances = new Array(pts.length);
        for (var i = 0; i < pts.length; i++) {
            var lat = Number(pts[i][0]), lon = Number(pts[i][1]), dbm = Number(pts[i][2]);
            var dLat = half / 111320.0;
            var cosLat = Math.cos(lat * Math.PI / 180.0);
            var dLon = half / (111320.0 * Math.max(0.01, Math.abs(cosLat)));
            var c = dbmToRgb01(dbm);
            instances[i] = new Cesium.GeometryInstance({
                geometry: new Cesium.RectangleGeometry({
                    rectangle: Cesium.Rectangle.fromDegrees(lon-dLon, lat-dLat, lon+dLon, lat+dLat),
                    height: height,
                    vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
                }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(new Cesium.Color(c[0],c[1],c[2],0.78))
                }
            });
        }
        var primitive = new Cesium.Primitive({
            geometryInstances: instances,
            appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, flat: true, closed: false }),
            asynchronous: true
        });
        // depth test는 Cesium 기본값을 그대로 사용: 지형 뒤의 셀은 지형에 가려진다.
        viewer.scene.primitives.add(primitive);
        return primitive;
    }

    // 지도(viewer) 로딩 완료를 기다렸다가 콜백 실행 (최대 60초)
    function whenViewerReady(cb) {
        var tries = 0;
        (function poll() {
            var viewer = getViewer();
            if (viewer && window.Cesium) { cb(); return; }
            if (++tries > 120) {
                setStatus("지도(viewer)를 찾을 수 없습니다. 새로고침 후 다시 시도하세요.", true);
                return;
            }
            setTimeout(poll, 500);
        })();
    }

    // 표시된 점들의 위경도 범위로 카메라 이동
    function flyToPoints(ptsList) {
        var viewer = getViewer();
        if (!viewer || !window.Cesium) return;
        try {
            var latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
            for (var i = 0; i < ptsList.length; i++) {
                var p = ptsList[i];
                if (p[0] < latMin) latMin = p[0];
                if (p[0] > latMax) latMax = p[0];
                if (p[1] < lonMin) lonMin = p[1];
                if (p[1] > lonMax) lonMax = p[1];
            }
            if (latMin === Infinity) return;
            viewer.camera.flyTo({
                destination: Cesium.Rectangle.fromDegrees(
                    lonMin - 0.002, latMin - 0.002, lonMax + 0.002, latMax + 0.002)
            });
        } catch (e) { /* 카메라 실패는 무시 */ }
    }

    function ensureTxMarker() {
        try {
            var viewer = getViewer();
            if (!txMarker && viewer && window.Cesium && data) {
                txMarker = viewer.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(data.meta.bs.lon,
                                                            data.meta.bs.lat,
                                                            (displayBaseHeightM || 0) + (data.meta.antennaHeightM || 30)),
                    point: {
                        pixelSize: 18,
                        color: Cesium.Color.YELLOW,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 3,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    }
                });
            }
        } catch (e) { console.error("[SIONNA] marker", e); }
    }

    // 모드 1: 전체 반경 (기존 방식) — 고도 1개 평면 전체 표시
    function showAltitude(altStr) {
        var viewer = getViewer();
        if (!viewer || !data) return;

        mode = "full";
        removeCenterline();
        for (var k in collections) {
            if (Object.prototype.hasOwnProperty.call(collections, k)) {
                try { viewer.scene.primitives.remove(collections[k]); } catch (e) { /* 무시 */ }
            }
        }
        collections = {};

        if (displayBaseHeightM === null) {
            resolveBaseTerrainHeight(function () { showAltitude(altStr); });
            return;
        }
        var col = buildCollection(altStr);
        if (!col) return;
        collections[altStr] = col;
        currentAlt = altStr;
        ensureTxMarker();
        flyToPoints(data.grids[altStr].points);

        setStatus(sourceInfo(currentSource).label + " 표시 [전체 반경]: 단말 고도 " + altStr + "m / 기준 지표 " +
                  displayBaseHeightM.toFixed(1) + "m / 실제 셀 " + data.meta.cellSizeM + "m (" +
                  data.grids[altStr].points.length + "셀)");
    }

    // 모드 2: 방향별 일직선 — 지정 방위각 코리도 + 여러 고도 동시 표시
    function showCorridor() {
        var viewer = getViewer();
        if (!viewer || !data) {
            setStatus("먼저 Sionna 결과를 로드하세요.", true);
            return;
        }
        var az = parseFloat($("sionna-az").value);
        if (isNaN(az)) az = 0;
        var half = parseFloat($("sionna-width").value);
        if (isNaN(half) || half <= 0) half = 50;
        var altList = ($("sionna-alts").value || "").split(",")
            .map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length > 0 && data.grids[s]; });
        if (!altList.length) {
            setStatus("표시할 고도가 없습니다. (예: 100,200,500,2000)", true);
            return;
        }
        if (displayBaseHeightM === null) {
            resolveBaseTerrainHeight(function () { showCorridor(); });
            return;
        }

        mode = "corridor";
        removeCenterline();
        for (var k in collections) {
            if (Object.prototype.hasOwnProperty.call(collections, k)) {
                try { viewer.scene.primitives.remove(collections[k]); } catch (e) { /* 무시 */ }
            }
        }
        collections = {};
        currentAlt = null;
        ensureTxMarker();

        var bs = data.meta.bs;
        var allPts = [];
        var summary = [];
        for (var i = 0; i < altList.length; i++) {
            var src = data.grids[altList[i]].points;
            var pts = filterCorridor(src, bs.lat, bs.lon, az, half, 0);
            if (!pts.length) continue;
            var col = buildCollection(altList[i], pts);
            if (col) collections["c" + altList[i]] = col;
            for (var j = 0; j < pts.length; j++) allPts.push(pts[j]);
            summary.push(altList[i] + "m:" + pts.length + "점");
        }

        // 코리도 중심선 (기지국 → 방위각 방향, 빨간 점선)
        try {
            var maxAlong = 0;
            for (var ip = 0; ip < allPts.length; ip++) {
                var en = enuOffsetM(bs.lat, bs.lon, allPts[ip][0], allPts[ip][1]);
                var azR = az * Math.PI / 180;
                var al = en[0] * Math.sin(azR) + en[1] * Math.cos(azR);
                if (al > maxAlong) maxAlong = al;
            }
            if (maxAlong > 0) {
                var azRad = az * Math.PI / 180;
                var dLat = (maxAlong * Math.cos(azRad)) / 111320;
                var dLon = (maxAlong * Math.sin(azRad)) /
                           (111320 * Math.cos(bs.lat * Math.PI / 180));
                var h = (displayBaseHeightM || 0) + (data.meta.antennaHeightM || 30);
                centerline = viewer.entities.add({
                    polyline: {
                        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
                            bs.lon, bs.lat, h,
                            bs.lon + dLon, bs.lat + dLat, h
                        ]),
                        width: 3,
                        material: new Cesium.PolylineDashMaterialProperty({
                            color: Cesium.Color.RED, dashLength: 16
                        })
                    }
                });
            }
        } catch (e) { console.error("[SIONNA] centerline", e); }

        flyToPoints(allPts);
        setStatus(sourceInfo(currentSource).label + " 표시 [방향별 " + az + "°]: " + summary.join(" · "));
    }

    // ================== 빔패턴 추출 (Sionna RT 예측 기반) ==================
    // 커버리지 격자점을 (방위각 × 고도각) 빈으로 모아 평균 수신전력(dBm)을
    // 상대 패턴(최대 = 0 dB)으로 정규화한 방향 패턴 테이블을 만든다.
    //   - RT 예측이므로 건물 음영/반사 등 환경에 의한 방위별 비대칭이 반영됨
    //   - 빈 간격 5°: az 72빈(360°), el 37빈(-90~+90°)

    var PAT_AZ_STEP = 5;
    var PAT_EL_STEP = 5;
    var PAT_N_AZ = 72;   // 360 / 5
    var PAT_N_EL = 37;   // 180 / 5 + 1
    var PAT_FILL_MIN_DB = -40;   // 데이터 없는 빈 채움 상한(과도한 널 방지)

    function binAzDeg(azDeg) {
        return ((azDeg % 360) + 360) % 360;
    }

    function dataMetaAlt(dataObj) {
        var h = dataObj.meta.antennaHeightM;
        return (typeof h === "number" && !isNaN(h)) ? h : 0;
    }

    // 단일 고도 격자점을 (방위각 × 고도각) 빈에 누적 — extractPattern 헬퍼
    function binOneAltitude(dataObj, bs, bsAlt, altKey) {
        var sum = [], cnt = [];
        for (var i = 0; i < PAT_N_AZ * PAT_N_EL; i++) { sum.push(0); cnt.push(0); }
        var grid = dataObj.grids[String(altKey)];
        var pts = grid && grid.points;
        var used = 0, mn = Infinity, mx = -Infinity;
        if (pts) {
            for (var p = 0; p < pts.length; p++) {
                var lat = pts[p][0], lon = pts[p][1], dbm = pts[p][2];
                if (typeof dbm !== "number" || isNaN(dbm)) continue;
                var en = enuOffsetM(bs.lat, bs.lon, lat, lon);
                var horiz = Math.sqrt(en[0] * en[0] + en[1] * en[1]);
                var el = Math.atan2(parseFloat(altKey) - bsAlt, Math.max(horiz, 0.001)) * 180 / Math.PI;
                el = Math.max(-90, Math.min(90, el));
                var az = Math.atan2(en[0], en[1]) * 180 / Math.PI;   // 북=0, 시계방향
                var ia = Math.floor(binAzDeg(az) / PAT_AZ_STEP) % PAT_N_AZ;
                var ie = Math.round((el + 90) / PAT_EL_STEP);
                if (ie < 0) ie = 0;
                if (ie > PAT_N_EL - 1) ie = PAT_N_EL - 1;
                var bIdx = ia * PAT_N_EL + ie;
                sum[bIdx] += dbm; cnt[bIdx]++;
                used++;
                if (dbm < mn) mn = dbm;
                if (dbm > mx) mx = dbm;
            }
        }
        return { sum: sum, cnt: cnt, used: used, srcMin: mn, srcMax: mx };
    }

    // dataObj: sionna_coverage.json 파싱 결과
    // altList: 사용할 단말 고도 목록(m). null/빈 배열이면 전체 고도 통합
    // opts: { fill: true(기본)=결측 빈 보간 채움(기존 동작) | false=결측 NaN(구멍 처리)
    //         norm: "per"(기본)=선택 고도 최대 기준 | "global"=전체 고도 공통 최대 기준 }
    //   · 단말 고도 평면은 기하학적으로 샘플 가능한 고도각 범위가 제한됨
    //     (예: 2000m 평면 + 5km 그리드 → 고도각 29°~90°만 샘플). fill=false면
    //     이 결측 영역을 임의로 채우지 않고 NaN으로 남겨 렌더링에서 제외한다.
    function extractPattern(dataObj, altList, opts) {
        var fill = !(opts && opts.fill === false);
        var norm = (opts && opts.norm === "global") ? "global" : "per";
        if (!dataObj || !dataObj.meta || !dataObj.meta.bs || !dataObj.grids) return null;
        var bs = dataObj.meta.bs;
        var bsAlt = dataMetaAlt(dataObj);
        var allAlts = dataObj.meta.altitudesM || Object.keys(dataObj.grids);
        var use = [];
        if (typeof altList === "string") altList = [altList];
        if (altList && altList.length) {
            for (var i = 0; i < altList.length; i++) {
                if (dataObj.grids[String(altList[i])]) use.push(String(altList[i]));
            }
        } else {
            for (i = 0; i < allAlts.length; i++) {
                if (dataObj.grids[String(allAlts[i])]) use.push(String(allAlts[i]));
            }
        }
        if (!use.length) return null;

        // 빈별 합/개수 누적 (고도별로 계산 후 합산)
        var sum = [], cnt = [];
        for (i = 0; i < PAT_N_AZ * PAT_N_EL; i++) { sum.push(0); cnt.push(0); }

        var srcMin = Infinity, srcMax = -Infinity, used = 0;
        for (var g2 = 0; g2 < use.length; g2++) {
            var binned = binOneAltitude(dataObj, bs, bsAlt, use[g2]);
            for (var b3 = 0; b3 < sum.length; b3++) {
                sum[b3] += binned.sum[b3];
                cnt[b3] += binned.cnt[b3];
            }
            used += binned.used;
            if (binned.srcMin < srcMin) srcMin = binned.srcMin;
            if (binned.srcMax > srcMax) srcMax = binned.srcMax;
        }
        if (!used || srcMin === Infinity) return null;

        // 빈별 평균 → 최대빈 기준 0dB 정규화
        var gain = [];                 // gain[ia][ie] (dB, 최대 0)
        var meanDbm = [];              // 원본 평균 dBm (참고용)
        var maxMean = -Infinity;
        var ia2, ie2;
        for (ia2 = 0; ia2 < PAT_N_AZ; ia2++) {
            var rowM = [];
            for (ie2 = 0; ie2 < PAT_N_EL; ie2++) {
                var b2 = ia2 * PAT_N_EL + ie2;
                var m = cnt[b2] ? sum[b2] / cnt[b2] : NaN;
                rowM.push(m);
                if (!isNaN(m) && m > maxMean) maxMean = m;
            }
            meanDbm.push(rowM);
        }
        if (!isFinite(maxMean)) return null;

        // 정규화 기준: "per"=선택 고도 내 최대(기존), "global"=전체 고도 통합 최대
        var refDbm = maxMean;
        if (norm === "global") {
            var gMax = -Infinity;
            for (i = 0; i < allAlts.length; i++) {
                if (!dataObj.grids[String(allAlts[i])]) continue;
                var bg = binOneAltitude(dataObj, bs, bsAlt, String(allAlts[i]));
                for (var b4 = 0; b4 < bg.cnt.length; b4++) {
                    if (bg.cnt[b4]) {
                        var m4 = bg.sum[b4] / bg.cnt[b4];
                        if (m4 > gMax) gMax = m4;
                    }
                }
            }
            if (isFinite(gMax)) refDbm = Math.max(refDbm, gMax);
        }

        // 마스크(실측 빈) + 상대 이득. fill=false면 결측 빈을 NaN으로 남겨
        // 렌더링 시 구멍(면 제외) 처리된다.
        var mask = [];
        for (ia2 = 0; ia2 < PAT_N_AZ; ia2++) {
            var rowG = [], rowMask = [];
            for (ie2 = 0; ie2 < PAT_N_EL; ie2++) {
                var b5 = ia2 * PAT_N_EL + ie2;
                var has = cnt[b5] > 0;
                rowMask.push(has);
                rowG.push(has ? Math.max(meanDbm[ia2][ie2] - refDbm, -60) : NaN);
            }
            gain.push(rowG);
            mask.push(rowMask);
        }

        // 동일 각도 빈의 절대 RSRP(dBm). 빔의 형상은 gain, 색상은 dbm을 사용한다.
        var dbm = [];
        for (ia2 = 0; ia2 < PAT_N_AZ; ia2++) {
            dbm.push(meanDbm[ia2].slice(0));
        }

        // 결측 빈 채우기(옵션): 같은 방위 열에서 가장 가까운 유효 고도빈 값,
        // 열 전체가 비면 인접 방위 열 복사 (상한 클램프)
        if (fill) {
            fillMissing(gain);
            fillMissingDbm(dbm, srcMin);
        }

        return {
            azStep: PAT_AZ_STEP,
            elStep: PAT_EL_STEP,
            nAz: PAT_N_AZ,
            nEl: PAT_N_EL,
            gain: gain,
            dbm: dbm,
            mask: mask,
            fill: fill,
            norm: norm,
            normRefDbm: refDbm,
            sampleCount: used,
            altitudes: use.map(Number),
            sourceMinDbm: srcMin,
            sourceMaxDbm: srcMax
        };
    }

    function nearestInCol(col, idx) {
        for (var d = 1; d < col.length; d++) {
            if (idx - d >= 0 && !isNaN(col[idx - d])) return col[idx - d];
            if (idx + d < col.length && !isNaN(col[idx + d])) return col[idx + d];
        }
        return null;
    }

    function copyRow(dst, src) {
        for (var i = 0; i < dst.length; i++) dst[i] = src[i];
    }

    function fillMissing(gain) {
        var ia, ie;
        // 1) 같은 az 열 내 가장 가까운 유효값
        for (ia = 0; ia < PAT_N_AZ; ia++) {
            for (ie = 0; ie < PAT_N_EL; ie++) {
                if (!isNaN(gain[ia][ie])) continue;
                var best = nearestInCol(gain[ia], ie);
                gain[ia][ie] = (best === null) ? PAT_FILL_MIN_DB - 60 : Math.min(best, PAT_FILL_MIN_DB);
            }
        }
        // 2) 열 전체가 결측 → 인접 방위 열 복사
        for (ia = 0; ia < PAT_N_AZ; ia++) {
            if (!isNaN(gain[ia][0])) continue;
            for (var off = 1; off < PAT_N_AZ; off++) {
                var l = (ia - off + PAT_N_AZ) % PAT_N_AZ;
                var r = (ia + off) % PAT_N_AZ;
                if (!isNaN(gain[l][0])) { copyRow(gain[ia], gain[l]); break; }
                if (!isNaN(gain[r][0])) { copyRow(gain[ia], gain[r]); break; }
            }
        }
    }

    function fillMissingDbm(table, fallbackDbm) {
        var ia, ie;
        var fallback = isFinite(fallbackDbm) ? fallbackDbm : -110;
        for (ia = 0; ia < PAT_N_AZ; ia++) {
            for (ie = 0; ie < PAT_N_EL; ie++) {
                if (!isNaN(table[ia][ie])) continue;
                var best = nearestInCol(table[ia], ie);
                table[ia][ie] = (best === null) ? fallback : best;
            }
        }
    }

    // 패턴 테이블 → 값 조회 함수(방위각 래핑 + 이중선형 보간)
    function makeTableFn(pat, table) {
        if (!pat || !table) return null;
        return function (azDeg, elDeg) {
            var azT = binAzDeg(azDeg) / pat.azStep;
            var ia0 = Math.floor(azT) % pat.nAz;
            var ia1 = (ia0 + 1) % pat.nAz;
            var fa = azT - Math.floor(azT);
            var elT = (Math.max(-90, Math.min(90, elDeg)) + 90) / pat.elStep;
            var ie0 = Math.floor(elT);
            if (ie0 > pat.nEl - 2) ie0 = pat.nEl - 2;
            var fe = elT - ie0;
            var g00 = table[ia0][ie0],   g01 = table[ia0][ie0 + 1];
            var g10 = table[ia1][ie0],   g11 = table[ia1][ie0 + 1];
            // 결측 빈(fill=false) 인접 조회는 NaN 반환 → 렌더링에서 제외
            if (isNaN(g00) || isNaN(g01) || isNaN(g10) || isNaN(g11)) return NaN;
            var gx0 = g00 * (1 - fa) + g10 * fa;
            var gx1 = g01 * (1 - fa) + g11 * fa;
            return gx0 * (1 - fe) + gx1 * fe;
        };
    }

    function makeGainFn(pat) {
        return makeTableFn(pat, pat && pat.gain);
    }

    function makeDbmFn(pat) {
        return makeTableFn(pat, pat && pat.dbm);
    }

    // ================== 데이터 로드 (조용한 로딩 지원) ==================

    function hasData() { return !!data; }

    // 로드된 메타 반환 (안테나 설치고도 등 — 빔패턴 하부 볼륨 절단에서 사용)
    function getMeta() { return data ? data.meta : null; }

    // UI 표시 없이 JSON만 확보 (이미 로드돼 있으면 즉시 콜백)
    function fetchSource(sourceKey) {
        var key = DATA_SOURCES[sourceKey] ? sourceKey : "reflected";
        if (dataBySource[key]) return Promise.resolve(dataBySource[key]);
        return fetch(sourceInfo(key).url, {cache: "no-store"}).then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
        }).then(function (json) {
            dataBySource[key] = json;
            return json;
        });
    }

    function activateSource(sourceKey, json) {
        clearCollections();
        currentSource = DATA_SOURCES[sourceKey] ? sourceKey : "reflected";
        data = json;
        patternCache = {};
    }

    function ensureData(cb) {
        var sel = $("sionna-source");
        var key = sel && DATA_SOURCES[sel.value] ? sel.value : currentSource;
        if (data && currentSource === key) { cb(null, data); return; }
        fetchSource(key).then(function (json) {
            activateSource(key, json);
            cb(null, data);
        }).catch(function (err) {
            console.error("[SIONNA]", err);
            cb(err, null);
        });
    }

    // 패턴 추출 캐시 ("all" | "100" | "200", ...)
    var patternCache = {};

    function getPattern(key, opts) {
        if (!data) return null;
        var base = key ? String(key) : "all";
        // 옵션 조합별로 캐시 구분 (표시 방식/정규화 옵션 지원)
        var k = base + "|" + (opts && opts.fill === false ? "nofill" : "fill") +
                "|" + (opts && opts.norm === "global" ? "global" : "per");
        if (Object.prototype.hasOwnProperty.call(patternCache, k)) return patternCache[k];
        var altList = (base === "all") ? null : [base];
        var pat = extractPattern(data, altList, opts);
        patternCache[k] = pat;
        return pat;
    }

    // ================== UI ==================

    function renderResultTable() {
        var box = $("sionna-result");
        if (!box || !data) return;
        var rows = summarize(data);
        var html = '<div class="alt-note"><strong>' + sourceInfo(currentSource).label + '</strong></div>' +
            '<table class="alt-table"><tr>' +
            '<th>단말 고도</th><th>평균 RSRP</th><th>최소</th><th>최대</th>' +
            '</tr>';
        for (var i = 0; i < rows.length; i++) {
            var s = rows[i].stats;
            html += '<tr>' +
                '<td>' + rows[i].alt + 'm</td>' +
                '<td><span class="alt-chip" style="background:' +
                    colorForDbm(s.meanDbm) + '"></span>' + s.meanDbm.toFixed(1) + ' dBm</td>' +
                '<td>' + s.minDbm.toFixed(1) + '</td>' +
                '<td>' + s.maxDbm.toFixed(1) + '</td>' +
                '</tr>';
        }
        html += '</table>';
        html += '<div class="alt-note">' + (data.meta.tool || sourceInfo(currentSource).label) + ' · ' +
            data.meta.frequencyMHz + 'MHz · 총 TX ' +
            data.meta.txPowerDbm + 'dBm · RSRP 기준신호 ' +
            Number(data.meta.rsrpReferencePowerDbm || data.meta.txPowerDbm).toFixed(2) + 'dBm · 안테나 ' + data.meta.antennaMaxGainDbi +
            ' dBi (' + data.meta.antennaModel + ') · 설치고도 ' + data.meta.antennaHeightM +
            'm · 격자 ' + data.meta.cellSizeM + 'm</div>';
        if (data.meta.cableLossDb === undefined) {
            html += '<p class="hint"><strong>참고:</strong> 현재 Sionna 파일은 케이블 손실 1dB 적용 전 결과입니다. 재계산은 추후 지시에 따라 진행합니다.</p>';
        }
        html += '<p class="hint">-100 dBm은 수신 가능률 계산용 보조 판정선이며, 위 절대 RSRP와 색상 범례의 기준값이 아닙니다.</p>';
        box.innerHTML = html;
    }

    function renderComparisonTable(reflected, freeSpace, formula) {
        var box = $("sionna-compare-result");
        if (!box) return;
        var rows = compareDatasets(reflected, freeSpace);
        var formulaRows = compareDatasets(freeSpace, formula);
        if (!rows.length) {
            box.innerHTML = '<p class="hint">비교 가능한 공통 고도 결과가 없습니다.</p>';
            return;
        }
        var pendingLoss = reflected.meta.cableLossDb === undefined || freeSpace.meta.cableLossDb === undefined;
        var html = '<div class="alt-note"><strong>세 모델 절대 RSRP 비교</strong><br>' +
            '평탄=Sionna 반사 포함 · 직접파=Sionna 직접파만' +
            (pendingLoss ? '<br><strong>주의:</strong> Sionna는 케이블 손실 1dB 적용 전 결과이며 Friis만 1dB가 반영되었습니다.' : '') + '</div>' +
            '<div class="alt-table-scroll"><table class="alt-table alt-table-compact">' +
            '<tr><th>고도</th><th>평탄</th><th>직접파</th><th>Friis</th></tr>';
        for (var i = 0; i < rows.length; i++) {
            var formulaMean = formulaRows[i] ? formulaRows[i].freeSpace.meanDbm : NaN;
            html += '<tr><td>' + rows[i].alt + 'm</td>' +
                '<td>' + rows[i].reflected.meanDbm.toFixed(1) + '</td>' +
                '<td>' + rows[i].freeSpace.meanDbm.toFixed(1) + '</td>' +
                '<td>' + (isFinite(formulaMean) ? formulaMean.toFixed(1) : '-') + '</td></tr>';
        }
        var sel = $("sionna-alt");
        var selectedAlt = sel && sel.value ? String(sel.value) : String(rows[0].alt);
        var detail = rows[0];
        for (var j = 0; j < rows.length; j++) {
            if (String(rows[j].alt) === selectedAlt) { detail = rows[j]; break; }
        }
        var formulaDetail = formulaRows[0];
        for (var k = 0; k < formulaRows.length; k++) {
            if (String(formulaRows[k].alt) === selectedAlt) { formulaDetail = formulaRows[k]; break; }
        }
        html += '</table></div><div class="alt-note"><strong>' + detail.alt +
            'm 동일 셀 ' + detail.pointCount + '개</strong><br>' +
            '지면 반사 기여(Sionna 평탄−직접파): 중앙값 ' +
            (detail.medianDeltaDb >= 0 ? '+' : '') + detail.medianDeltaDb.toFixed(1) +
            ' dB · 범위 ' + detail.minDeltaDb.toFixed(1) + ' ~ ' +
            (detail.maxDeltaDb >= 0 ? '+' : '') + detail.maxDeltaDb.toFixed(1) + ' dB<br>' +
            '수식 차이(Sionna 직접파−Friis): 평균 ' +
            (formulaDetail.meanDeltaDb >= 0 ? '+' : '') + formulaDetail.meanDeltaDb.toFixed(1) +
            ' dB · 중앙값 ' + (formulaDetail.medianDeltaDb >= 0 ? '+' : '') +
            formulaDetail.medianDeltaDb.toFixed(1) + ' dB</div>' +
            '<p class="hint">Friis는 Sionna 없이 3차원 거리와 측정 방향이득으로 계산합니다. -100 dBm 판정선은 비교에 사용하지 않습니다.</p>';
        box.innerHTML = html;
    }

    function fillAltSelect() {
        var sel = $("sionna-alt");
        if (!sel || !data) return;
        sel.innerHTML = "";
        var alts = data.meta.altitudesM || [];
        for (var i = 0; i < alts.length; i++) {
            var opt = document.createElement("option");
            opt.value = String(alts[i]);
            opt.textContent = alts[i] + "m";
            sel.appendChild(opt);
        }
    }

    function loadData() {
        var sel = $("sionna-source");
        var requestedSource = sel && DATA_SOURCES[sel.value] ? sel.value : currentSource;
        if (data && currentSource === requestedSource) { onDataReady(); return; }
        if (loading) return;
        loading = true;
        setStatus(sourceInfo(requestedSource).label + " 결과를 불러오는 중...");
        fetchSource(requestedSource).then(function (json) {
            activateSource(requestedSource, json);
            loading = false;
            onDataReady();
        }).catch(function (err) {
            loading = false;
            console.error("[SIONNA]", err);
            setStatus(sourceInfo(requestedSource).label + " 결과 로드 실패: " + err.message +
                      " (서버 실행 및 Data/sionna/ 결과 파일 확인)", true);
        });
    }

    function compareEnvironments() {
        setStatus("평탄 지면과 자유공간 결과를 비교하는 중...");
        Promise.all([
            fetchSource("reflected"), fetchSource("freeSpace"), fetchSource("formula")
        ]).then(function (sets) {
            comparisonSets = sets;
            renderComparisonTable(sets[0], sets[1], sets[2]);
            setStatus("세 전파 모델 절대 RSRP 비교 완료");
        }).catch(function (err) {
            console.error("[SIONNA compare]", err);
            setStatus("환경 비교 실패: " + err.message + " (두 결과 파일을 확인하세요.)", true);
        });
    }

    function onDataReady() {
        whenViewerReady(function () {
            fillAltSelect();
            renderResultTable();
            showLegend();
            var alts = data.meta.altitudesM || [];
            resolveBaseTerrainHeight(function (baseH) {
                if (alts.length) showAltitude(String(alts[0]));
                setStatus(sourceInfo(currentSource).label + " 로드 완료: 단말 고도 " + alts.join("/") + "m · 기준 지표 " + baseH.toFixed(1) + "m");
            });
        });
    }

    function hide() {
        clearCollections();
        hideLegend();
        setStatus("커버리지 예측 숨김");
    }

    function init() {
        var btnLoad = $("btn-sionna-load");
        var btnHide = $("btn-sionna-hide");
        var btnCompare = $("btn-sionna-compare");
        var selSource = $("sionna-source");
        var selAlt = $("sionna-alt");
        var selMode = $("sionna-mode");
        var btnCorr = $("btn-sionna-corridor");
        if (btnLoad) btnLoad.addEventListener("click", loadData);
        if (btnHide) btnHide.addEventListener("click", hide);
        if (btnCompare) btnCompare.addEventListener("click", compareEnvironments);
        if (selSource) {
            selSource.addEventListener("change", function () {
                loadData();
            });
        }
        if (selAlt) {
            selAlt.addEventListener("change", function () {
                if (data) showAltitude(selAlt.value);
                if (comparisonSets) {
                    renderComparisonTable(comparisonSets[0], comparisonSets[1], comparisonSets[2]);
                }
            });
        }
        if (selMode) {
            selMode.addEventListener("change", function () {
                var isCorr = selMode.value === "corridor";
                var ctrl = $("sionna-corridor-ctrl");
                if (ctrl) ctrl.style.display = isCorr ? "block" : "none";
                if (isCorr) showCorridor();
                else if (data) showAltitude(selAlt ? selAlt.value :
                                             String(data.meta.altitudesM[0]));
            });
        }
        if (btnCorr) btnCorr.addEventListener("click", showCorridor);
        // 방위각 빠른 설정 버튼 (북/동/남/서)
        var azQuick = [["az-n", 0], ["az-e", 90], ["az-s", 180], ["az-w", 270]];
        for (var q = 0; q < azQuick.length; q++) {
            (function (id, deg) {
                var b = $(id);
                if (!b) return;
                b.addEventListener("click", function () {
                    var inp = $("sionna-az");
                    if (inp) inp.value = String(deg);
                    if (data && mode === "corridor") showCorridor();
                });
            })(azQuick[q][0], azQuick[q][1]);
        }
    }

    if (typeof document !== "undefined") {   // 브라우저에서만 UI 초기화
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }

    return {
        loadData: loadData,
        hide: hide,
        showAltitude: showAltitude,
        showCorridor: showCorridor,
        dbmToT: dbmToT,
        colorForDbm: colorForDbm,
        dbmToRgb01: dbmToRgb01,
        computeStats: computeStats,
        summarize: summarize,
        compareDatasets: compareDatasets,
        enuOffsetM: enuOffsetM,
        filterCorridor: filterCorridor,
        extractPattern: extractPattern,
        makeGainFn: makeGainFn,
        makeDbmFn: makeDbmFn,
        hasData: hasData,
        getMeta: getMeta,
        ensureData: ensureData,
        getPattern: getPattern
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = SIONNA;
}
