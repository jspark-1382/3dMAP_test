// ============================================================
// CSV 파서 (브이월드 3D 지도용)
// ------------------------------------------------------------
// 구분자(쉼표/탭/세미콜론) 자동 감지, 헤더 키워드 매핑 지원
// 예) [General][GPS]Latitude, [General][GPS]Longitude,
//     [General][Drone Telemetry]App Pressure Altitude(m)
// ============================================================

var CSV = (function () {
    "use strict";

    var DELIMITERS = [",", "\t", ";"];

    // 행을 파싱 (따옴표 필드 고려)
    function splitLine(line, delim) {
        var result = [];
        var current = "";
        var inQuotes = false;
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (line[i + 1] === '"') { current += '"'; i++; }
                    else { inQuotes = false; }
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') { inQuotes = true; }
                else if (ch === delim) { result.push(current); current = ""; }
                else { current += ch; }
            }
        }
        result.push(current);
        for (var j = 0; j < result.length; j++) {
            result[j] = result[j].trim();
        }
        return result;
    }

    // 가장 많은 구분자가 나타나는 것을 감지
    function detectDelimiter(lines) {
        var counts = {};
        for (var d = 0; d < DELIMITERS.length; d++) {
            counts[DELIMITERS[d]] = 0;
        }
        for (var i = 0; i < lines.length && i < 20; i++) {
            var line = lines[i];
            for (var d = 0; d < DELIMITERS.length; d++) {
                var c = 0;
                for (var k = 0; k < line.length; k++) {
                    if (line[k] === DELIMITERS[d]) c++;
                }
                counts[DELIMITERS[d]] += c;
            }
        }
        var best = ",";
        var bestCount = -1;
        for (var d = 0; d < DELIMITERS.length; d++) {
            if (counts[DELIMITERS[d]] > bestCount) {
                best = DELIMITERS[d];
                bestCount = counts[DELIMITERS[d]];
            }
        }
        return best;
    }

    // 헤더에서 컬럼 인덱스 찾기 (부분일치 키워드)
    function mapColumns(headers) {
        var result = { latitude: -1, longitude: -1, altitude: -1, headers: headers };
        result.extra = [];
        for (var i = 0; i < headers.length; i++) {
            var h = String(headers[i]).toLowerCase();
            if (result.latitude === -1 && h.indexOf("latitude") !== -1) {
                result.latitude = i;
            } else if (result.longitude === -1 && h.indexOf("longitude") !== -1) {
                result.longitude = i;
            } else if (result.altitude === -1 && h.indexOf("altitude") !== -1) {
                result.altitude = i;
            } else if (
                h === "idx" || h === "id" || h === "no" ||
                h.indexOf("time") !== -1 ||
                h.indexOf("pci") !== -1 ||
                h.indexOf("rsrp") !== -1
            ) {
                result.extra.push(i);
            }
        }
        return result;
    }

    function parseNumber(v) {
        if (v === null || v === undefined) return NaN;
        var s = String(v).replace(/,/g, "").trim();
        if (s === "") return NaN;
        var n = Number(s);
        if (isNaN(n)) return NaN;
        // 밀리초/시간처럼 숫자가 아닌 문자 포함이면 NaN
        return n;
    }
// 텍스트 CSV -> { points, headers, errors, baseAlt }
    // altMode: "normalizeBase" -> 첫 행 고도값을 빼 0점(첫 행) 기준 보정
    function parse(text, altMode) {
        // UTF-8 BOM 제거 (엑셀 등에서 내보낸 CSV에서 자주 발생)
        text = String(text).replace(/^\uFEFF/, "");
        var lines = text.split(/\r\n|\n|\r/);
        var nonEmpty = [];
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].trim() !== "") nonEmpty.push(lines[i]);
        }
        if (nonEmpty.length === 0) {
            return { points: [], headers: [], errors: ["빈 파일입니다."] };
        }

        var delim = detectDelimiter(nonEmpty);
        var headers = splitLine(nonEmpty[0], delim);
        var cols = mapColumns(headers);

        var errors = [];
        if (cols.latitude === -1) errors.push("Latitude 컬럼을 찾을 수 없습니다.");
        if (cols.longitude === -1) errors.push("Longitude 컬럼을 찾을 수 없습니다.");

        var points = [];
        var baseAlt = null;

        for (var r = 1; r < nonEmpty.length; r++) {
            var cells = splitLine(nonEmpty[r], delim);
            var lat = cols.latitude >= 0 ? parseNumber(cells[cols.latitude]) : NaN;
            var lon = cols.longitude >= 0 ? parseNumber(cells[cols.longitude]) : NaN;
            var alt = cols.altitude >= 0 ? parseNumber(cells[cols.altitude]) : 0;

            if (isNaN(lat) || isNaN(lon)) continue;
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                errors.push("행 " + r + ": 좌표 범위 밖 (lat=" + lat + ", lon=" + lon + ")");
                continue;
            }

            if (baseAlt === null && cols.altitude >= 0 && !isNaN(alt)) {
                baseAlt = alt; // 첫 데이터 행의 고도값
            }

            var appliedAlt;
            if (cols.altitude >= 0 && !isNaN(alt) && baseAlt !== null && !isNaN(baseAlt) && altMode === "normalizeBase") {
                appliedAlt = alt - baseAlt; // 첫 행 값을 빼 0점(첫 행) 기준 보정
            } else if (!isNaN(alt)) {
                appliedAlt = alt;
            } else {
                appliedAlt = 0;
            }

            var point = {
                idx: r,
                lat: lat,
                lon: lon,
                alt: alt,          // 원본 고도
                appliedAlt: appliedAlt, // 보정된 고도
                extra: {}
            };

            for (var e = 0; e < cols.extra.length; e++) {
                var ci = cols.extra[e];
                point.extra[headers[ci]] = cells[ci];
            }
            points.push(point);
        }

        return { points: points, headers: headers, errors: errors, baseAlt: baseAlt };
    }

    return {
        parse: parse
    };
})();
