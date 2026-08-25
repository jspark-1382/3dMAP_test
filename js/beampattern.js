// ============================================================
// 빔패턴 모듈: 900MHz 옴니 안테나 수직면(V-Plane) 패턴
//   - Cesium 비의존 순수 계산 모듈 (node 테스트 가능)
//   - 전역: window.BEAMPATTERN
// ------------------------------------------------------------
// 패턴 특성 (측정 시험 성적서 기준):
//   · 최대이득 방향 ±90°(수평) = 0 dBi (기계적으로 0 고정/정규화)
//   · 전면/후면(0°/180°, 천정·저중) Null ≒ -30 dB
//   · 부엽: ±50~60°( -7~-10dB ), ±120~140°( -12~-18dB )
//   · 수평면(Azimuth) 균일 → 3D 도넛(토러스) 형상
// ============================================================
var BEAMPATTERN = (function () {
    "use strict";

    // 각도(°) : 도표 상의 각도 (0=천정, 90/270=수평, 180=저중)
    // 이득(dB) : 상대이득 (최대 0 dB 정규화)
    var BEAM_TABLE = [
        [0,   -30.0], [10,  -26.5], [20,  -22.3], [30,  -16.0],
        [40,  -10.5], [50,   -7.5], [60,   -9.0], [70,  -12.5],
        [80,   -8.5], [90,    0.0], [100,  -8.5], [110, -12.5],
        [120, -18.0], [130, -16.5], [140, -16.5], [150, -22.0],
        [160, -26.0], [170, -29.0], [180, -30.0],
        [190, -26.0], [200, -22.0], [210, -16.5], [220, -18.0],
        [230, -12.0], [240,  -9.0], [250, -12.5], [260,  -8.5],
        [270,   0.0], [280,  -8.5], [290, -12.5], [300,  -9.0],
        [310, -10.5], [320, -16.0], [330, -22.3], [340, -26.5],
        [350, -29.0], [360, -30.0]
    ];

    var WGS84_A = 6378137.0;                 // 장반경 (m)
    var WGS84_E2 = 6.69437999014e-3;         // 제1이심률 제곱

    function toRad(deg) { return deg * Math.PI / 180; }

    // el(고도각, deg): 0=수평, +90=천정, -90=저중
    // 도표 각도 t = ((90 - el) mod 360 + 360) mod 360 후 선형보간
    function gainAtElevation(elDeg) {
        var t = ((90 - elDeg) % 360 + 360) % 360;
        var i0 = Math.floor(t / 10);
        if (i0 >= BEAM_TABLE.length - 1) i0 = BEAM_TABLE.length - 2;
        var a = BEAM_TABLE[i0], b = BEAM_TABLE[i0 + 1];
        var f = (t - a[0]) / (b[0] - a[0]);
        return a[1] + f * (b[1] - a[1]);
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
        if (!tiltDeg) return gainAtElevation(elDeg);
        var el = toRad(elDeg), az = toRad(azDeg), t = toRad(tiltDeg);
        var sinEl = Math.cos(el) * Math.sin(t) * Math.cos(az - toRad(swingDeg)) + Math.sin(el) * Math.cos(t);
        sinEl = Math.max(-1, Math.min(1, sinEl));
        return gainAtElevation(Math.asin(sinEl) * 180 / Math.PI);
    }

    // 두 경위도 간 방위각(deg, 북=0 시계방향)
    function bearingDeg(lon1, lat1, lon2, lat2) {
        var f1 = toRad(lat1), f2 = toRad(lat2), dl = toRad(lon2 - lon1);
        var y = Math.sin(dl) * Math.cos(f2);
        var x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    // 범용 패턴 메시 생성: gainFn(azDeg, elDeg) → dB 를 받아 3D 반투명 표면 메시 생성
    //   - 측정 옴니 패턴뿐 아니라 Sionna RT 예측 기반(방위 의존) 패턴에도 사용
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
                var r = scaleMeters * Math.pow(10, g / 20);   // 진폭 비례 반경
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
                indices.push(v00, v10, v01, v01, v10, v11);
            }
        }
        return { positions: positions, indices: indices };
    }

    // 도넛 메시 생성 (로컬 ENU 미터 좌표, 틸트/스윙 회전 적용)
    // azStep/elStep: 분할 간격(deg), scaleMeters: 최대 반경
    // 메시는 안테나 프레임에서 생성 후 틸트/스윙 회전 적용
    // (수직면 전용이므로 방위 무관 → buildPatternMeshFromGain 위임)
    function buildPatternMesh(scaleMeters, azStepDeg, elStepDeg, tiltDeg, swingDeg) {
        return buildPatternMeshFromGain(
            function (_az, el) { return gainAtElevation(el); },
            scaleMeters, azStepDeg, elStepDeg, tiltDeg, swingDeg);
    }

    return {
        BEAM_TABLE: BEAM_TABLE,
        GAIN_MIN: GAIN_MIN,
        gainAtElevation: gainAtElevation,
        enuToEcef: enuToEcef,
        solveOLS3: solveOLS3,
        solveOLS2: solveOLS2,
        jetColor: jetColor,
        gainToT: gainToT,
        rotateENU: rotateENU,
        tiltedGain: tiltedGain,
        bearingDeg: bearingDeg,
        buildPatternMesh: buildPatternMesh,
        buildPatternMeshFromGain: buildPatternMeshFromGain
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = BEAMPATTERN;
}
