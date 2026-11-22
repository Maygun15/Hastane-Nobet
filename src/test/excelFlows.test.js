// Excel akışları — gerçek dosya baytlarıyla (SheetJS 0.20.3 yazar, uygulamanın okuyucusu okur).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import * as XLSX from "xlsx";
import { readWorkbook, assertExcelFile, assertHeaders, ExcelReadError, XLSX_LIMITS } from "../lib/safeXlsx";
import { parsePeopleRows, matchLeaveRows, PEOPLE_HEADERS, trKey } from "../lib/excelImports";
import { parseAssignmentsFile } from "../lib/importExcel";
import { readTabularFile } from "../lib/xlsxIO";

const toBytes = (aoa, { bookType = "xlsx", sheet = "Sayfa1", cellDates = false } = {}) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates }), sheet);
  const out = XLSX.write(wb, { bookType, type: bookType === "csv" ? "string" : "array" });
  return out;
};
const fileOf = (data, name) => {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  return { name, size: buf.byteLength, type: "", arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), text: async () => new TextDecoder().decode(buf) };
};
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e instanceof ExcelReadError ? e.code : `başka: ${e.message}`; } };

let tz;
beforeAll(() => { tz = process.env.TZ; process.env.TZ = "Europe/Istanbul"; });
afterAll(() => { process.env.TZ = tz; });

describe("kurulu kütüphane", () => {
  test("SheetJS 0.20.3 (CVE-2023-30533 ≥0.19.3, CVE-2024-22363 ≥0.20.2 düzeltmeli)", () => {
    expect(XLSX.version).toBe("0.20.3");
  });
});

