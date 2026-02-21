// src/lib/xlsxIO.js
import * as XLSX from "xlsx";

/** Basit CSV ayrıştırıcı (tırnaklara duyarlı) */
function splitCsvLine(line) {
  const re = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/g;
  return line.split(re).map((t) => {
    const x = t.trim();
    return x.startsWith('"') && x.endsWith('"')
      ? x.slice(1, -1).replace(/""/g, '"')
      : x;
  });
}
function parseCSV(text) {
  const lines = (text || "").replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]).map((h) => String(h || "").trim());
  const rows = lines.slice(1).map(splitCsvLine);
  return { header, rows };
}

/**
 * .xlsx/.xls/.csv okur ve 2D tablo döndürür.
 * @returns { header: string[], rows: string[][], warnings: string[] }
 */
export async function readTabularFile(file) {
  const warnings = [];
  const name = (file?.name || "").toLowerCase();

  // CSV ise yerel ayrıştırıcı
  if (name.endsWith(".csv") || (file.type && file.type.includes("csv"))) {
    const text = await file.text();
    const { header, rows } = parseCSV(text);
    return { header, rows, warnings };
  }

  // XLSX / XLS
  try {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows2d = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    const header = (rows2d[0] || []).map((v) => String(v ?? "").trim());
    const rows = rows2d.slice(1).map((r) => header.map((_, i) => String((r && r[i]) ?? "").trim()));
    return { header, rows, warnings };
  } catch (e) {
    warnings.push("Dosya okunamadı. Dosya bozuk olabilir veya desteklenmeyen biçim.");
    return { header: [], rows: [], warnings };
  }
}
