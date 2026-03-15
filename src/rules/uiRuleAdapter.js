// src/rules/uiRuleAdapter.js
// UI rule id sistemini unified hard rule kimlikleri ile güvenli şekilde eşler.
// Bu dosya sadece metadata / adapter katmanıdır; runtime enforcement yapmaz.

export const UI_RULE_VALUE_TYPES = Object.freeze({
  NONE: "none",
  NUMBER: "number",
  BOOLEAN: "boolean",
  SELECT: "select",
});

export const UI_RULE_GROUPS = Object.freeze({
  PERSONNEL: "personnel_and_eligibility",
  LEAVE: "leave_and_attendance",
  REST: "shift_and_rest",
  TASK: "task_and_assignment",
  FAIRNESS: "fairness_and_balance",
});

export const UI_TO_UNIFIED_RULE_MAPPINGS = Object.freeze([
  makeUiRuleMapping({
    uiRuleId: "ONE_SHIFT_PER_DAY",
    unifiedCode: "ONE_SHIFT_PER_DAY",
    schedulerKey: "ONE_SHIFT_PER_DAY",
    candidateRuleCode: "ONE_SHIFT_PER_DAY",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "LEAVE_BLOCK_GENERIC",
    unifiedCode: "LEAVE_BLOCK",
    schedulerKey: "LEAVE_BLOCK",
    candidateRuleCode: "LEAVE_BLOCK",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "LEAVE_BLOCK",
    unifiedCode: "LEAVE_BLOCK",
    schedulerKey: "LEAVE_BLOCK",
    candidateRuleCode: "LEAVE_BLOCK",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "NIGHT_NEXT_DAY_OFF",
    unifiedCode: "REST_AFTER_NIGHT",
    schedulerKey: "NIGHT_NEXT_DAY_OFF",
    candidateRuleCode: "REST_AFTER_NIGHT",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "MIN_REST_HOURS",
    unifiedCode: "MIN_REST_HOURS",
    schedulerKey: "MIN_REST_HOURS",
    candidateRuleCode: null,
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "MIN_REST_11H",
    unifiedCode: "MIN_REST_HOURS",
    schedulerKey: "MIN_REST_HOURS",
    candidateRuleCode: null,
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "MIN_GAP_12H",
    unifiedCode: "MIN_REST_HOURS",
    schedulerKey: "MIN_REST_HOURS",
    candidateRuleCode: null,
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "MAX_CONSECUTIVE_6D",
    unifiedCode: "MAX_CONSECUTIVE_DAYS",
    schedulerKey: "MAX_CONSECUTIVE_DAYS",
    candidateRuleCode: "MAX_CONSECUTIVE_DAYS",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "MAX_CONSECUTIVE_DAYS",
    unifiedCode: "MAX_CONSECUTIVE_DAYS",
    schedulerKey: "MAX_CONSECUTIVE_DAYS",
    candidateRuleCode: "MAX_CONSECUTIVE_DAYS",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "MAX_SHIFTS_PER_WEEK",
    unifiedCode: "MAX_SHIFTS_PER_WEEK",
    schedulerKey: "MAX_SHIFTS_PER_WEEK",
    candidateRuleCode: "MAX_WEEKLY_SHIFTS",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "WEEKLY_MAX_SHIFTS",
    unifiedCode: "MAX_SHIFTS_PER_WEEK",
    schedulerKey: "MAX_SHIFTS_PER_WEEK",
    candidateRuleCode: "MAX_WEEKLY_SHIFTS",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "WEEKLY_MAX_DUTIES",
    unifiedCode: "MAX_SHIFTS_PER_WEEK",
    schedulerKey: "MAX_SHIFTS_PER_WEEK",
    candidateRuleCode: "MAX_WEEKLY_SHIFTS",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "MAX_TASK_PER_PERSON",
    unifiedCode: "MAX_TASK_PER_PERSON",
    schedulerKey: "MAX_TASK_PER_PERSON",
    candidateRuleCode: null,
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "MAX_SAME_TASK_PER_PERSON",
    unifiedCode: "MAX_TASK_PER_PERSON",
    schedulerKey: "MAX_TASK_PER_PERSON",
    candidateRuleCode: null,
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "ACTIVE_REQUIRED",
    unifiedCode: "ACTIVE_REQUIRED",
    schedulerKey: null,
    candidateRuleCode: "ACTIVE_REQUIRED",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "SERVICE_MATCH",
    unifiedCode: "SERVICE_MATCH",
    schedulerKey: null,
    candidateRuleCode: "SERVICE_MATCH",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "ROLE_ELIGIBILITY",
    unifiedCode: "ROLE_ELIGIBILITY",
    schedulerKey: null,
    candidateRuleCode: "ROLE_ELIGIBILITY",
    mappingConfidence: "exact",
  }),
  makeUiRuleMapping({
    uiRuleId: "SECTION_ELIGIBILITY",
    unifiedCode: "SECTION_ELIGIBILITY",
    schedulerKey: null,
    candidateRuleCode: "SECTION_ELIGIBILITY",
    mappingConfidence: "exact",
  }),
  // UI kütüphanesinde görülen alan için güvenli ama birebir olmayan eşleme.
  makeUiRuleMapping({
    uiRuleId: "TRIAGE_NURSES_ONLY",
    unifiedCode: "ROLE_ELIGIBILITY",
    schedulerKey: null,
    candidateRuleCode: "ROLE_ELIGIBILITY",
    mappingConfidence: "optional",
  }),
]);

