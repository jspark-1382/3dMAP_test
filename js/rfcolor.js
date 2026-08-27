// ============================================================
// 공통 RSRP 색상 / 범례
//   - CSV 측정, 경로손실 예측, Sionna RT, Sionna 기반 빔에 공통 적용
//   - 전역: window.RF_COLOR
// ============================================================
var RF_COLOR = (function () {
    "use strict";

    // 참고 범례의 강한 신호 -> 약한 신호 순서.
    var BINS = [
        { min: -60,       max: Infinity, color: "#ef1b17", label: "-60 dBm 이상" },
        { min: -70,       max: -60,      color: "#ff6b00", label: "-60 ~ -70 dBm" },
        { min: -80,       max: -70,      color: "#ffd400", label: "-70 ~ -80 dBm" },
        { min: -90,       max: -80,      color: "#65db00", label: "-80 ~ -90 dBm" },
        { min: -100,      max: -90,      color: "#00a85a", label: "-90 ~ -100 dBm" },
        { min: -110,      max: -100,     color: "#3f37a5", label: "-100 ~ -110 dBm" },
        { min: -Infinity, max: -110,     color: "#202020", label: "-110 dBm 미만" }
    ];

    // 연속 보간 기준점(약 -> 강). 지도에서는 경계가 끊기지 않도록 RGB를 보간한다.
    var STOPS = [
        { dbm: -120, color: "#202020" },
        { dbm: -110, color: "#3f37a5" },
        { dbm: -100, color: "#00a85a" },
        { dbm: -90,  color: "#65db00" },
        { dbm: -80,  color: "#ffd400" },
        { dbm: -70,  color: "#ff6b00" },
        { dbm: -60,  color: "#ef1b17" }
    ];

    function hexToRgb255(hex) {
        var h = String(hex || "#9ca3af").replace("#", "");
        return {
            r: parseInt(h.substring(0, 2), 16),
            g: parseInt(h.substring(2, 4), 16),
            b: parseInt(h.substring(4, 6), 16)
        };
    }

    function rgb255(value) {
        var v = Number(value);
        if (isNaN(v)) return hexToRgb255("#9ca3af");
        if (v <= STOPS[0].dbm) return hexToRgb255(STOPS[0].color);
        if (v >= STOPS[STOPS.length - 1].dbm) return hexToRgb255(STOPS[STOPS.length - 1].color);
        for (var i = 0; i < STOPS.length - 1; i++) {
            var a = STOPS[i], b = STOPS[i + 1];
            if (v < a.dbm || v > b.dbm) continue;
            var t = (v - a.dbm) / (b.dbm - a.dbm);
            var ca = hexToRgb255(a.color), cb = hexToRgb255(b.color);
            return {
                r: Math.round(ca.r + (cb.r - ca.r) * t),
                g: Math.round(ca.g + (cb.g - ca.g) * t),
                b: Math.round(ca.b + (cb.b - ca.b) * t)
            };
        }
        return hexToRgb255("#9ca3af");
    }

    function colorForDbm(value) {
        var c = rgb255(value);
        return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
    }

    function rgb01(value) {
        var c = rgb255(value);
        return [c.r / 255, c.g / 255, c.b / 255];
    }

    function dbmToT(value) {
        var t = (Number(value) + 120) / 60;
        return Math.max(0, Math.min(1, isNaN(t) ? 0 : t));
    }

    function renderLegend(el) {
        if (!el) return;
        var html = '<div class="legend-title">통합 RSRP 범례 (dBm)</div>' +
                   '<div class="legend-source">CSV 측정 · 일반 예측 · RT/자유공간 공통</div>' +
                   '<div class="legend-vertical"><div class="legend-gradient"></div>' +
                   '<div class="legend-range-labels">';
        for (var i = 0; i < BINS.length; i++) {
            html += '<div class="legend-range-label">' + BINS[i].label + '</div>';
        }
        html += '</div></div>';
        el.innerHTML = html;
        el.style.display = "block";
    }

    return {
        BINS: BINS,
        STOPS: STOPS,
        colorForDbm: colorForDbm,
        rgb255: rgb255,
        rgb01: rgb01,
        dbmToT: dbmToT,
        renderLegend: renderLegend
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = RF_COLOR;
}
