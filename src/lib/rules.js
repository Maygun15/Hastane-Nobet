// src/lib/rules.js

export const GENERAL_RULES = {
  maxShiftsPerDay: 1,          // 1) Aynı gün birden fazla vardiya alamaz
  checkOverlapSameTime: true,  // 2) Aynı saatte iki farklı görev alamaz
  maxWeeklyHours: 80,          // 7) Haftalık maksimum saat
  balanceWeekdays: true,       // 8) Günlere dengeli dağılım
  balanceLocations: true,      // 9) Görev yerlerine dengeli dağılım
  balancePartners: true,       // 10) Birlikte çalışma dengesi
  overtimeAllowed: true,       // 12) Ücretli fazla mesai yazılabilir
  monthlyTargetMethod: "workdays*8h", // 11) Aylık hedef = resmi çalışma günü * 8
};

export const CUSTOM_RULES = {
  // 16) Yeşil alan kotaları (haftaiçi 3, haftasonu 4 V1)
  greenArea: {
    code: "YESIL",           // Alan kodunu UI’de ne kullanıyorsan onunla eşleştir
    quotas: {
      weekday: { V1: 3 },
      weekend: { V1: 4 },
    },
  },
  // 17) Haftasonu M4 yasak
  forbidWeekend: { M4: true },

  // 18) Servis sorumlusu ay boyunca sabit olacak (UI’dan seçilecek)
};

export const SHIFT_RULES = {
  M:  { start: "08:00", end: "16:00",
        nextDayAllowed: ["M","M1","M2","M3","M4","M5","M6","N","V1","V2"] },
  M1: { start: "08:00", end: "15:00",
        nextDayAllowed: ["M","M1","M2","M3","M4","M5","M6","N","V1","V2"] },
  M2: { start: "09:00", end: "16:00",
        nextDayAllowed: ["M","M1","M2","M3","M4","M5","M6","N","V1","V2"] },
  M3: { start: "10:00", end: "17:00",
        nextDayAllowed: ["M","M1","M2","M3","M4","M5","M6","N","V1","V2"] },
  M4: { start: "16:00", end: "00:00",
        nextDayAllowed: ["M","M1","M2","M3","M4","M5","M6","N","V1","V2"],
        avoidNextDay: ["N","V1","V2"], weekendForbidden: true },
  M5: { start: "08:00", end: "13:00",
        nextDayAllowed: ["M","M1","M2","M3","M4","M5","M6","N","V1","V2"] },
  M6: { start: "08:00", end: "14:00",
        nextDayAllowed: ["M","M1","M2","M3","M4","M5","M6","N","V1","V2"] },
  N:  { start: "08:00", end: "08:00", restAfterHours: 24 }, // ertesi gün çalışamaz
  V1: { start: "08:00", end: "00:00",
        nextDayAllowed: ["M","M1","M2","M3","M4","M5","M6","N","V1","V2"],
        avoidNextDay: ["N","V1","V2"] },
  V2: { start: "08:00", end: "08:00", restAfterHours: 24 },
};

export const LEAVE_RULES = {
  // code: { blocksShift, countsAsWorkHours, reduceMonthlyTarget, priority, notes... }
  AN: { specialCase: "noFirstDayOfMonthAfterPrevMonthLastNight",
        blocksShift: false, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  B:  { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0, priority: 2 },
  Bİ: { blocksShift: true, countsAsWorkHours: 8, reduceMonthlyTarget: 8 },
  Dİ: { blocksShift: true, countsAsWorkHours: 8, reduceMonthlyTarget: 8 },
  E:  { blocksShift: true, countsAsWorkHours: 8, reduceMonthlyTarget: 8 },
  Eİ: { blocksShift: true, countsAsWorkHours: 8, reduceMonthlyTarget: 8 },
  G:  { blocksShift: true, countsAsWorkHours: 8, reduceMonthlyTarget: 8 },
  H:  { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  İ:  { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  İİ: { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  R:  { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  RE: { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  S:  { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  Sİ: { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  SÜ: { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },   // basitleştirme
  SÜ1:{ blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  SÜ2:{ blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  U:  { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  Üİ: { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
  Y:  { blocksShift: true, countsAsWorkHours: 0, reduceMonthlyTarget: 8 },   // 8 saat hedeften düş
  KN: { specialCase: "forceShiftToday", blocksShift: false,
        countsAsWorkHours: 0, reduceMonthlyTarget: 0 },
};

// Uzmanlık & Sertifika uyumluluğu — UI’dan dolduracağız.
// Örn: { "YESIL": ["M","M1","M2","M3","M5","M6","V1"], "ACIL": ["M","M4","N","V1","V2"] }
export const AREA_SHIFT_MATRIX = {};

// Sertifika gereksinimleri — UI’dan dolduracağız.
// Örn: { "M4": ["travma"], "N": ["yogun_bakim"], "V1": [] }
export const SHIFT_CERT_REQUIREMENTS = {};