export const UI_RULE_META_BY_UNIFIED_CODE = Object.freeze({
  ONE_SHIFT_PER_DAY: makeUiRuleMeta({
    code: "ONE_SHIFT_PER_DAY",
    labelTr: "Bir Günde Tek Vardiya",
    shortLabelTr: "Aynı Gün Tek Vardiya",
    descriptionTr: "Bir personele aynı gün içinde birden fazla vardiya atanmasını engeller.",
    categoryTr: "Vardiya ve Dinlenme",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: false,
    valueType: UI_RULE_VALUE_TYPES.BOOLEAN,
    uiGroup: UI_RULE_GROUPS.REST,
    uiOrder: 10,
  }),
  LEAVE_BLOCK: makeUiRuleMeta({
    code: "LEAVE_BLOCK",
    labelTr: "İzinli Personel Blokajı",
    shortLabelTr: "İzin Blokajı",
    descriptionTr: "İzinli, raporlu veya devamsız personelin ilgili günlerde planlanmasını engeller.",
    categoryTr: "İzin ve Devamsızlık",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: false,
    valueType: UI_RULE_VALUE_TYPES.BOOLEAN,
    uiGroup: UI_RULE_GROUPS.LEAVE,
    uiOrder: 20,
  }),
  REST_AFTER_NIGHT: makeUiRuleMeta({
    code: "REST_AFTER_NIGHT",
    labelTr: "Gece Sonrası Dinlenme",
    shortLabelTr: "Gece Sonrası Dinlenme",
    descriptionTr: "Gece vardiyası sonrası gerekli dinlenme süresi tamamlanmadan yeni görev verilmesini engeller.",
    categoryTr: "Vardiya ve Dinlenme",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: false,
    valueType: UI_RULE_VALUE_TYPES.BOOLEAN,
    uiGroup: UI_RULE_GROUPS.REST,
    uiOrder: 30,
  }),
  MIN_REST_HOURS: makeUiRuleMeta({
    code: "MIN_REST_HOURS",
    labelTr: "Minimum Dinlenme Saati",
    shortLabelTr: "Dinlenme Saati",
    descriptionTr: "İki vardiya arasında tanımlı minimum dinlenme süresini zorunlu kılar.",
    categoryTr: "Vardiya ve Dinlenme",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: true,
    valueType: UI_RULE_VALUE_TYPES.NUMBER,
    uiGroup: UI_RULE_GROUPS.REST,
    uiOrder: 40,
  }),
  MAX_CONSECUTIVE_DAYS: makeUiRuleMeta({
    code: "MAX_CONSECUTIVE_DAYS",
    labelTr: "Maksimum Ardışık Çalışma Günü",
    shortLabelTr: "Ardışık Gün Limiti",
    descriptionTr: "Bir personelin art arda çalışabileceği maksimum gün sayısını sınırlar.",
    categoryTr: "Vardiya ve Dinlenme",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: true,
    valueType: UI_RULE_VALUE_TYPES.NUMBER,
    uiGroup: UI_RULE_GROUPS.REST,
    uiOrder: 50,
  }),
  MAX_SHIFTS_PER_WEEK: makeUiRuleMeta({
    code: "MAX_SHIFTS_PER_WEEK",
    labelTr: "Haftalık Maksimum Vardiya",
    shortLabelTr: "Haftalık Vardiya Limiti",
    descriptionTr: "Bir personelin bir hafta içinde alabileceği maksimum vardiya sayısını sınırlar.",
    categoryTr: "Adalet ve Denge",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: true,
    valueType: UI_RULE_VALUE_TYPES.NUMBER,
    uiGroup: UI_RULE_GROUPS.FAIRNESS,
    uiOrder: 60,
  }),
  MAX_TASK_PER_PERSON: makeUiRuleMeta({
    code: "MAX_TASK_PER_PERSON",
    labelTr: "Görev Tekrar Limiti",
    shortLabelTr: "Görev Limiti",
    descriptionTr: "Aynı personelin aynı görev türüne ay içinde aşırı tekrar atanmasını sınırlar.",
    categoryTr: "Görev ve Atama",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: true,
    valueType: UI_RULE_VALUE_TYPES.NUMBER,
    uiGroup: UI_RULE_GROUPS.TASK,
    uiOrder: 70,
  }),
  ACTIVE_REQUIRED: makeUiRuleMeta({
    code: "ACTIVE_REQUIRED",
    labelTr: "Aktif Personel Zorunluluğu",
    shortLabelTr: "Aktif Personel",
    descriptionTr: "Pasif veya kullanım dışı personelin planlamaya dahil edilmesini engeller.",
    categoryTr: "Personel ve Yetkinlik",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: false,
    valueType: UI_RULE_VALUE_TYPES.NONE,
    uiGroup: UI_RULE_GROUPS.PERSONNEL,
    uiOrder: 80,
  }),
  SERVICE_MATCH: makeUiRuleMeta({
    code: "SERVICE_MATCH",
    labelTr: "Hizmet Eşleşmesi",
    shortLabelTr: "Hizmet Eşleşmesi",
    descriptionTr: "Personelin yalnızca bağlı olduğu hizmet veya birimde planlanmasını sağlar.",
    categoryTr: "Personel ve Yetkinlik",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: false,
    valueType: UI_RULE_VALUE_TYPES.NONE,
    uiGroup: UI_RULE_GROUPS.PERSONNEL,
    uiOrder: 90,
  }),
  ROLE_ELIGIBILITY: makeUiRuleMeta({
    code: "ROLE_ELIGIBILITY",
    labelTr: "Rol Uygunluğu",
    shortLabelTr: "Rol Uygunluğu",
    descriptionTr: "Personelin yalnızca rolüne veya unvanına uygun görevlerde planlanmasını sağlar.",
    categoryTr: "Personel ve Yetkinlik",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: false,
    valueType: UI_RULE_VALUE_TYPES.NONE,
    uiGroup: UI_RULE_GROUPS.PERSONNEL,
    uiOrder: 100,
  }),
  SECTION_ELIGIBILITY: makeUiRuleMeta({
    code: "SECTION_ELIGIBILITY",
    labelTr: "Çalışma Alanı Uygunluğu",
    shortLabelTr: "Alan Uygunluğu",
    descriptionTr: "Personelin yalnızca yetkili olduğu çalışma alanlarında görevlendirilmesini sağlar.",
    categoryTr: "Görev ve Atama",
    type: "HARD",
    suggestedBehavior: "BLOCK",
    locked: true,
    editableValue: false,
    valueType: UI_RULE_VALUE_TYPES.NONE,
    uiGroup: UI_RULE_GROUPS.TASK,
    uiOrder: 110,
  }),
});

