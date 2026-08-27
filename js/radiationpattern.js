// ============================================================
// 안테나 고유 방사 패턴 표시
//   - 측정 H-Plane + V-Plane의 separable 3D 근사
//   - 수신 고도, Pathloss, 지면 반사, RSRP를 사용하지 않는다.
//   - 기존 커버리지 방향성 렌더러와 독립된 엔티티를 사용한다.
// ============================================================
var RADIATION_PATTERN = (function () {
    "use strict";

    var entities = [];
    var visible = false;

    function $(id) { return document.getElementById(id); }

    function getViewer() {
        return (window.ws3d && window.ws3d.viewer) ? window.ws3d.viewer : null;
    }

    function getTxRef() {
        var ref = (window.MAIN && MAIN.getTxRef) ? MAIN.getTxRef() : null;
        if (ref) return ref;
        var lon = parseFloat($("tx-lon") && $("tx-lon").value);
        var lat = parseFloat($("tx-lat") && $("tx-lat").value);
        var alt = parseFloat($("tx-alt") && $("tx-alt").value) || 0;
        return (isFinite(lon) && isFinite(lat)) ? { lon: lon, lat: lat, alt: alt } : null;
    }

    function getNumber(id, fallback) {
        var value = parseFloat($(id) && $(id).value);
        return isFinite(value) ? value : fallback;
    }

    function setStatus(message, isError) {
        var el = $("status");
        if (!el) return;
        el.textContent = message;
        el.className = isError ? "status error" : "status";
    }

    function gainColor(gainDb) {
        var c = BEAMPATTERN.beamColor(BEAMPATTERN.gainToT(gainDb));
        return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
    }

    function localToCartesian(ref, e, n, u) {
        var point = BEAMPATTERN.enuToEcef(ref.lon, ref.lat, ref.alt || 0, e, n, u);
        return new Cesium.Cartesian3(point.x, point.y, point.z);
    }

    function addPolyline(viewer, positions, colorCss, alpha, width) {
        var color = Cesium.Color.fromCssColorString(colorCss) || Cesium.Color.WHITE;
        var entity = viewer.entities.add({
            polyline: {
                positions: positions,
                width: width,
                material: color.withAlpha(alpha),
                clampToGround: false
            }
        });
        entities.push(entity);
    }

    function pointFor(ref, azDeg, elDeg, scale, tilt, swing) {
        var gain = BEAMPATTERN.gainAtDirection(azDeg, elDeg);
        var radius = scale * Math.pow(10, gain / 20);
        var az = azDeg * Math.PI / 180;
        var el = elDeg * Math.PI / 180;
        var rotated = BEAMPATTERN.rotateENU(
            radius * Math.cos(el) * Math.sin(az),
            radius * Math.cos(el) * Math.cos(az),
            radius * Math.sin(el),
            tilt,
            swing
        );
        return {
            gain: gain,
            position: localToCartesian(ref, rotated.e, rotated.n, rotated.u)
        };
    }

    function showLegend() {
        var el = $("radiation-legend");
        if (!el) return;
        var bins = BEAMPATTERN.BEAM_BINS;
        var html = '<div class="legend-title">안테나 상대이득 (dB)</div>' +
            '<div class="legend-source">측정 H/V 합성 · RSRP 아님</div>';
        for (var i = 0; i < bins.length; i++) {
            var label = bins[i].lo === -Infinity
                ? '-30 dB 미만'
                : bins[i].lo + ' ~ ' + bins[i].hi + ' dB';
            html += '<div class="legend-row"><span class="legend-color" style="background:' +
                bins[i].color + '"></span><span class="legend-label">' + label + '</span></div>';
        }
        el.innerHTML = html;
        el.style.display = "block";
    }

    function hideLegend() {
        var el = $("radiation-legend");
        if (el) el.style.display = "none";
    }

    function clear() {
        var viewer = getViewer();
        if (viewer) {
            for (var i = 0; i < entities.length; i++) {
                try { viewer.entities.remove(entities[i]); } catch (e) { /* 무시 */ }
            }
        }
        entities = [];
        visible = false;
        var button = $("btn-radiation");
        if (button) button.classList.remove("active");
        hideLegend();
    }

    function render() {
        clear();
        var viewer = getViewer();
        var ref = getTxRef();
        if (!viewer || !window.Cesium || !window.BEAMPATTERN || !ref) {
            setStatus("안테나 방사 패턴을 표시할 지도 또는 기지국 위치가 없습니다.", true);
            return;
        }

        var scale = getNumber("radiation-scale", 300);
        var tilt = getNumber("radiation-tilt", 0);
        var swing = getNumber("radiation-swing", 0);
        var az, el, p, positions;

        // V-Plane 자오선: 15° 방위 간격. 측정 수직 패턴의 로브/널 형상을 보여준다.
        for (az = 0; az < 360; az += 15) {
            positions = [];
            for (el = -90; el <= 90; el += 5) {
                positions.push(pointFor(ref, az, el, scale, tilt, swing).position);
            }
            addPolyline(viewer, positions, "#94a3b8", 0.55, 1.2);
        }

        // H-Plane 링: 10° 고도 간격, 30° 세그먼트별 상대이득 색상.
        for (el = -80; el <= 80; el += 10) {
            for (var segment = 0; segment < 12; segment++) {
                positions = [];
                var gainSum = 0, gainCount = 0;
                for (var step = 0; step <= 6; step++) {
                    az = segment * 30 + step * 5;
                    p = pointFor(ref, az, el, scale, tilt, swing);
                    positions.push(p.position);
                    gainSum += p.gain;
                    gainCount++;
                }
                addPolyline(
                    viewer,
                    positions,
                    gainColor(gainSum / gainCount),
                    0.92,
                    el === 0 ? 2.6 : 1.5
                );
            }
        }

        // 수평 H-Plane과 대표 V-Plane을 굵게 강조한다.
        positions = [];
        for (az = 0; az <= 360; az += 5) {
            positions.push(pointFor(ref, az, 0, scale, tilt, swing).position);
        }
        addPolyline(viewer, positions, "#f472b6", 1.0, 3.0);

        for (az = 0; az <= 180; az += 180) {
            positions = [];
            for (el = -90; el <= 90; el += 2) {
                positions.push(pointFor(ref, az, el, scale, tilt, swing).position);
            }
            addPolyline(viewer, positions, "#f8fafc", 0.95, 2.6);
        }

        visible = true;
        var button = $("btn-radiation");
        if (button) button.classList.add("active");
        showLegend();

        var meta = BEAMPATTERN.getPatternMeta ? BEAMPATTERN.getPatternMeta() : {};
        // 기지국이 화면 중앙에 오도록 기존 지도 카메라 이동 경로를 사용한다.
        // 표시 형상만 새 엔티티이며 기존 커버리지/빔 엔티티에는 손대지 않는다.
        try {
            var marginDeg = Math.max(0.002, scale / 85000);
            viewer.camera.flyTo({
                destination: Cesium.Rectangle.fromDegrees(
                    ref.lon - marginDeg,
                    ref.lat - marginDeg,
                    ref.lon + marginDeg,
                    ref.lat + marginDeg
                )
            });
        } catch (cameraError) { /* 패턴 표시는 유지 */ }
        setStatus(
            "안테나 고유 방사 패턴 표시: " + (meta.model || "PM-OM900_06") +
            " · " + (meta.frequencyMHz || 910) + "MHz · 피크 " +
            (isFinite(meta.maxGainDbi) ? meta.maxGainDbi.toFixed(1) : "5.4") +
            "dBi · 측정 H/V separable 3D 근사 · 수신고도/Pathloss/RSRP 미사용 · 표시배율 " +
            scale + "m"
        );
    }

    function toggle() {
        if (visible) {
            clear();
            setStatus("안테나 고유 방사 패턴 숨김");
        } else {
            render();
        }
    }

    function refreshIfVisible() {
        if (visible) render();
    }

    function init() {
        var button = $("btn-radiation");
        var scale = $("radiation-scale");
        var tilt = $("radiation-tilt");
        var swing = $("radiation-swing");
        if (button) button.addEventListener("click", toggle);
        if (scale) scale.addEventListener("input", function () {
            var label = $("radiation-scale-val");
            if (label) label.textContent = scale.value + "m";
            refreshIfVisible();
        });
        if (tilt) tilt.addEventListener("change", refreshIfVisible);
        if (swing) swing.addEventListener("change", refreshIfVisible);
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
        else init();
    }

    return { render: render, clear: clear, toggle: toggle };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = RADIATION_PATTERN;
}
