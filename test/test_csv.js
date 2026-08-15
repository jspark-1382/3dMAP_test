// Node 테스트용: js/csv.js 를 로드하여 실데이터 형식 파싱 검증
var fs = require("fs");
var path = require("path");

var csvSrc = fs.readFileSync(path.join(__dirname, "..", "js", "csv.js"), "utf-8");
eval(csvSrc);

var sample = fs.readFileSync(path.join(__dirname, "..", "sample", "drone_data.csv"), "utf-8");

var result = CSV.parse(sample, "normalizeBase");

console.log("errors:", result.errors);
console.log("baseAlt(첫행 고도):", result.baseAlt);
console.log("포인트 수:", result.points.length);
console.log("헤더:", result.headers);
if (result.points.length > 0) {
    var p = result.points[0];
    console.log("첫번째 포인트: 경도=" + p.lon + ", 위도=" + p.lat + ", 원본고도=" + p.alt + ", 적용고도=" + p.appliedAlt + ", RSRP=" + p.rsrp);
    var p2 = result.points[1];
    console.log("두번째 포인트: 경도=" + p2.lon + ", 위도=" + p2.lat + ", 원본고도=" + p2.alt + ", 적용고도=" + p2.appliedAlt);
    console.log("부가정보(첫행):", JSON.stringify(p.extra));
}