const MAPPING_BY_UI_RULE_ID = buildIndex(UI_TO_UNIFIED_RULE_MAPPINGS, "uiRuleId");
const MAPPING_BY_UNIFIED_CODE = buildPreferredUnifiedIndex(UI_TO_UNIFIED_RULE_MAPPINGS);

export function resolveUnifiedCodeFromUiRuleId(uiRuleId) {
  const mapping = getMappingByUiRuleId(uiRuleId);
  return mapping?.unifiedCode || null;
}

export function resolveUiRuleIdFromUnifiedCode(code) {
  const mapping = getMappingByUnifiedCode(code);
  return mapping?.uiRuleId || null;
}

export function listUiToUnifiedMappings() {
  return UI_TO_UNIFIED_RULE_MAPPINGS.map((item) => ({ ...item }));
}

export function getUiRuleMetaByUnifiedCode(code) {
  const normalizedCode = normalizeValue(code);
  if (!normalizedCode) return null;

  const meta = UI_RULE_META_BY_UNIFIED_CODE[normalizedCode];
  if (!meta) return null;

  const mapping = getMappingByUnifiedCode(normalizedCode);
  return {
    ...meta,
    uiRuleId: mapping?.uiRuleId || null,
    schedulerKey: mapping?.schedulerKey || null,
    candidateRuleCode: mapping?.candidateRuleCode || null,
    mappingConfidence: mapping?.mappingConfidence || null,
  };
}

