// Excel içe aktarma eşlemeleri — saf fonksiyonlar (bileşenden bağımsız test edilir).
//  • parsePeopleRows: Personel listesi (Parametreler → Personel → Excel'den yükle)
//  • matchLeaveRows : Toplu izin listesi (Çizelgeler → Toplu İzin → Excel'den yükle)
// Ad eşleştirme Türkçe büyük/küçük harf kurallarıyla yapılır (İ/ı, Ş, Ğ …).

/** Türkçe ad anahtarı: boşluk sadeleştirme + tr-TR büyük harf. "  ayşe  ılık " → "AYŞE ILIK" */
export function trKey(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("tr-TR");
}

const cell = (r, keys) => {
  for (const k of keys) {
    if (r[k] != null && String(r[k]).trim() !== "") return String(r[k]).trim();
  }
  return "";
};
const list = (v) => String(v || "").split(/,|;/).map((s) => s.trim()).filter(Boolean);

export const PEOPLE_HEADERS = ["ROL", "SERVIS", "UNVANI", "T.C. KİMLİK NO", "AD SOYAD", "TELEFON NUMARASI", "MAİL ADRESİ", "ÇALIŞMA ALANLARI", "VARDİYE KODLARI"];

/**
 * @param rows  sheet_to_json(..., { defval: "" }) çıktısı
 * @param ctx   { role, defaultTitle, resolveService(raw) → id, workAreas: [{id,name}], idBase }
 * @returns { people, skipped: [{ row, reason }] }   row: Excel satır numarası (başlık = 1)
 */
export function parsePeopleRows(rows, ctx) {
  const { role, defaultTitle, resolveService = (x) => x, workAreas = [], idBase = Date.now() } = ctx || {};
  const people = [];
  const skipped = [];
  (rows || []).forEach((r, idx) => {
    const excelRow = idx + 2;
    const name = cell(r, ["AD SOYAD", "NAME"]);
    const rrole = cell(r, ["ROL"]) || role;
    if (!name) {
      if (Object.values(r || {}).some((v) => String(v ?? "").trim() !== "")) skipped.push({ row: excelRow, reason: "AD SOYAD boş" });
      return;
    }
    if (rrole !== role) { skipped.push({ row: excelRow, reason: `ROL "${rrole}" bu listeye ait değil` }); return; }
    const areaNames = list(cell(r, ["ÇALIŞMA ALANLARI", "ALANLAR"]));
    const explicitIds = list(cell(r, ["ÇALIŞMA ALANI IDLERİ", "ÇALIŞMA ALANI IDLERI", "ALAN IDLERİ", "ALAN IDLERI", "WORK AREA IDS", "WORKAREAIDS"]));
    const byName = new Map((workAreas || []).map((w) => [trKey(w.name), w.id]));
    const workAreaIds = explicitIds.length ? explicitIds : areaNames.map((nm) => byName.get(trKey(nm))).filter(Boolean);
    const id = idBase + idx;
    people.push({
      id,
      personId: String(id),
      role,
      service: resolveService(cell(r, ["SERVIS", "SERVİS"])),
      title: cell(r, ["UNVANI", "UNVAN"]) || defaultTitle,
      tc: cell(r, ["T.C. KİMLİK NO", "TC"]),
      name,
      phone: cell(r, ["TELEFON NUMARASI", "TELEFON"]),
      mail: cell(r, ["MAİL ADRESİ", "MAIL"]),
      workAreaIds,
      areas: areaNames,
      shiftCodes: list(cell(r, ["VARDİYE KODLARI", "VARDIYE KODLARI", "VARDİYA KODLARI", "VARDIYA KODLARI"])).map((c) => c.toLocaleUpperCase("tr-TR")),
    });
  });
  return { people, skipped };
}

/** "5", "05", "5. gün", "Gün 5" → 5; 1..31 dışı → NaN */
export function extractDay(h) {
  const m = String(h ?? "").match(/\d{1,2}/);
  if (!m) return NaN;
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= 31 ? n : NaN;
}

/**
 * Toplu izin matrisi: başlık [personId | ad soyad, 1..31], hücre = izin kodu.
 * @returns { dayColumns, rows: [{ excelRow, pid, person, cells: [{ day, code }] }], unmatched: [{ excelRow, name }], error }
 */
export function matchLeaveRows({ header = [], rows = [] }, { daysInMonth, people = [] }) {
  const lower = header.map((h) => String(h || "").trim().toLocaleLowerCase("tr-TR"));
  const idxId = lower.findIndex((h) => h === "personid" || h === "id");
  const idxName = lower.findIndex((h) => ["name", "ad", "ad soyad", "adı soyadı", "personel"].includes(h));
  const seen = new Set();
  const dayColumns = header
    .map((h, i) => [extractDay(h), i])
    .filter(([d]) => Number.isFinite(d) && d >= 1 && d <= daysInMonth)
    .sort((a, b) => a[0] - b[0])
    .filter(([d]) => (seen.has(d) ? false : (seen.add(d), true)));
  if (idxId < 0 && idxName < 0) return { dayColumns, rows: [], unmatched: [], error: "Kişi sütunu bulunamadı (personId ya da Ad Soyad)." };
  if (!dayColumns.length) return { dayColumns, rows: [], unmatched: [], error: "Gün sütunları bulunamadı (1–31 başlıklı sütunlar)." };

  const byName = new Map((people || []).map((p) => [trKey(p.fullName || p.name), p]));
  const byId = new Map((people || []).map((p) => [String(p.id), p]));
  const out = [];
  const unmatched = [];
  rows.forEach((cols, i) => {
    const excelRow = i + 2;
    const rawId = idxId >= 0 ? String(cols[idxId] ?? "").trim() : "";
    const rawName = idxName >= 0 ? String(cols[idxName] ?? "").trim() : "";
    let person = (rawName && byName.get(trKey(rawName))) || null;
    let pid = rawId || (person ? String(person.id) : "");
    if (!person && pid) person = byId.get(pid) || null;
    // Boş hücre de döner (code: "") — içe aktarma o günün iznini kaldırır (mevcut davranış).
    const cells = dayColumns.map(([day, ci]) => ({ day, code: String(cols[ci] ?? "").trim().toLocaleUpperCase("tr-TR") }));
    if (!pid) {
      if (rawName || cells.some((c) => c.code)) unmatched.push({ excelRow, name: rawName || "(ad yok)" });
      return;
    }
    out.push({ excelRow, pid, person, cells });
  });
  return { dayColumns, rows: out, unmatched, error: null };
}

/** Yerel takvim günü → "YYYY-MM-DD" (toISOString saat dilimi kayması yapmaz). */
export function ymd(year, month0, day) {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