describe("personel içe aktarma", () => {
  const aoa = [
    PEOPLE_HEADERS,
    ["Nurse", "ACİL", "HEMŞİRE", "", "İSMAİL ÇAĞLAR", "", "", "KIRMIZI, triaj", "m; N ;v1"],
    ["Nurse", "", "", "", "  ayşe   ılgaz ", "", "", "ÇOCUK", "M"],
    ["", "", "", "", "", "", "", "", ""], // boş satır → sessizce atlanır
    ["Doctor", "", "", "", "DR. ÖZGÜR ŞEN", "", "", "", ""], // başka liste
    ["Nurse", "", "", "", "", "", "", "KIRMIZI", "N"], // ad yok
  ];
  const workAreas = [{ id: "wa-k", name: "KIRMIZI" }, { id: "wa-t", name: "TRİAJ" }, { id: "wa-c", name: "ÇOCUK" }];

  test("Türkçe adlar, alanlar ve vardiya kodları kaynaktaki kayıtlarla aynı; atlanan satırlar nedenli", () => {
    const wb = readWorkbook(toBytes(aoa), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    assertHeaders(rows, [["AD SOYAD", "NAME"]]);
    const { people, skipped } = parsePeopleRows(rows, { role: "Nurse", defaultTitle: "Hemşire", resolveService: (x) => x || "SVC-VARSAYILAN", workAreas, idBase: 1000 });
    expect(people.map((p) => ({ name: p.name, service: p.service, title: p.title, areas: p.areas, workAreaIds: p.workAreaIds, shiftCodes: p.shiftCodes }))).toEqual([
      { name: "İSMAİL ÇAĞLAR", service: "ACİL", title: "HEMŞİRE", areas: ["KIRMIZI", "triaj"], workAreaIds: ["wa-k", "wa-t"], shiftCodes: ["M", "N", "V1"] },
      { name: "ayşe   ılgaz", service: "SVC-VARSAYILAN", title: "Hemşire", areas: ["ÇOCUK"], workAreaIds: ["wa-c"], shiftCodes: ["M"] },
    ]);
    expect(skipped).toEqual([
      { row: 5, reason: 'ROL "Doctor" bu listeye ait değil' },
      { row: 6, reason: "AD SOYAD boş" },
    ]);
  });

  test("hatalı başlık anlaşılır hata verir", () => {
    const wb = readWorkbook(toBytes([["ADI", "SOYADI"], ["A", "B"]]), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    expect(() => assertHeaders(rows, [["AD SOYAD", "NAME"]])).toThrow(/Gerekli sütunlar: AD SOYAD \/ NAME.*Bulunan: ADI, SOYADI/);
  });
});

describe("toplu izin içe aktarma", () => {
  const people = [{ id: "p1", name: "İSMAİL ÇAĞLAR" }, { id: "p2", fullName: "IŞIL ŞAHİN" }];
  const header = ["Ad Soyad", ...Array.from({ length: 31 }, (_, i) => String(i + 1))];
  const row = (name, cells) => [name, ...Array.from({ length: 31 }, (_, i) => cells[i + 1] || "")];

  test("küçük harf / İ-ı farkıyla yazılmış ad eşleşir; kodlar, boş hücreler ve ay sonu doğru", async () => {
    const aoa = [header, row("ismail çağlar", { 3: "y", 4: "Y", 30: "R" }), row("ışıl şahin", { 1: "R" }), row("OLMAYAN KİŞİ", { 2: "Y" })];
    const table = await readTabularFile(fileOf(toBytes(aoa), "izin.xlsx"));
    expect(table.warnings).toEqual([]);
    const m = matchLeaveRows(table, { daysInMonth: 28, people }); // Şubat: 29–31 yok sayılır
    expect(m.error).toBeNull();
    expect(m.dayColumns.length).toBe(28);
    const p1 = m.rows.find((r) => r.pid === "p1");
    expect(p1.cells.filter((c) => c.code)).toEqual([{ day: 3, code: "Y" }, { day: 4, code: "Y" }]); // 30 Şubat yok
    expect(p1.cells.find((c) => c.day === 5).code).toBe(""); // boş hücre → izin kaldırılır
    expect(m.rows.find((r) => r.pid === "p2").cells.filter((c) => c.code)).toEqual([{ day: 1, code: "R" }]);
    expect(m.unmatched).toEqual([{ excelRow: 4, name: "OLMAYAN KİŞİ" }]);
  });

  test("CSV ve eski XLS biçimleri aynı sonucu verir", async () => {
    const aoa = [header, row("İSMAİL ÇAĞLAR", { 10: "Y" })];
    for (const [bookType, name] of [["csv", "izin.csv"], ["biff8", "izin.xls"]]) {
      const table = await readTabularFile(fileOf(toBytes(aoa, { bookType }), name));
      const m = matchLeaveRows(table, { daysInMonth: 31, people });
      expect([name, m.rows[0]?.pid, m.rows[0]?.cells.filter((c) => c.code)]).toEqual([name, "p1", [{ day: 10, code: "Y" }]]);
    }
  });

  test("kişi ya da gün sütunu yoksa açıklama döner", () => {
    expect(matchLeaveRows({ header: ["X", "1"], rows: [] }, { daysInMonth: 31 }).error).toMatch(/Kişi sütunu/);
    expect(matchLeaveRows({ header: ["Ad Soyad", "Not"], rows: [] }, { daysInMonth: 31 }).error).toMatch(/Gün sütunları/);
  });

  test("Türkçe ad anahtarı", () => {
    expect(trKey("  ışıl   şahin ")).toBe("IŞIL ŞAHİN");
    expect(trKey("ismail")).toBe(trKey("İSMAİL"));
  });
});

describe("çizelge (atama) içe aktarma — tarih ve saat", () => {
  test("GÜN sütunundan tarih Türkiye saatinde kaymaz; vardiya kodu ve saat metni korunur", async () => {
    const aoa = [["SERVİS", "VARDİYA", "GÜN", "AD SOYAD", "SAAT"], ["KIRMIZI", "N 08:00-08:00", 5, "İSMAİL ÇAĞLAR", "08:00"], ["TRİAJ", "V1", 31, "IŞIL ŞAHİN", "16:00"]];
    const out = await parseAssignmentsFile(fileOf(toBytes(aoa), "atama.xlsx"), { year: 2026, month0: 11 });
    expect(out.map((x) => [x.service, x.shiftCode, x.date, x.fullName])).toEqual([
      ["KIRMIZI", "N", "2026-12-05", "İSMAİL ÇAĞLAR"],
      ["TRİAJ", "V1", "2026-12-31", "IŞIL ŞAHİN"],
    ]);
  });

  test("Excel tarih hücresi ve saat hücresi metin olarak doğru okunur", async () => {
    const aoa = [["Tarih", "Başlangıç"], [new Date(Date.UTC(2026, 11, 5)), "08:00"]];
    const table = await readTabularFile(fileOf(toBytes(aoa, { cellDates: true }), "t.xlsx"));
    expect(table.rows[0][1]).toBe("08:00");
    expect(table.rows[0][0]).toMatch(/12\/5\/26|2026-12-05|5\.12\.2026/);
  });
});

describe("çizelge dışa aktarma — gidiş-dönüş", () => {
  test("Türkçe görev adları, çok satırlı isimler, sayfa adları ve kodlar korunur", () => {
    const aoaAssign = [["Görev", "Vardiya", "1", "2"], ["KIRMIZI ALAN", "N", "İSMAİL ÇAĞLAR\nIŞIL ŞAHİN", ""], ["TRİAJ", "V1", "", "ÖZGÜR ŞEN"]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoaAssign), "Cizelge-Atama");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Gün", "Görev", "Not"], [3, "TRİAJ", "Yeterli aday bulunamadı"]]), "Uyarılar");
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const back = readWorkbook(bytes, { type: "array" });
    expect(back.SheetNames).toEqual(["Cizelge-Atama", "Uyarılar"]);
    expect(XLSX.utils.sheet_to_json(back.Sheets["Cizelge-Atama"], { header: 1, defval: "" })).toEqual(aoaAssign);
  });
});

describe("hatalı dosyalar ve sınırlar", () => {
  test("boş, bozuk, çok büyük, çok satırlı ve desteklenmeyen dosya anlaşılır hata verir", () => {
    expect(codeOf(() => readWorkbook(new Uint8Array(0)))).toBe("EMPTY_FILE");
    // XLSX imzası (PK) ile başlayıp devamı bozuk zip
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Array.from({ length: 200 }, (_, i) => (i * 37) % 256)]);
    expect(codeOf(() => readWorkbook(broken, { type: "array" }))).toBe("CORRUPT_FILE");
    const big = toBytes([["A"], ["x"]]);
    expect(codeOf(() => readWorkbook(big, { type: "array" }, { ...XLSX_LIMITS, maxBytes: 100 }))).toBe("FILE_TOO_LARGE");
    const many = toBytes([["A"], ...Array.from({ length: 50 }, (_, i) => [i])]);
    expect(codeOf(() => readWorkbook(many, { type: "array" }, { ...XLSX_LIMITS, maxRowsPerSheet: 10 }))).toBe("TOO_MANY_ROWS");
    expect(codeOf(() => assertExcelFile({ name: "rapor.pdf", size: 10 }))).toBe("UNSUPPORTED_TYPE");
    expect(codeOf(() => assertExcelFile({ name: "liste.xlsx", size: 6 * 1024 * 1024 }))).toBe("FILE_TOO_LARGE");
    expect(codeOf(() => assertExcelFile({ name: "liste.xlsx", size: 2000 }))).toBeNull();
  });

  test("bozuk dosyada okuyucu hata mesajını uyarı olarak döndürür", async () => {
    const t = await readTabularFile(fileOf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]), "x.xlsx"));
    expect(t.header).toEqual([]);
    expect(t.warnings[0]).toMatch(/bozuk ya da desteklenmeyen/);
  });

  test("sınır içindeki gerçek boyutlu dosya (2000 personel) okunur", () => {
    const aoa = [PEOPLE_HEADERS, ...Array.from({ length: 2000 }, (_, i) => ["Nurse", "", "", "", `SENTETİK KİŞİ ${i + 1}`, "", "", "KIRMIZI", "N"])];
    const wb = readWorkbook(toBytes(aoa), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    expect(parsePeopleRows(rows, { role: "Nurse", workAreas: [] }).people.length).toBe(2000);
  });
});
