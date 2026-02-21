// src/lib/importExcel.js
import * as XLSX from "xlsx";

// Türkçe/İngilizce başlıklara esnek eşleşme + "Gün" kolonundan tarih üretme (yıl/ay alınır)
function normalize(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLocaleUpperCase("tr-TR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, ""); // ş->s, ı->i vb.
}

export async function parseAssignmentsFile(file, opts = {}) {
  const { year, month0 } = opts; // Gün kolonundan tarih üretmek için kullanacağız.
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Excel sayfası bulunamadı.");

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  if (!aoa?.length || aoa.length < 2) throw new Error("Tablo boş görünüyor.");

  const header = aoa[0].map((x) => (x ?? "").toString().trim());
  const up = header.map(normalize);

  const findIdx = (alts) => {
    const altsUp = alts.map(normalize);
    return up.findIndex((h) => altsUp.some((a) => h.includes(a)));
  };

  // Esnek başlıklar
  const idxPersonId = findIdx(["PERSONID", "PERSON ID", "PERSONEL ID", "KISI ID", "ID"]);
  const idxFullName = findIdx(["FULLNAME", "AD SOYAD", "ADI SOYADI", "PERSONEL", "ISIM", "ADI"]);
  const idxService  = findIdx(["SERVICE", "SERVIS", "SERVIS ADI", "GOREV", "CALISMA ALANI", "ALAN"]);
  const idxShift    = findIdx(["SHIFTCODE", "VARDIYA", "VARDIYA KOD", "VARDIYA KODU"]);
  const idxDate     = findIdx(["DATE", "TARIH"]);
  const idxDay      = findIdx(["GUN", "GUN NO", "GUNNUMARASI", "DAY"]); // alternatif

  if (idxService < 0 || idxShift < 0 || (idxDate < 0 && idxDay < 0)) {
    throw new Error(
      `Excel doğrulaması başarısız: Gerekli başlıklar bulunamadı.
Gerekli: SERVİS/GÖREV, VARDİYA ve TARİH (veya GÜN).
Bulunan başlıklar: ${header.join(", ")}`
    );
  }

  const out = [];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const serviceRaw = row[idxService];
    const shiftRaw   = row[idxShift];
    const dateRaw    = idxDate >= 0 ? row[idxDate] : row[idxDay];

    // boş satırı atla
    if ((serviceRaw == null || serviceRaw === "") &&
        (shiftRaw == null || shiftRaw === "") &&
        (dateRaw == null || dateRaw === "")) continue;

    const service   = (serviceRaw ?? "").toString().trim();
    const shiftCode = (shiftRaw ?? "").toString().trim().split(/\s+/)[0];

    let date = dateRaw;
    // Eğer tarih kolonu yoksa ve "Gün" sayısı geldiyse: YYYY-MM-DD üret
    if (idxDate < 0 && idxDay >= 0 && Number.isInteger(Number(dateRaw)) &&
        Number.isInteger(year) && Number.isInteger(month0)) {
      const dd = Number(dateRaw);
      if (dd >= 1 && dd <= 31) {
        const d = new Date(year, month0, dd);
        date = d.toISOString().slice(0, 10); // 2025-09-05
      }
    }

    const personId = idxPersonId >= 0 ? row[idxPersonId] : undefined;
    const fullName = idxFullName >= 0 ? row[idxFullName] : undefined;

    out.push({ service, shiftCode, date, personId, fullName });
  }

  if (!out.length) throw new Error("Geçerli satır bulunamadı.");
  return out;
}