export function getUiRuleMetaByUiRuleId(uiRuleId) {
  const mapping = getMappingByUiRuleId(uiRuleId);
  if (!mapping) return null;

  const meta = getUiRuleMetaByUnifiedCode(mapping.unifiedCode);
  return meta
    ? {
        ...meta,
        uiRuleId: mapping.uiRuleId,
        schedulerKey: mapping.schedulerKey,
        candidateRuleCode: mapping.candidateRuleCode,
        mappingConfidence: mapping.mappingConfidence,
      }
    : null;
}

function getMappingByUiRuleId(uiRuleId) {
  const normalizedId = normalizeValue(uiRuleId);
  if (!normalizedId) return null;
  const mapping = MAPPING_BY_UI_RULE_ID.get(normalizedId);
  return mapping ? { ...mapping } : null;
}

function getMappingByUnifiedCode(code) {
  const normalizedCode = normalizeValue(code);
  if (!normalizedCode) return null;
  const mapping = MAPPING_BY_UNIFIED_CODE.get(normalizedCode);
  return mapping ? { ...mapping } : null;
}

function buildIndex(items, field) {
  const map = new Map();

  for (const item of items) {
    const key = normalizeValue(item?.[field]);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }

  return map;
}

function buildPreferredUnifiedIndex(items) {
  const map = new Map();

  for (const item of items) {
    const key = normalizeValue(item?.unifiedCode);
    if (!key) continue;

    const current = map.get(key);
    if (!current) {
      map.set(key, item);
      continue;
    }

    if (current.mappingConfidence !== "exact" && item.mappingConfidence === "exact") {
      map.set(key, item);
    }
  }

  return map;
}

function makeUiRuleMapping({
  uiRuleId,
  unifiedCode,
  schedulerKey = null,
  candidateRuleCode = null,
  mappingConfidence = "exact",
} = {}) {
  return Object.freeze({
    uiRuleId: normalizeValue(uiRuleId),
    unifiedCode: normalizeValue(unifiedCode),
    schedulerKey: normalizeValue(schedulerKey),
    candidateRuleCode: normalizeValue(candidateRuleCode),
    mappingConfidence: normalizeValue(mappingConfidence) || "exact",
  });
}

function makeUiRuleMeta({
  code,
  labelTr,
  shortLabelTr,
  descriptionTr,
  categoryTr,
  type,
  suggestedBehavior,
  locked = true,
  editableValue = false,
  valueType = UI_RULE_VALUE_TYPES.NONE,
  uiGroup,
  uiOrder = 0,
} = {}) {
  return Object.freeze({
    code: normalizeValue(code),
    labelTr: normalizeValue(labelTr),
    shortLabelTr: normalizeValue(shortLabelTr),
    descriptionTr: normalizeValue(descriptionTr),
    categoryTr: normalizeValue(categoryTr),
    type: normalizeValue(type),
    suggestedBehavior: normalizeValue(suggestedBehavior),
    locked: locked === true,
    editableValue: editableValue === true,
    valueType: normalizeValue(valueType) || UI_RULE_VALUE_TYPES.NONE,
    uiGroup: normalizeValue(uiGroup),
    uiOrder: Number.isFinite(Number(uiOrder)) ? Number(uiOrder) : 0,
  });
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}
