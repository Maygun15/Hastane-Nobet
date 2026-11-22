// Excel / CSV dosyalarını güvenli okuma: tek giriş noktası.
// SheetJS 0.20.3 (vendor/xlsx-0.20.3.tgz) — CVE-2023-30533 ve CVE-2024-22363 düzeltmeli sürüm.
// Sınırlar: dosya boyutu, sayfa başı satır, biçim. Hatalar Türkçe ve anlaşılır.
import * as XLSX from "xlsx";

export const XLSX_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024, // 5 MB — personel / izin / çizelge dosyaları bunun çok altında
  maxRowsPerSheet: 5000,
  maxSheets: 50,
});

export const SUPPORTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

export class ExcelReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExcelReadError";
    this.code = code;
  }
}

const MB = (n) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

function byteLength(data) {
  if (data == null) return 0;
  if (typeof data === "string") return data.length;
  if (data.byteLength != null) return data.byteLength;
  if (data.length != null) return data.length;
  return 0;
}

// İlk baytlar: XLSX (zip "PK"), eski XLS (OLE D0 CF 11 E0), yoksa metin (CSV) kabul edilir.
function sniff(data) {
  let b;
  if (typeof data === "string") b = [0, 1, 2, 3].map((i) => data.charCodeAt(i) & 0xff);
  else {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data.buffer ? data.buffer : data, data.byteOffset || 0, Math.min(4, byteLength(data)));
    b = [u8[0], u8[1], u8[2], u8[3]];
  }
  if (b[0] === 0x50 && b[1] === 0x4b) return "xlsx";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "xls";
  return "text";
}

/** Dosya adını ve boyutunu okumadan ÖNCE denetler (FileReader'dan önce çağrılır). */
export function assertExcelFile(file, limits = XLSX_LIMITS) {
  if (!file) throw new ExcelReadError("NO_FILE", "Dosya seçilmedi.");
  const name = String(file.name || "").toLowerCase();
  if (name && !SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    throw new ExcelReadError("UNSUPPORTED_TYPE", `Desteklenmeyen dosya türü. Kabul edilenler: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
  }
  if (file.size > limits.maxBytes) {
    throw new ExcelReadError("FILE_TOO_LARGE", `Dosya çok büyük (${MB(file.size)}). En fazla ${MB(limits.maxBytes)} yüklenebilir; dosyayı bölün.`);
  }
  if (file.size === 0) throw new ExcelReadError("EMPTY_FILE", "Dosya boş.");
}

/**
 * XLSX.read yerine kullanılır. Aynı seçenekleri alır; boyut, sayfa ve satır sınırlarını uygular,
 * bozuk dosyada anlaşılır hata fırlatır.
 */
export function readWorkbook(data, opts = {}, limits = XLSX_LIMITS) {
  const size = byteLength(data);
  if (!size) throw new ExcelReadError("EMPTY_FILE", "Dosya boş.");
  if (size > limits.maxBytes) {
    throw new ExcelReadError("FILE_TOO_LARGE", `Dosya çok büyük (${MB(size)}). En fazla ${MB(limits.maxBytes)} yüklenebilir; dosyayı bölün.`);
  }
  const kind = sniff(data);
  let wb;
  try {
    wb = XLSX.read(data, { ...opts, cellFormula: false, cellHTML: false, sheetRows: limits.maxRowsPerSheet + 2 });
  } catch (e) {
    throw new ExcelReadError("CORRUPT_FILE", `Dosya okunamadı: bozuk ya da desteklenmeyen biçim (${kind === "text" ? "metin/CSV bekleniyordu" : kind.toUpperCase()}). Dosyayı Excel'de açıp .xlsx olarak yeniden kaydedin.`);
  }
  if (!wb || !Array.isArray(wb.SheetNames) || !wb.SheetNames.length) {
    throw new ExcelReadError("NO_SHEET", "Dosyada sayfa bulunamadı.");
  }
  if (wb.SheetNames.length > limits.maxSheets) {
    throw new ExcelReadError("TOO_MANY_SHEETS", `Dosyada çok fazla sayfa var (${wb.SheetNames.length}); en fazla ${limits.maxSheets}.`);
  }
  for (const n of wb.SheetNames) {
    const ref = wb.Sheets[n]?.["!fullref"] || wb.Sheets[n]?.["!ref"];
    if (!ref) continue;
    const rows = XLSX.utils.decode_range(ref).e.r + 1;
    if (rows > limits.maxRowsPerSheet + 1) {
      throw new ExcelReadError("TOO_MANY_ROWS", `"${n}" sayfasında ${rows} satır var; en fazla ${limits.maxRowsPerSheet} satır içe aktarılabilir. Dosyayı bölün.`);
    }
  }
  return wb;
}

/** Başlık doğrulaması: zorunlu sütunlardan biri yoksa hangi başlıkların beklendiğini söyler. */
export function assertHeaders(rows, required, { anyOf = [] } = {}) {
  const headers = new Set(Object.keys((rows && rows[0]) || {}).map((h) => String(h).trim()));
  const missing = required.filter((h) => !(Array.isArray(h) ? h.some((x) => headers.has(x)) : headers.has(h)));
  const anyOk = !anyOf.length || anyOf.some((h) => headers.has(h));
  if (missing.length || !anyOk) {
    const need = [...required.map((h) => (Array.isArray(h) ? h.join(" / ") : h)), ...(anyOf.length ? [anyOf.join(" / ")] : [])];
    throw new ExcelReadError("BAD_HEADERS", `Başlık satırı beklenen biçimde değil. Gerekli sütunlar: ${need.join(", ")}. Bulunan: ${[...headers].join(", ") || "yok"}.`);
  }
}

export function excelErrorMessage(e) {
  return e instanceof ExcelReadError ? e.message : `Excel dosyası okunamadı: ${e?.message || "geçersiz biçim"}`;
}

export { XLSX };
