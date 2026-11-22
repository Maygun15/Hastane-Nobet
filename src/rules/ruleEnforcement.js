// Nöbet Kuralları ekranındaki her kuralın çizelge motorunda GERÇEKTEN nasıl karşılandığı.
//
// Neden: ekranda 70 kural "Aktif/Katı" görünüyor ama motor bunların bir kısmını adıyla
// tanıyor. Yönetici "bu kural var" sanıp kontrol etmesin diye her kartta durum gösterilir.
//
// Kaynak (17 Kas 2026 envanteri, my-backend-project/services/scheduler):
//   ENGINE    → candidateBuilder/ruleRegistry.js + rules/dbRuleAdapter.js ile doğrudan uygulanır
//   TEMPLATE  → kural yerine görev satırı kişi sayısı (Çizelge Yapısı) ve personelin
//               çalışma alanı uygunluğu ile sağlanır
//   BALANCE   → katı kontrol yok; adalet sayaçları (gece/hafta sonu/toplam yük), izin engeli
//               veya tercih cezası ile yaklaşık olarak gözetilir
//   (listede yoksa) INFO → motor kontrol ETMEZ; yalnızca bilgi/politika notudur
//
// Motor değişince bu liste güncellenmeli. Belge: docs/KURAL_ENVANTERI.md

export const ENFORCEMENT = Object.freeze({
  ENGINE: "engine",
  TEMPLATE: "template",
  BALANCE: "balance",
  INFO: "info",
});

const ENGINE_RULES = [
  "ONE_SHIFT_PER_DAY",
  "NO_MULTIPLE_ASSIGNMENTS_PER_DAY",
  "NO_DOUBLE_BOOKING",
  "NIGHT_NEXT_DAY_OFF",
  "NO_IMMEDIATE_NEXT_NIGHT_AFTER_NIGHT",
  "MIN_REST_11H",
  "MIN_GAP_12H",
  "MAX_CONSECUTIVE_6D",
  "WEEKLY_MAX_SHIFTS",
  "MAX_TASK_PER_PERSON",
  "LEAVE_BLOCK_GENERIC",
  "WEEKLY_MAX_80H", // Kurum kuralları → "Haftada en fazla çalışma saati" (değer girilirse)
  // Kayan 7 günde en az 1 boş gün ≡ en fazla 6 gün art arda (MAX_CONSECUTIVE_DAYS ≤ 6).
  "WEEKLY_MIN_1_OFF",
];

const TEMPLATE_RULES = [
  "QUAL_ONLY_IN_SPECIALTY",
  "NO_UNQUALIFIED_ASSIGN",
  "TRIAGE_NURSES_ONLY",
  "RESUS_MIN_TWO",
  "RED_YELLOW_CHILD_MIN1",
  "GREEN_MIN_STAFF",
  "PHARMACY_ONE_PER_24H",
  "SERVICE_LEAD_WEEKDAY_DAY",
  "RED_YELLOW_TEAMLEAD_ONE",
  "SURGERY_ROOM_MIN2",
  "SUPERVISOR_UNUSED",
  "VACCINATION_UNUSED",
];

const BALANCE_RULES = [
  "NIGHT_FAIR_DISTRIBUTION",
  "WEEKEND_NIGHTS_FAIR",
  "FAIR_TOTAL_LOAD",
  "CONSIDER_PREFERRED_SHIFTS",
  "AVOID_MAZERET_DAYS",
  "NO_OVERLAP_SHIFTS",
  "NO_OVERLAP_ANY",
];

const MAP = new Map([
  ...ENGINE_RULES.map((id) => [id, ENFORCEMENT.ENGINE]),
  ...TEMPLATE_RULES.map((id) => [id, ENFORCEMENT.TEMPLATE]),
  ...BALANCE_RULES.map((id) => [id, ENFORCEMENT.BALANCE]),
]);

export function getRuleEnforcement(ruleId) {
  return MAP.get(String(ruleId || "").trim()) || ENFORCEMENT.INFO;
}

export const ENFORCEMENT_LABEL = Object.freeze({
  [ENFORCEMENT.ENGINE]: {
    text: "Motor uygular",
    title: "Çizelge motoru bu kuralı her atamada kontrol eder.",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  [ENFORCEMENT.TEMPLATE]: {
    text: "Şablon/alan ile",
    title: "Kural olarak değil; Çizelge Yapısı'ndaki görev satırı kişi sayısı ve personelin çalışma alanı ile sağlanır. Şablonu doğru kurun.",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  [ENFORCEMENT.BALANCE]: {
    text: "Yaklaşık (denge)",
    title: "Katı kontrol yok; adalet sayaçları, izin engeli veya tercih cezasıyla gözetilir. Sonucu Adillik Raporu'ndan kontrol edin.",
    className: "bg-violet-50 text-violet-700 border-violet-200",
  },
  [ENFORCEMENT.INFO]: {
    text: "Bilgi — motor kontrol etmez",
    title: "Çizelge motoru bu kuralı kontrol ETMEZ. Yayınlamadan önce elle kontrol edin.",
    className: "bg-amber-50 text-amber-800 border-amber-300",
  },
});
