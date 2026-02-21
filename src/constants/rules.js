// src/constants/rules.js
// Kaynak: Parametreler → Çalışma Saatleri (Vardiya Tanımları) tablosu

/** Vardiya kodu → saat karşılığı */
export const SHIFT_HOURS = {
  M: 8,    // 08:00-16:00
  M1: 7,   // 08:00-15:00
  M2: 7,   // 09:00-16:00
  M3: 7,   // 10:00-17:00
  M4: 8,   // 16:00-00:00
  M5: 5,   // 08:00-13:00
  M6: 6,   // 08:00-14:00
  N: 24,   // 08:00-08:00
  V1: 16,  // 08:00-00:00
  V2: 24,  // 08:00-08:00
  OFF: 0,  // Boş / izinli gün
};

/**
 * İzin kuralları:
 *  - countsAsWorked: true ise “çalışılmış sayılır” ve zorunlu saatten düşülür.
 *  - hoursPerDay: o izin gününde kaç saat sayılacağı (varsayılan 8).
 *  Not: İhtiyaca göre kod ve saatleri genişletebiliriz.
 */
export const LEAVE_RULES = {
  // code: { countsAsWorked, hoursPerDay }
  AN: { countsAsWorked: false, hoursPerDay: 0 }, // Ay sonu / özel durum
  B:  { countsAsWorked: false, hoursPerDay: 0 }, // Boşluk isteği / izin (çalışılmış sayılmaz)
  Bİ: { countsAsWorked: true,  hoursPerDay: 8 }, // Babalık İzni
  Dİ: { countsAsWorked: true,  hoursPerDay: 8 }, // Doğum İzni
  E:  { countsAsWorked: true,  hoursPerDay: 8 }, // Eğitim İzni
  Eİ: { countsAsWorked: true,  hoursPerDay: 8 }, // Evlilik İzni
  G:  { countsAsWorked: true,  hoursPerDay: 8 }, // Görevli/UMKE vb.
  H:  { countsAsWorked: false, hoursPerDay: 0 },
  "İ":  { countsAsWorked: false, hoursPerDay: 0 }, // İdari izin (varsayılan: sayılmaz)
  "İİ": { countsAsWorked: false, hoursPerDay: 0 },
  R:  { countsAsWorked: false, hoursPerDay: 0 }, // Rapor
  RE: { countsAsWorked: false, hoursPerDay: 0 },
  S:  { countsAsWorked: false, hoursPerDay: 0 },
  Sİ: { countsAsWorked: false, hoursPerDay: 0 },
  SÜ: { countsAsWorked: false, hoursPerDay: 0 }, // Süt izni (saatlikse ayrıca ele alınır)
  SÜ1:{ countsAsWorked: false, hoursPerDay: 0 },
  SÜ2:{ countsAsWorked: false, hoursPerDay: 0 },
  U:  { countsAsWorked: false, hoursPerDay: 0 }, // Ücretsiz izin
  "Üİ": { countsAsWorked: false, hoursPerDay: 0 },
  Y:  { countsAsWorked: true,  hoursPerDay: 8 }, // Yıllık İzin → hedeften 8s düşer
  KN: { countsAsWorked: false, hoursPerDay: 0 }, // Kısa nöbet / özel kural
};

/** Güvenli okuma yardımcıları (opsiyonel) */
export const getShiftHours = (code) => {
  const h = SHIFT_HOURS[code];
  return Number.isFinite(h) ? h : 0;
};
export const getLeaveCredit = (code) => {
  const r = LEAVE_RULES[code];
  if (!r || !r.countsAsWorked) return 0;
  return Number.isFinite(r.hoursPerDay) ? r.hoursPerDay : 8;
};
