// ============================================================
// 빔패턴 모듈: 260827 이중 야기 + 옴니 합성 패턴
//   - Cesium 비의존 순수 계산 모듈 (node 테스트 가능)
//   - 전역: window.BEAMPATTERN
// ------------------------------------------------------------
// 패턴 특성 (260827_pattern.xlsx / 야기+옴니 시트 기준):
//   · Python pattern_loader.py와 같은 +theta/-theta linear-power 평균 사용
//   · Azimuth는 야기+옴니 시트의 수평 패턴을 사용
//   · 아래 테이블은 theta(0=천정, 90=수평, 180=저면)의 상대이득
//   · run_coverage.py가 생성한 antenna_pattern.json이 있으면 브라우저에서 자동 동기화
// ============================================================
var BEAMPATTERN = (function () {
    "use strict";

    // theta(°): 0=천정, 90=수평, 180=저면
    // gain(dB): 상대이득, 최대=0 dB
    var BEAM_TABLE = [
        [0, -33.2407],
        [1, -32.2622],
        [2, -30.2870],
        [3, -28.2773],
        [4, -26.4142],
        [5, -24.8118],
        [6, -23.5093],
        [7, -22.3236],
        [8, -21.3713],
        [9, -20.4600],
        [10, -19.7224],
        [11, -19.0194],
        [12, -18.3833],
        [13, -17.8242],
        [14, -17.3297],
        [15, -16.9094],
        [16, -16.5419],
        [17, -16.2461],
        [18, -16.0098],
        [19, -15.8033],
        [20, -15.5982],
        [21, -15.3774],
        [22, -15.1220],
        [23, -14.8443],
        [24, -14.5450],
        [25, -14.2355],
        [26, -13.9359],
        [27, -13.6142],
        [28, -13.3352],
        [29, -13.1093],
        [30, -12.9908],
        [31, -12.9747],
        [32, -13.0216],
        [33, -13.1309],
        [34, -13.3164],
        [35, -13.5869],
        [36, -13.9714],
        [37, -14.4223],
        [38, -14.9740],
        [39, -15.5412],
        [40, -16.2017],
        [41, -16.8645],
        [42, -17.6806],
        [43, -18.4852],
        [44, -19.3898],
        [45, -20.1022],
        [46, -20.8934],
        [47, -21.4232],
        [48, -21.6496],
        [49, -21.4468],
        [50, -21.1532],
        [51, -20.9013],
        [52, -20.4771],
        [53, -19.9721],
        [54, -19.4181],
        [55, -18.8736],
        [56, -17.9821],
        [57, -16.8835],
        [58, -15.6273],
        [59, -14.4509],
        [60, -13.3132],
        [61, -12.2458],
        [62, -11.2341],
        [63, -10.3150],
        [64, -9.3796],
        [65, -8.5304],
        [66, -7.6412],
        [67, -6.8450],
        [68, -6.0959],
        [69, -5.4458],
        [70, -4.8690],
        [71, -4.3257],
        [72, -3.8117],
        [73, -3.3694],
        [74, -2.9822],
        [75, -2.6291],
        [76, -2.2898],
        [77, -1.9751],
        [78, -1.6953],
        [79, -1.4451],
        [80, -1.2047],
        [81, -0.9742],
        [82, -0.7536],
        [83, -0.5578],
        [84, -0.4033],
        [85, -0.2645],
        [86, -0.1454],
        [87, -0.0606],
        [88, -0.0257],
        [89, -0.0254],
        [90, 0.0000],
        [91, -0.0281],
        [92, -0.0470],
        [93, -0.0857],
        [94, -0.1730],
        [95, -0.2950],
        [96, -0.4566],
        [97, -0.6304],
        [98, -0.8258],
        [99, -1.0412],
        [100, -1.2912],
        [101, -1.5528],
        [102, -1.8257],
        [103, -2.1535],
        [104, -2.5883],
        [105, -3.0877],
        [106, -3.6211],
        [107, -4.1341],
        [108, -4.6999],
        [109, -5.3099],
        [110, -6.0083],
        [111, -6.7277],
        [112, -7.5636],
        [113, -8.4485],
        [114, -9.4080],
        [115, -10.4834],
        [116, -11.6677],
        [117, -13.0676],
        [118, -14.5089],
        [119, -16.0324],
        [120, -17.6004],
        [121, -18.8711],
        [122, -19.2762],
        [123, -18.8455],
        [124, -18.0385],
        [125, -17.0596],
        [126, -16.1504],
        [127, -15.3899],
        [128, -14.9128],
        [129, -14.4909],
        [130, -14.1016],
        [131, -13.8078],
        [132, -13.5960],
        [133, -13.4547],
        [134, -13.3180],
        [135, -13.1828],
        [136, -13.0321],
        [137, -12.8619],
        [138, -12.6728],
        [139, -12.5304],
        [140, -12.4856],
        [141, -12.5040],
        [142, -12.5475],
        [143, -12.6180],
        [144, -12.6559],
        [145, -12.7352],
        [146, -12.8296],
        [147, -12.9755],
        [148, -13.1233],
        [149, -13.2623],
        [150, -13.3457],
        [151, -13.4070],
        [152, -13.4552],
        [153, -13.5422],
        [154, -13.6536],
        [155, -13.8296],
        [156, -13.9955],
        [157, -14.2157],
        [158, -14.4057],
        [159, -14.6504],
        [160, -14.9339],
        [161, -15.2557],
        [162, -15.6177],
        [163, -16.0170],
        [164, -16.4683],
        [165, -16.9441],
        [166, -17.4499],
        [167, -18.0114],
        [168, -18.5885],
        [169, -19.2700],
        [170, -20.0304],
        [171, -20.9155],
        [172, -21.8845],
        [173, -23.0357],
        [174, -24.2996],
        [175, -25.7921],
        [176, -27.3580],
        [177, -29.2928],
        [178, -31.4554],
        [179, -33.5064],
        [180, -34.5907]
    ];

    // JSON을 읽기 전에도 이전 안테나 형상을 노출하지 않도록 새 패턴의
    // 핵심점으로 1° fallback 표를 만든다. JSON 로드 후에는 원본 1° 값으로 교체된다.
    var FALLBACK_VERTICAL = [
        [0, -0.0123], [7, 0], [10, -0.0103], [20, -0.381], [30, -1.5308],
        [40, -3.6599], [50, -6.2233], [60, -8.3045], [70, -6.9984],
        [80, -3.4399], [90, -2.1309], [100, -3.8544], [110, -9.4471],
        [120, -18.0483], [130, -13.8136], [140, -14.0468], [150, -13.3195],
        [160, -16.043], [170, -19.4647], [180, -22.8429]
    ];
    for (var fallbackTheta = 0; fallbackTheta <= 180; fallbackTheta++) {
        var fallbackIndex = 0;
        while (fallbackIndex + 1 < FALLBACK_VERTICAL.length &&
               FALLBACK_VERTICAL[fallbackIndex + 1][0] < fallbackTheta) fallbackIndex++;
        var fallbackNext = Math.min(FALLBACK_VERTICAL.length - 1, fallbackIndex + 1);
        var fallbackA = FALLBACK_VERTICAL[fallbackIndex];
        var fallbackB = FALLBACK_VERTICAL[fallbackNext];
        var fallbackRatio = fallbackA[0] === fallbackB[0]
            ? 0 : (fallbackTheta - fallbackA[0]) / (fallbackB[0] - fallbackA[0]);
        BEAM_TABLE[fallbackTheta] = [
            fallbackTheta,
            fallbackA[1] * (1 - fallbackRatio) + fallbackB[1] * fallbackRatio
        ];
    }

    // 측정 H-Plane 상대이득. JSON 로드 전에는 방위 무관 0dB로 안전하게 시작한다.
    var HORIZONTAL_TABLE = [
        [-180, -0.413], [-150, -2.807], [-120, -6.205], [-90, -0.414],
        [-89, 0], [-60, -1.537], [-30, -3.671], [0, -3.674], [30, -3.716],
        [60, -1.334], [90, -0.405], [120, -6.536], [150, -2.383], [180, -0.413]
    ];
    var PATTERN_META = {
        model: "이중 야기 + 옴니 (260827)",
        configuration: "dual Yagi + omni",
        sourceFile: "260827_pattern.xlsx",
        sourceSheet: "야기+옴니",
        frequencyMHz: 910,
        maxGainDbi: 7.2,
        approximation: "dual Yagi + omni measured H/V separable 3D"
    };

    var WGS84_A = 6378137.0;                 // 장반경 (m)
    var WGS84_E2 = 6.69437999014e-3;         // 제1이심률 제곱

    function toRad(deg) { return deg * Math.PI / 180; }

    // el: 세계/안테나 좌표계 고도각. 0=수평, +90=천정, -90=저면
    // Sionna theta = 90 - elevation
    function gainAtElevation(elDeg) {
        var theta = Math.max(0, Math.min(180, 90 - Number(elDeg)));
        var i0 = Math.floor(theta);
        var i1 = Math.min(180, i0 + 1);
        var f = theta - i0;
        var g0 = BEAM_TABLE[i0][1], g1 = BEAM_TABLE[i1][1];
        return g0 * (1 - f) + g1 * f;
    }

    function horizontalGainAtAzimuth(azDeg) {
        var az = ((Number(azDeg) + 180) % 360 + 360) % 360 - 180;
        var table = HORIZONTAL_TABLE;
        if (!table || table.length < 2) return 0;
        var i0 = 0;
        while (i0 + 1 < table.length && table[i0 + 1][0] < az) i0++;
        var i1 = Math.min(table.length - 1, i0 + 1);
        var x0 = table[i0][0], x1 = table[i1][0];
        var y0 = table[i0][1], y1 = table[i1][1];
        var f = (x1 === x0) ? 0 : (az - x0) / (x1 - x0);
        return y0 * (1 - f) + y1 * f;
    }

    // 측정된 두 2D cut을 separable 3D로 합성한 안테나 고유 상대이득.
    function gainAtDirection(azDeg, elDeg) {
        return gainAtElevation(elDeg) + horizontalGainAtAzimuth(azDeg);
    }

    function setThetaPattern(thetaDeg, relativeGainDb) {
        if (!thetaDeg || !relativeGainDb || thetaDeg.length !== relativeGainDb.length || thetaDeg.length < 2) return false;
        var table = [];
        for (var t = 0; t <= 180; t++) {
            var j = 0;
            while (j + 1 < thetaDeg.length && thetaDeg[j + 1] < t) j++;
            var j2 = Math.min(thetaDeg.length - 1, j + 1);
            var x0 = Number(thetaDeg[j]), x1 = Number(thetaDeg[j2]);
            var y0 = Number(relativeGainDb[j]), y1 = Number(relativeGainDb[j2]);
            var q = (x1 === x0) ? 0 : (t - x0) / (x1 - x0);
            table.push([t, y0 * (1 - q) + y1 * q]);
        }
        BEAM_TABLE.length = 0;
        for (var k = 0; k < table.length; k++) BEAM_TABLE.push(table[k]);
        return true;
    }

    function setHorizontalPattern(phiDeg, relativeGainDb) {
        if (!phiDeg || !relativeGainDb || phiDeg.length !== relativeGainDb.length || phiDeg.length < 2) return false;
        var pairs = [];
        for (var i = 0; i < phiDeg.length; i++) {
            var x = Number(phiDeg[i]), y = Number(relativeGainDb[i]);
            if (!isFinite(x) || !isFinite(y)) continue;
            pairs.push([x, y]);
        }
        pairs.sort(function (a, b) { return a[0] - b[0]; });
        if (pairs.length < 2) return false;
        HORIZONTAL_TABLE.length = 0;
        for (i = 0; i < pairs.length; i++) HORIZONTAL_TABLE.push(pairs[i]);
        return true;
    }

    function getPatternMeta() {
        return {
            model: PATTERN_META.model,
            configuration: PATTERN_META.configuration,
            sourceFile: PATTERN_META.sourceFile,
            sourceSheet: PATTERN_META.sourceSheet,
            frequencyMHz: PATTERN_META.frequencyMHz,
            maxGainDbi: PATTERN_META.maxGainDbi,
            approximation: PATTERN_META.approximation
        };
    }

    function loadPatternJson(url, cb) {
        if (typeof fetch === "undefined") { if (cb) cb(new Error("fetch unavailable")); return; }
        fetch(url || "Data/sionna/antenna_pattern.json", {cache: "no-store"})
            .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
            .then(function (j) {
                var vertical = j.verticalRelativeGainDb || j.relativeGainDb;
                if (!setThetaPattern(j.thetaDeg, vertical)) throw new Error("invalid antenna pattern JSON");
                if (j.phiDeg && j.horizontalRelativeGainDb) {
                    if (!setHorizontalPattern(j.phiDeg, j.horizontalRelativeGainDb)) {
                        throw new Error("invalid horizontal antenna pattern JSON");
                    }
                }
                PATTERN_META.model = j.model || PATTERN_META.model;
                PATTERN_META.configuration = j.configuration || PATTERN_META.configuration;
                PATTERN_META.sourceFile = j.sourceFile || PATTERN_META.sourceFile;
                PATTERN_META.sourceSheet = j.sourceSheet || PATTERN_META.sourceSheet;
                PATTERN_META.frequencyMHz = Number(j.frequencyMHz) || PATTERN_META.frequencyMHz;
                PATTERN_META.maxGainDbi = Number(j.maxGainDbi);
                if (!isFinite(PATTERN_META.maxGainDbi)) PATTERN_META.maxGainDbi = 7.2;
                PATTERN_META.approximation = j.approximation || PATTERN_META.approximation;
                if (cb) cb(null, j);
            })
            .catch(function (e) { if (cb) cb(e); });
    }

    // WGS84 측지좌표 → ECEF, 로컬 ENU 오프셋(m) 적용
    function enuToEcef(lonDeg, latDeg, hMeters, e, n, u) {
        var lon = toRad(lonDeg), lat = toRad(latDeg);
        var sLat = Math.sin(lat), cLat = Math.cos(lat);
        var sLon = Math.sin(lon), cLon = Math.cos(lon);
        var N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sLat * sLat);
        var x = (N + hMeters) * cLat * cLon;
        var y = (N + hMeters) * cLat * sLon;
        var z = (N * (1 - WGS84_E2) + hMeters) * sLat;
        return {
            x: x + (-sLon) * e + (-sLat * cLon) * n + (cLat * cLon) * u,
            y: y + (cLon) * e + (-sLat * sLon) * n + (cLat * sLon) * u,
            z: z + 0 * e + (cLat) * n + (sLat) * u
        };
    }

    // 3변수 최소제곱: y = c0 + c1*x1 + c2*x2 (정방정식 + 가우스 소거)
    // 반환 {c0,c1,c2} 또는 null(특이행렬)
    function solveOLS3(x1s, x2s, ys) {
        var count = x1s.length;
        if (count < 3 || x2s.length !== count || ys.length !== count) return null;
        var s0 = count, s1 = 0, s2 = 0, s11 = 0, s12 = 0, s22 = 0;
        var t0 = 0, t1 = 0, t2 = 0;
        for (var i = 0; i < count; i++) {
            var x1 = x1s[i], x2 = x2s[i], y = ys[i];
            s1 += x1; s2 += x2;
            s11 += x1 * x1; s12 += x1 * x2; s22 += x2 * x2;
            t0 += y; t1 += x1 * y; t2 += x2 * y;
        }
        // 정규행렬 A·c = b
        var A = [
            [s0,  s1,  s2 ],
            [s1,  s11, s12],
            [s2,  s12, s22]
        ];
        var b = [t0, t1, t2];
        // 가우스 소거(부분 피벗)
        for (var col = 0; col < 3; col++) {
            var piv = col;
            for (var r = col + 1; r < 3; r++) {
                if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
            }
            if (Math.abs(A[piv][col]) < 1e-10) return null;
            if (piv !== col) {
                var tmpR = A[piv]; A[piv] = A[col]; A[col] = tmpR;
                var tmpB = b[piv]; b[piv] = b[col]; b[col] = tmpB;
            }
            for (r = col + 1; r < 3; r++) {
                var f2 = A[r][col] / A[col][col];
                for (var c2 = col; c2 < 3; c2++) A[r][c2] -= f2 * A[col][c2];
                b[r] -= f2 * b[col];
            }
        }
        var sol = [0, 0, 0];
        for (var row = 2; row >= 0; row--) {
            var sum = b[row];
            for (var j = row + 1; j < 3; j++) sum -= A[row][j] * sol[j];
            sol[row] = sum / A[row][row];
        }
        return { c0: sol[0], c1: sol[1], c2: sol[2] };
    }

    // 2변수 최소제곱: y = c0 + c1*x1
    function solveOLS2(x1s, ys) {
        var count = x1s.length;
        if (count < 2 || ys.length !== count) return null;
        var sx = 0, sy = 0, sxy = 0, sxx = 0;
        for (var i = 0; i < count; i++) {
            sx += x1s[i]; sy += ys[i];
            sxy += x1s[i] * ys[i]; sxx += x1s[i] * x1s[i];
        }
        var denom = count * sxx - sx * sx;
        if (Math.abs(denom) < 1e-10) return null;
        var c1 = (count * sxy - sx * sy) / denom;
        var c0 = (sy - c1 * sx) / count;
        return { c0: c0, c1: c1 };
    }

    // 컬러맵: t∈[0,1] → {r,g,b} 0..255 (파랑→시안→초록→노랑→빨강)
    function jetColor(t) {
        t = Math.max(0, Math.min(1, t));
        var seg = t * 4;               // 4구간
        var i = Math.min(3, Math.floor(seg));
        var f = seg - i;
        var r = 0, g = 0, b = 0;
        if (i === 0)      { r = 0;           g = f * 255;       b = 255; }
        else if (i === 1) { r = 0;           g = 255;           b = (1 - f) * 255; }
        else if (i === 2) { r = f * 255;     g = 255;           b = 0; }
        else              { r = 255;         g = (1 - f) * 255; b = 0; }
        return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
    }

    // 이득(dB) [-GMIN, 0] → jetColor용 t
    var GAIN_MIN = -30.0;
    function gainToT(gainDb) {
        return (gainDb - GAIN_MIN) / (0 - GAIN_MIN);
    }

    // 빔패턴 전용 컬러맵: t∈[0,1] → {r,g,b} 0..255 (남색(약) → 핑크(강))
    //   - RSRP 팔레트(빨강~초록)와 색조가 겹치지 않아 지도 위에서 즉시 구분됨
    var BEAM_C_LO = { r: 79, g: 70, b: 229 };    // #4f46e5 (t=0, -30dB 이하)
    var BEAM_C_HI = { r: 244, g: 114, b: 182 };  // #f472b6 (t=1, 0dB 최대)
    function beamColor(t) {
        t = Math.max(0, Math.min(1, t));
        return {
            r: Math.round(BEAM_C_LO.r + (BEAM_C_HI.r - BEAM_C_LO.r) * t),
            g: Math.round(BEAM_C_LO.g + (BEAM_C_HI.g - BEAM_C_LO.g) * t),
            b: Math.round(BEAM_C_LO.b + (BEAM_C_HI.b - BEAM_C_LO.b) * t)
        };
    }

    // 빔패턴 이득 bin (강→약 순, 5dB 단위) — 전용 범례용
    var BEAM_BINS = [
        { lo: -5,        hi: 0,   color: "#f472b6" },   // 핑크 (강)
        { lo: -10,       hi: -5,  color: "#e879f9" },
        { lo: -15,       hi: -10, color: "#c084fc" },
        { lo: -20,       hi: -15, color: "#a78bfa" },
        { lo: -25,       hi: -20, color: "#818cf8" },
        { lo: -30,       hi: -25, color: "#6366f1" },
        { lo: -Infinity, hi: -30, color: "#4f46e5" }    // 남색 (약)
    ];

    // 로컬 ENU 벡터를 틸트/스윙으로 회전 (Rodrigues)
    // 틸트: swing 방위 방향이 아래로 내려감 (다운틸트 양수)
    // 스윙이 0이면 북쪽(N+) 방향으로 다운틸트
    function rotateENU(e, n, u, tiltDeg, swingDeg) {
        if (!tiltDeg) return { e: e, n: n, u: u };
        var t = toRad(tiltDeg), s = toRad(swingDeg);
        // 회전축 a = bearing s+90° 방향 단위벡터 (이 축 +tilt 회전 시 bearing s 방향이 아래로)
        var ax = -Math.cos(s), ay = Math.sin(s), az = 0;
        var ct = Math.cos(t), st = Math.sin(t);
        var cx = ay * u - az * n;   // a×v
        var cy = az * e - ax * u;
        var cz = ax * n - ay * e;
        var adotv = ax * e + ay * n + az * u;
        return {
            e: e * ct + cx * st + ax * adotv * (1 - ct),
            n: n * ct + cy * st + ay * adotv * (1 - ct),
            u: u * ct + cz * st + az * adotv * (1 - ct)
        };
    }

    // 틸트/스윙 적용 안테나좌표계 이득 조회
    // (elDeg, azDeg): 세계좌표 고도각/방위각 → 안테나 프레임 고도각으로 변환 후 패턴 조회
    // sin(el') = cos(el)·sin(tilt)·cos(az − swing) + sin(el)·cos(tilt)
    function tiltedGain(elDeg, azDeg, tiltDeg, swingDeg) {
        if (!tiltDeg) return gainAtDirection(azDeg, elDeg);
        var el = toRad(elDeg), az = toRad(azDeg), t = toRad(tiltDeg);
        var sinEl = Math.cos(el) * Math.sin(t) * Math.cos(az - toRad(swingDeg)) + Math.sin(el) * Math.cos(t);
        sinEl = Math.max(-1, Math.min(1, sinEl));
        return gainAtElevation(Math.asin(sinEl) * 180 / Math.PI) +
               horizontalGainAtAzimuth(azDeg - (swingDeg || 0));
    }

    // 두 경위도 간 방위각(deg, 북=0 시계방향)
    function bearingDeg(lon1, lat1, lon2, lat2) {
        var f1 = toRad(lat1), f2 = toRad(lat2), dl = toRad(lon2 - lon1);
        var y = Math.sin(dl) * Math.cos(f2);
        var x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    // 범용 패턴 메시 생성: gainFn(azDeg, elDeg) → dB 를 받아 3D 반투명 표면 메시 생성
    //   - 측정 이중 야기+옴니 패턴뿐 아니라 Sionna RT 예측 기반 패턴에도 사용
    //   - 반환: { positions:[{e,n,u,gainDb}], indices } (로컬 ENU 미터, 틸트/스윙 회전 적용)
    function buildPatternMeshFromGain(gainFn, scaleMeters, azStepDeg, elStepDeg, tiltDeg, swingDeg) {
        var azs = [], els = [];
        var az, el;
        for (az = 0; az < 360; az += azStepDeg) azs.push(az);
        for (el = -90; el <= 90.0001; el += elStepDeg) els.push(Math.min(el, 90));

        var nEl = els.length;
        var positions = [];  // {e,n,u,gainDb}
        var idxMap = {};     // "azIndex:elIndex" → vertex index
        var k = 0;
        for (var ia = 0; ia < azs.length; ia++) {
            var arad = toRad(azs[ia]);
            var cAz = Math.cos(arad), sAz = Math.sin(arad);
            for (var ie = 0; ie < nEl; ie++) {
                el = els[ie];
                var g = gainFn(azs[ia], el);
                // 결측(NaN/Infinity) 빈: 반경 0으로 저장하고 면 생성에서 제외
                var r = isFinite(g) ? scaleMeters * Math.pow(10, g / 20) : 0;   // 진폭 비례 반경
                var er = toRad(el);
                var pe = r * Math.cos(er) * cAz;
                var pn = r * Math.cos(er) * sAz;
                var pu = r * Math.sin(er);
                var rp = rotateENU(pe, pn, pu, tiltDeg || 0, swingDeg || 0);
                positions.push({
                    e: rp.e, n: rp.n, u: rp.u,
                    gainDb: g
                });
                idxMap[ia + ":" + ie] = k++;
            }
        }
        var nAz = azs.length;
        var indices = [];
        for (ia = 0; ia < nAz; ia++) {
            var ia2 = (ia + 1) % nAz;
            for (ie = 0; ie < nEl - 1; ie++) {
                var v00 = idxMap[ia + ":" + ie],     v01 = idxMap[ia + ":" + (ie + 1)];
                var v10 = idxMap[ia2 + ":" + ie],    v11 = idxMap[ia2 + ":" + (ie + 1)];
                // 4 꼭짓점 중 하나라도 결측이면 면 제외 (데이터 없는 영역은 구멍)
                if (!isFinite(positions[v00].gainDb) || !isFinite(positions[v01].gainDb) ||
                    !isFinite(positions[v10].gainDb) || !isFinite(positions[v11].gainDb)) continue;
                indices.push(v00, v10, v01, v01, v10, v11);
            }
        }
        return { positions: positions, indices: indices };
    }

    // 도넛 메시 생성 (로컬 ENU 미터 좌표, 틸트/스윙 회전 적용)
    // azStep/elStep: 분할 간격(deg), scaleMeters: 최대 반경
    // 메시는 안테나 프레임에서 생성 후 틸트/스윙 회전 적용
    // H/V 합성 상대이득을 사용해 방위와 고도를 모두 반영한다.
    function buildPatternMesh(scaleMeters, azStepDeg, elStepDeg, tiltDeg, swingDeg) {
        return buildPatternMeshFromGain(
            function (az, el) { return gainAtDirection(az, el); },
            scaleMeters, azStepDeg, elStepDeg, tiltDeg, swingDeg);
    }

    return {
        BEAM_TABLE: BEAM_TABLE,
        GAIN_MIN: GAIN_MIN,
        gainAtElevation: gainAtElevation,
        horizontalGainAtAzimuth: horizontalGainAtAzimuth,
        gainAtDirection: gainAtDirection,
        setThetaPattern: setThetaPattern,
        setHorizontalPattern: setHorizontalPattern,
        getPatternMeta: getPatternMeta,
        loadPatternJson: loadPatternJson,
        enuToEcef: enuToEcef,
        solveOLS3: solveOLS3,
        solveOLS2: solveOLS2,
        jetColor: jetColor,
        beamColor: beamColor,
        BEAM_BINS: BEAM_BINS,
        gainToT: gainToT,
        rotateENU: rotateENU,
        tiltedGain: tiltedGain,
        bearingDeg: bearingDeg,
        buildPatternMesh: buildPatternMesh,
        buildPatternMeshFromGain: buildPatternMeshFromGain
    };
})();

if (typeof window !== "undefined" && window.BEAMPATTERN && window.fetch) {
    // Python이 생성한 패턴 JSON과 UI 시각화를 자동 동기화. 실패 시 내장 CSV-derived table 사용.
    window.BEAMPATTERN.loadPatternJson("Data/sionna/antenna_pattern.json", function () {});
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = BEAMPATTERN;
}
