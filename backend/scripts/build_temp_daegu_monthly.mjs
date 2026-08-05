import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const root = "C:/dev/17-1st-teamproject";
const inputDir = path.join(root, "data/raw/collected_2026-07-30/extracted/temp_daegu_2020-2026");
const outputDir = path.join(root, "outputs/monthly_temperature_summary");
const outputPath = path.join(outputDir, "temp_daegu_monthly_2020-2026.csv");

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ""; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function csvCell(value) {
  if (value == null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const groups = new Map();
for (let year = 2020; year <= 2026; year++) {
  const file = path.join(inputDir, `temp_daegu_${year}.csv`);
  const rows = parseCsv((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  const headers = rows[0];
  const idx = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));
  for (const r of rows.slice(1)) {
    if (!r[idx["일시"]]) continue;
    const [y, m] = r[idx["일시"]].split("-").map(Number);
    if (m < 5 || m > 9) continue;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, { feels: [], temps: [], rhs: [], heat: 0, alert: 0, night: 0 });
    const g = groups.get(key);
    for (const [name, target] of [["최고체감온도(°C)", g.feels], ["평균기온(°C)", g.temps], ["평균상대습도(%)", g.rhs]]) {
      const n = Number(r[idx[name]]);
      if (Number.isFinite(n)) target.push(n);
    }
    if (r[idx["폭염여부(O/X)"]]?.trim().toUpperCase() === "O") g.heat++;
    if (r[idx["폭염특보(O/X)"]]?.trim().toUpperCase() === "O") g.alert++;
    if (r[idx["열대야(O/X)"]]?.trim().toUpperCase() === "O") g.night++;
  }
}

const avg = xs => xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "";
const outputRows = [["인덱스", "평균체감기온(°C)", "평균온도(°C)", "평균상대습도(%)", "폭염여부(일)", "폭염특보(일)", "열대야(일)"]];
for (let year = 2020; year <= 2026; year++) {
  for (let month = 5; month <= 9; month++) {
    const g = groups.get(`${year}-${String(month).padStart(2, "0")}`);
    outputRows.push(g
      ? [`${year}년 ${month}월`, avg(g.feels), avg(g.temps), avg(g.rhs), g.heat, g.alert, g.night]
      : [`${year}년 ${month}월`, "", "", "", "", "", ""]);
  }
}

const csv = "\uFEFF" + outputRows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, csv, "utf8");

// Artifact-tool validation: import the finished CSV and inspect its populated range.
const workbook = await Workbook.fromCSV(csv.replace(/^\uFEFF/, ""), { sheetName: "월별요약" });
const check = await workbook.inspect({ kind: "table", range: "월별요약!A1:G36", include: "values", tableMaxRows: 40, tableMaxCols: 7 });
console.log(check.ndjson);
console.log(`OUTPUT=${outputPath}`);
