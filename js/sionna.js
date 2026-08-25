// ============================================================
// Sionna RT 커버리지 예측 표시 모듈
//   - python/run_coverage.py 가 생성한 Data/sionna/sionna_coverage.json 로드
//   - 단말 고도(100~500m)별 수신 전력(dBm)을 지도 위 컬러 포인트로 표시
//   - Cesium 비의존 순수 계산 함수는 node 테스트 가능 (module export)
//   - 전역: window.SIONNA
// ------------------------------------------------------------
var SIONNA = (function () {
    "use strict";

    var DATA_URL = "Data/sionna/sionna_coverage.json";

    var data = null;            // 로드된 JSON
    var collections = {};       // altStr -> Cesium.PointPrimitiveCollection
    var currentAlt = null;      // 화면에 표시 중인 고도
    var loading = false;
    var txMarker = null;        // 기지국 확인용 마커 엔티티


    // RSRP 색상: 기존 RF 범례와 동일한 10dB 단위 이산 색상 (초록=강함 → 빨강=약함)
    var SIONNA_BINS = [
        { lo: -100, hi: -90, hue: 0,   light: 50 },   // 빨강
        { lo: -90,  hi: -80, hue: 30,  light: 50 },   // 주황
        { lo: -80,  hi: -70, hue: 60,  light: 50 },   // 노랑
        { lo: -70,  hi: -60, hue: 90,  light: 50 },   // 연두
        { lo: -60,  hi: -50, hue: 120, light: 50 },   // 초록
        { lo: -50,  hi: -40, hue: 120, light: 62 }    // 밝은 초록 (최강)
    ];

    function binForDbm(v) {
        if (v >= SIONNA_BINS[SIONNA_BINS.length - 1].lo) {
            return SIONNA_BINS[SIONNA_BINS.length - 1];   // -50 이상 → 최강
        }
        for (var i = 0; i < SIONNA_BINS.length; i++) {
            if (v >= SIONNA_BINS[i].lo && v < SIONNA_BINS[i].hi) return SIONNA_BINS[i];
        }
        return SIONNA_BINS[0];                            // -100 미만 → 최약(빨강)
    }

    function $(id) { return document.getElementById(id); }

    // dBm → 0..1 정규화 (0=최강, 1=최약, 범위 백 클램프) — 하위 호환 유지
    function dbmToT(v) {
        var strong = -40, weak = -100;
        var t = (strong - v) / (strong - weak);
        return Math.max(0, Math.min(1, t));
    }

    // RSRP → 이산 bin 색상 (10dB 단위, 기존 RF 범례와 동일 팔레트)
    function colorForDbm(v) {
        var b = binForDbm(v);
        return "hsl(" + b.hue + ",78%," + b.light + "%)";
    }

    // Cesium Color [r,g,b] 생성용 (colorForDbm과 동일 색상, 0..1 반환)
    function dbmToRgb01(v) {
        var b = binForDbm(v);
        var h = b.hue / 360;
        var s = 0.78, l = b.light / 100;
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        function hue2rgb(pp, qq, hh) {
            if (hh < 0) hh += 1;
            if (hh > 1) hh -= 1;
            if (hh < 1 / 6) return pp + (qq - pp) * 6 * hh;
            if (hh < 1 / 2) return qq;
            if (hh < 2 / 3) return pp + (qq - pp) * (2 / 3 - hh) * 6;
            return pp;
        }
        return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
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

    // ---- 범례 (왼쪽 하단, 기존 RF 범례와 동일한 10단위 격자 형태) ----
    function showLegend() {
        var el = $("sionna-legend");
        if (!el) return;
        var html = '<div class="sl-title">Sionna RSRP 범례 (dBm · 10단위)</div>';
        for (var i = SIONNA_BINS.length - 1; i >= 0; i--) {
            var b = SIONNA_BINS[i];
            var c = colorForDbm(b.lo);
            html += '<div class="sl-row">' +
                    '<span class="sl-swatch" style="background:' + c + '"></span>' +
                    b.lo + ' 이상 ~ ' + b.hi + ' 미만' +
                    '</div>';
        }
        html += '<div class="sl-bs"><span class="sl-dot"></span>기지국 (측정 패턴 · RT 예측)</div>';
        el.innerHTML = html;
        el.style.display = "block";
    }

    function hideLegend() {
        var el = $("sionna-legend");
        if (el) el.style.display = "none";
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

    function buildCollection(altStr, ptsOverride) {
        var viewer = getViewer();
        if (!viewer || !window.Cesium || !data) {
            setStatus("지도(Cesium viewer)가 아직 준비되지 않았습니다.", true);
            return null;
        }
        var g = data.grids[altStr];
        var pts = ptsOverride || (g && g.points);
        if (!pts || !pts.length) {
            setStatus("고도 " + altStr + "m 데이터가 비어 있습니다.", true);
            return null;
        }
        var col = new Cesium.PointPrimitiveCollection();
        for (var i = 0; i < pts.length; i++) {
            var c = dbmToRgb01(pts[i][2]);
            col.add({
                position: Cesium.Cartesian3.fromDegrees(pts[i][1], pts[i][0],
                                                        parseFloat(altStr)),
                pixelSize: 9,
                color: new Cesium.Color(c[0], c[1], c[2], 0.95),
                // 지형/건물에 가려지지 않고 항상 위에 그림 (구릉지대 커버리지 확인용)
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            });
        }
        viewer.scene.primitives.add(col);
        return col;
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
                                                            data.meta.antennaHeightM || 30),
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

        var col = buildCollection(altStr);
        if (!col) return;
        collections[altStr] = col;
        currentAlt = altStr;
        ensureTxMarker();
        flyToPoints(data.grids[altStr].points);

        setStatus("Sionna 예측 표시 [전체 반경]: 단말 고도 " + altStr + "m (" +
                  data.grids[altStr].points.length + "점)");
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
                var h = data.meta.antennaHeightM || 30;
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
        setStatus("Sionna 예측 표시 [방향별 " + az + "°]: " + summary.join(" · "));
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

    // dataObj: sionna_coverage.json 파싱 결과
    // altList: 사용할 단말 고도 목록(m). null/빈 배열이면 전체 고도 통합
    function extractPattern(dataObj, altList) {
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

        // 빈별 합/개수 누적
        var sum = [], cnt = [];
        for (i = 0; i < PAT_N_AZ * PAT_N_EL; i++) { sum.push(0); cnt.push(0); }

        var srcMin = Infinity, srcMax = -Infinity, used = 0;
        for (var g2 = 0; g2 < use.length; g2++) {
            var grid = dataObj.grids[use[g2]];
            var pts = grid && grid.points;
            if (!pts) continue;
            used += pts.length;
            for (var p = 0; p < pts.length; p++) {
                var lat = pts[p][0], lon = pts[p][1], dbm = pts[p][2];
                if (typeof dbm !== "number" || isNaN(dbm)) continue;
                var en = enuOffsetM(bs.lat, bs.lon, lat, lon);
                var horiz = Math.sqrt(en[0] * en[0] + en[1] * en[1]);
                var el = Math.atan2(parseFloat(use[g2]) - bsAlt, Math.max(horiz, 0.001)) * 180 / Math.PI;
                el = Math.max(-90, Math.min(90, el));
                var az = Math.atan2(en[0], en[1]) * 180 / Math.PI;   // 북=0, 시계방향
                var ia = Math.floor(binAzDeg(az) / PAT_AZ_STEP) % PAT_N_AZ;
                var ie = Math.round((el + 90) / PAT_EL_STEP);
                if (ie < 0) ie = 0;
                if (ie > PAT_N_EL - 1) ie = PAT_N_EL - 1;
                var bIdx = ia * PAT_N_EL + ie;
                sum[bIdx] += dbm; cnt[bIdx]++;
                if (dbm < srcMin) srcMin = dbm;
                if (dbm > srcMax) srcMax = dbm;
            }
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

        for (ia2 = 0; ia2 < PAT_N_AZ; ia2++) {
            var rowG = [];
            for (ie2 = 0; ie2 < PAT_N_EL; ie2++) {
                var m2 = meanDbm[ia2][ie2];
                rowG.push(isNaN(m2) ? NaN : Math.max(m2 - maxMean, -60));
            }
            gain.push(rowG);
        }

        // 결측 빈 채우기: 같은 방위 열에서 가장 가까운 유효 고도빈 값,
        // 열 전체가 비면 인접 방위 열 복사 (상한 클램프)
        fillMissing(gain);

        return {
            azStep: PAT_AZ_STEP,
            elStep: PAT_EL_STEP,
            nAz: PAT_N_AZ,
            nEl: PAT_N_EL,
            gain: gain,
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

    // 패턴 테이블 → 이득 조회 함수(방위각 래핑 + 이중선형 보간)
    function makeGainFn(pat) {
        if (!pat || !pat.gain) return null;
        return function (azDeg, elDeg) {
            var azT = binAzDeg(azDeg) / pat.azStep;
            var ia0 = Math.floor(azT) % pat.nAz;
            var ia1 = (ia0 + 1) % pat.nAz;
            var fa = azT - Math.floor(azT);
            var elT = (Math.max(-90, Math.min(90, elDeg)) + 90) / pat.elStep;
            var ie0 = Math.floor(elT);
            if (ie0 > pat.nEl - 2) ie0 = pat.nEl - 2;
            var fe = elT - ie0;
            var g00 = pat.gain[ia0][ie0],   g01 = pat.gain[ia0][ie0 + 1];
            var g10 = pat.gain[ia1][ie0],   g11 = pat.gain[ia1][ie0 + 1];
            var gx0 = g00 * (1 - fa) + g10 * fa;
            var gx1 = g01 * (1 - fa) + g11 * fa;
            return gx0 * (1 - fe) + gx1 * fe;
        };
    }

    // ================== 데이터 로드 (조용한 로딩 지원) ==================

    function hasData() { return !!data; }

    // UI 표시 없이 JSON만 확보 (이미 로드돼 있으면 즉시 콜백)
    function ensureData(cb) {
        if (data) { cb(null, data); return; }
        fetch(DATA_URL).then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
        }).then(function (json) {
            data = json;
            cb(null, data);
        }).catch(function (err) {
            console.error("[SIONNA]", err);
            cb(err, null);
        });
    }

    // 패턴 추출 캐시 ("all" | "100" | "200", ...)
    var patternCache = {};

    function getPattern(key) {
        if (!data) return null;
        var k = key ? String(key) : "all";
        if (Object.prototype.hasOwnProperty.call(patternCache, k)) return patternCache[k];
        var altList = (k === "all") ? null : [k];
        var pat = extractPattern(data, altList);
        patternCache[k] = pat;
        return pat;
    }

    // ================== UI ==================

    function renderResultTable() {
        var box = $("sionna-result");
        if (!box || !data) return;
        var th = data.meta.coverageThresholdDbm;
        var rows = summarize(data);
        var html = '<table class="alt-table"><tr>' +
            '<th>단말 고도</th><th>평균 RSRP</th><th>최소</th><th>≥' + th + 'dBm</th>' +
            '</tr>';
        for (var i = 0; i < rows.length; i++) {
            var s = rows[i].stats;
            html += '<tr>' +
                '<td>' + rows[i].alt + 'm</td>' +
                '<td><span class="alt-chip" style="background:' +
                    colorForDbm(s.meanDbm) + '"></span>' + s.meanDbm.toFixed(1) + ' dBm</td>' +
                '<td>' + s.minDbm.toFixed(1) + '</td>' +
                '<td>' + s.coveragePct.toFixed(1) + '%</td>' +
                '</tr>';
        }
        html += '</table>';
        html += '<div class="alt-note">Sionna RT · ' + data.meta.frequencyMHz + 'MHz · TX ' +
            data.meta.txPowerDbm + 'dBm · 안테나 ' + data.meta.antennaMaxGainDbi +
            ' dBi (' + data.meta.antennaModel + ') · 설치고도 ' + data.meta.antennaHeightM +
            'm · 격자 ' + data.meta.cellSizeM + 'm</div>';
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
        if (data) { onDataReady(); return; }
        if (loading) return;
        loading = true;
        setStatus("Sionna 예측 결과를 불러오는 중...");
        fetch(DATA_URL).then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
        }).then(function (json) {
            data = json;
            loading = false;
            onDataReady();
        }).catch(function (err) {
            loading = false;
            console.error("[SIONNA]", err);
            setStatus("Sionna 결과 로드 실패: " + err.message +
                      " (서버 실행 및 Data/sionna/sionna_coverage.json 확인)", true);
        });
    }

    function onDataReady() {
        whenViewerReady(function () {
            fillAltSelect();
            renderResultTable();
            showLegend();
            var alts = data.meta.altitudesM || [];
            if (alts.length) showAltitude(String(alts[0]));
            setStatus("Sionna 예측 로드 완료: 단말 고도 " + alts.join("/") + "m");
        });
    }

    function hide() {
        clearCollections();
        hideLegend();
        setStatus("Sionna 예측 숨김");
    }

    function init() {
        var btnLoad = $("btn-sionna-load");
        var btnHide = $("btn-sionna-hide");
        var selAlt = $("sionna-alt");
        var selMode = $("sionna-mode");
        var btnCorr = $("btn-sionna-corridor");
        if (btnLoad) btnLoad.addEventListener("click", loadData);
        if (btnHide) btnHide.addEventListener("click", hide);
        if (selAlt) {
            selAlt.addEventListener("change", function () {
                if (data) showAltitude(selAlt.value);
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
        enuOffsetM: enuOffsetM,
        filterCorridor: filterCorridor,
        extractPattern: extractPattern,
        makeGainFn: makeGainFn,
        hasData: hasData,
        ensureData: ensureData,
        getPattern: getPattern
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = SIONNA;
}




