// ============================================================
// Sionna/Friis -100dBm 연속 경계면의 고도별 최단 수평거리 비교표
// ============================================================
var COVERAGE_SURFACE_COMPARISON = (function () {
    "use strict";

    var SIONNA_URL = "Data/sionna/sionna_volume_surface.json";
    var FRIIS_URL = "Data/sionna/friis_volume_surface.json";
    var cache = null;

    function $(id) { return document.getElementById(id); }

    function altitudeLevels(maxAltitudeM) {
        var levels = [], value;
        for (value = 100; value <= 500; value += 100) levels.push(value);
        for (value = 1000; value <= 10000; value += 1000) levels.push(value);
        var upper = Math.floor(Number(maxAltitudeM || 0) / 10000) * 10000;
        for (value = 20000; value <= upper; value += 10000) levels.push(value);
        return levels;
    }

    function minHorizontalDistanceAtAltitude(triangles, altitudeM) {
        var minimum = Infinity;
        function consider(x, y) {
            var distance = Math.sqrt(x * x + y * y);
            if (distance < minimum) minimum = distance;
        }
        function edge(triangle, a, b) {
            var za = Number(triangle[a * 3 + 2]);
            var zb = Number(triangle[b * 3 + 2]);
            var xa = Number(triangle[a * 3]), ya = Number(triangle[a * 3 + 1]);
            var xb = Number(triangle[b * 3]), yb = Number(triangle[b * 3 + 1]);
            if (Math.abs(za - altitudeM) < 1e-6) consider(xa, ya);
            if ((za < altitudeM && zb > altitudeM) || (za > altitudeM && zb < altitudeM)) {
                var ratio = (altitudeM - za) / (zb - za);
                consider(xa + (xb - xa) * ratio, ya + (yb - ya) * ratio);
            }
        }
        for (var i = 0; i < triangles.length; i++) {
            edge(triangles[i], 0, 1);
            edge(triangles[i], 1, 2);
            edge(triangles[i], 2, 0);
        }
        return isFinite(minimum) ? minimum : null;
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

    function minimumDistanceAtAltitude(data, altitudeM) {
        var horizontal = minHorizontalDistanceAtAltitude(data.trianglesEnuM || [], altitudeM);
        if (horizontal === null) return null;
        var antennaHeight = Number(data.meta && data.meta.antennaHeightM);
        if (!isFinite(antennaHeight)) antennaHeight = 0;
        var vertical = Number(altitudeM) - antennaHeight;
        return Math.sqrt(horizontal * horizontal + vertical * vertical);
    }

    function buildRows(sionna, friis) {
        var maximum = Math.max(maximumAltitude(sionna), maximumAltitude(friis));
        var levels = altitudeLevels(maximum), rows = [];
        for (var i = 0; i < levels.length; i++) {
            var sionnaDistance = minimumDistanceAtAltitude(sionna, levels[i]);
            var friisDistance = minimumDistanceAtAltitude(friis, levels[i]);
            rows.push({
                altitudeM: levels[i],
                sionnaDistanceM: sionnaDistance,
                friisDistanceM: friisDistance,
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
    function render(rows) {
        var box = $("coverage-distance-result");
        if (!box) return;
        var html = '<div class="distance-table-note"><strong>기지국 안테나에서 RSRP -100dBm 경계까지의 최단 3D 거리</strong>' +
            '<br>동일 고도 평면과 3D 표면이 만나는 점 중 기지국에 가장 가까운 직선거리입니다.</div>' +
            '<div class="distance-table-wrap"><table class="alt-table distance-table"><thead><tr>' +
            '<th>고도</th><th><span class="surface-key sionna"></span>Sionna</th>' +
            '<th><span class="surface-key friis"></span>Friis</th><th>차이</th>' +
            '</tr></thead><tbody>';
        for (var i = 0; i < rows.length; i++) {
            html += '<tr><td>' + formatAltitude(rows[i].altitudeM) + '</td>' +
                '<td>' + formatDistance(rows[i].sionnaDistanceM) + '</td>' +
                '<td>' + formatDistance(rows[i].friisDistanceM) + '</td>' +
                '<td>' + formatDistance(rows[i].differenceM) + '</td></tr>';
        }
        html += '</tbody></table></div><div class="distance-table-note">차이 = Friis − Sionna · —는 해당 고도에 경계면이 없음을 뜻합니다.</div>';
        box.innerHTML = html;
        box.style.display = "block";
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
            box.style.display = "none";
            button.textContent = "고도별 최단 거리 표";
            return;
        }
        button.textContent = "표를 계산하는 중...";
        button.disabled = true;
        var load = cache ? Promise.resolve(cache) : Promise.all([
            fetch(SIONNA_URL).then(function (response) {
                if (!response.ok) throw new Error("Sionna HTTP " + response.status);
                return response.json();
            }),
            fetch(FRIIS_URL).then(function (response) {
                if (!response.ok) throw new Error("Friis HTTP " + response.status);
                return response.json();
            })
        ]).then(function (data) { cache = data; return data; });
        load.then(function (data) {
            render(buildRows(data[0], data[1]));
            button.textContent = "고도별 최단 거리 표 숨기기";
            button.disabled = false;
            setStatus("Sionna/Friis 고도별 -100dBm 경계 최단거리 비교 완료");
        }).catch(function (error) {
            button.textContent = "고도별 최단 거리 표";
            button.disabled = false;
            setStatus("고도별 최단거리 표 생성 실패: " + error.message, true);
        });
    }
    function init() {
        var button = $("btn-coverage-distance-table");
        if (button) button.addEventListener("click", toggle);
    }
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();
    }
    return {
        altitudeLevels: altitudeLevels,
        minHorizontalDistanceAtAltitude: minHorizontalDistanceAtAltitude,
        minimumDistanceAtAltitude: minimumDistanceAtAltitude,
        maximumAltitude: maximumAltitude,
        buildRows: buildRows,
        formatDistance: formatDistance,
        toggle: toggle
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = COVERAGE_SURFACE_COMPARISON;
}
