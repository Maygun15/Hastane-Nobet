'use strict';

/**
 * Kurum kuralları — planlama motorunun kullandığı kural değerlerinin YETKİLİ kaynağı.
 *
 * Neden: Kural değerleri önceden tarayıcıda (localStorage `dutyRulesV2`) tutuluyor, plan
 * isteğiyle sunucuya gönderiliyor ve sunucu değerlerinin ÜZERİNE yazılıyordu. Sunucudaki
 * kayıt ise tip uyuşmazlığı yüzünden boş kalıyordu. Artık:
 *   - Değerler DutyRule belgesinin `policy` alanında, hastane + bölüm + servis + meslek
 *     kapsamında saklanır (değer, kaynak, sürüm, değiştiren, zaman).
 *   - Etkin değer katmanlıdır: GENEL (servis boş) → MESLEK → SERVİS → SERVİS+MESLEK;
 *     her kural için en özel katman kazanır.
 *   - Planlama/doğrulama yalnızca bu değerleri kullanır; istemcinin gönderdiği değerler
 *     yok sayılır.
 *
 * "Meslek" (role) = planlanan personelin mesleği (Nurse/Doctor); kullanıcının erişim
 * yetkisi (User.role) ile ilgisi yoktur.
 */

const crypto = require('crypto');
const DutyRule = require('../models/DutyRule');

const RULE_SOURCES = Object.freeze(['mevzuat', 'kurum', 'tercih', 'belirsiz']);
const SOURCE_LABEL = Object.freeze({
  mevzuat: 'Mevzuat',
  kurum: 'Kurum kararı',
  tercih: 'Tercih',
  belirsiz: 'Kaynağı belirsiz',
});

/**
 * Motorun GERÇEKTEN kontrol ettiği kurallar (services/scheduler/constraints.js,
 * candidateBuilder/rules/*). Burada olmayan bir kural motoru etkilemez.
 * `legacyUiIds`: eski tarayıcı listesindeki (dutyRulesV2) karşılıkları — geçiş için.
 * Sayısal sınırlar giriş doğrulaması içindir; kurum değerinin kendisi DEĞİLDİR.
 */
const RULE_CATALOG = Object.freeze({
  ONE_SHIFT_PER_DAY: {
    label: 'Günde en fazla bir vardiya',
    type: 'boolean',
    unit: null,
    required: true,
    legacyUiIds: ['ONE_SHIFT_PER_DAY', 'NO_MULTIPLE_ASSIGNMENTS_PER_DAY'],
  },
  LEAVE_BLOCK: {
    label: 'Onaylı izin gününe atama yapılmaz',
    type: 'boolean',
    unit: null,
    required: true,
    legacyUiIds: ['LEAVE_BLOCK_GENERIC'],
  },
  NIGHT_NEXT_DAY_OFF: {
    label: 'Gece nöbeti (N) ertesi gün çalışılmaz',
    type: 'boolean',
    unit: null,
    required: true,
    legacyUiIds: ['NIGHT_NEXT_DAY_OFF'],
  },
  MIN_REST_HOURS: {
    label: 'İki vardiya arası en az dinlenme',
    type: 'number',
    unit: 'saat',
    min: 0,
    max: 48,
    required: true,
    zeroMeans: 'kural kapalı',
    legacyUiIds: ['MIN_GAP_12H', 'MIN_REST_11H'],
  },
  MAX_CONSECUTIVE_DAYS: {
    label: 'Art arda en fazla çalışma günü',
    type: 'number',
    unit: 'gün',
    min: 0,
    max: 31,
    required: true,
    zeroMeans: 'sınır yok',
    legacyUiIds: ['MAX_CONSECUTIVE_6D'],
  },
  MAX_SHIFTS_PER_WEEK: {
    label: 'Haftada en fazla vardiya',
    type: 'number',
    unit: 'vardiya/hafta',
    min: 0,
    max: 14,
    required: false,
    zeroMeans: 'sınır yok',
    legacyUiIds: ['WEEKLY_MAX_SHIFTS', 'WEEKLY_MAX_DUTIES', 'WEEKLY_MAX_SHIFTS_PER_PERSON'],
  },
  MAX_WEEKLY_HOURS: {
    label: 'Haftada en fazla çalışma saati',
    type: 'number',
    unit: 'saat/hafta',
    min: 0,
    max: 168,
    required: false,
    zeroMeans: 'sınır yok',
    legacyUiIds: ['WEEKLY_MAX_80H'],
  },
    MAX_TASK_PER_PERSON: {
    label: 'Kişi başına aynı görevde en fazla atama (ay)',
    type: 'number',
    unit: 'atama/ay',
    min: 0,
    max: 62,
    required: false,
    zeroMeans: 'sınır yok',
    legacyUiIds: ['MAX_TASK_PER_PERSON', 'MAX_SAME_TASK_PER_PERSON'],
  },
});

const RULE_KEYS = Object.freeze(Object.keys(RULE_CATALOG));
const REQUIRED_KEYS = Object.freeze(RULE_KEYS.filter((k) => RULE_CATALOG[k].required));

const str = (v) => String(v == null ? '' : v).trim();

function normalizeScope(input = {}) {
  return {
    sectionId: str(input.sectionId || input.section || 'calisma-cizelgesi'),
    serviceId: str(input.serviceId),
    role: str(input.role),
  };
}

function scopeLevel(scope) {
  if (scope.serviceId && scope.role) return 'servis+meslek';
  if (scope.serviceId) return 'servis';
  if (scope.role) return 'meslek';
  return 'genel';
}

/** Genelden özele kapsam listesi (tekrarsız). */
function layerScopes(scope) {
  const s = normalizeScope(scope);
  const list = [
    { sectionId: s.sectionId, serviceId: '', role: '' },
    { sectionId: s.sectionId, serviceId: '', role: s.role },
    { sectionId: s.sectionId, serviceId: s.serviceId, role: '' },
    { sectionId: s.sectionId, serviceId: s.serviceId, role: s.role },
  ];
  const seen = new Set();
  return list.filter((x) => {
    const k = `${x.serviceId}|${x.role}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Gelen değerleri katalogla doğrular. Bilinmeyen anahtar, yanlış tip, aralık dışı → hata.
 * `partial=true` iken eksik anahtarlar serbesttir (servis katmanı yalnız farkı tutar).
 */
function validatePolicyInput({ values = {}, sources = {} } = {}) {
  const errors = [];
  const clean = {};
  const cleanSources = {};
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return { ok: false, errors: [{ key: null, message: 'Kural değerleri nesne olmalı.' }], values: {}, sources: {} };
  }
  for (const [key, raw] of Object.entries(values)) {
    const def = RULE_CATALOG[key];
    if (!def) {
      errors.push({ key, message: `Bilinmeyen kural: ${key}` });
      continue;
    }
    if (raw === null || raw === undefined || raw === '') continue; // katmanda tanımsız bırak
    if (def.type === 'boolean') {
      if (typeof raw !== 'boolean') {
        errors.push({ key, message: `${def.label}: açık/kapalı (true/false) olmalı.` });
        continue;
      }
      clean[key] = raw;
    } else {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n)) {
        errors.push({ key, message: `${def.label}: sayı olmalı.` });
        continue;
      }
      if (n < def.min || n > def.max) {
        errors.push({ key, message: `${def.label}: ${def.min}–${def.max} ${def.unit} aralığında olmalı.` });
        continue;
      }
      clean[key] = n;
    }
  }
  for (const [key, src] of Object.entries(sources || {})) {
    if (!RULE_CATALOG[key]) continue;
    const s = str(src).toLowerCase();
    if (!s) continue;
    if (!RULE_SOURCES.includes(s)) {
      errors.push({ key, message: `Geçersiz kaynak: ${src} (mevzuat, kurum, tercih, belirsiz)` });
      continue;
    }
    if (key in clean) cleanSources[key] = s;
  }
  // Değeri olup kaynağı verilmeyenler "belirsiz" işaretlenir (gizlenmez).
  for (const key of Object.keys(clean)) {
    if (!cleanSources[key]) cleanSources[key] = 'belirsiz';
  }
  return { ok: errors.length === 0, errors, values: clean, sources: cleanSources };
}

function computeVersion(layers, values) {
  const basis = JSON.stringify({
    l: layers.map((l) => [l.level, l.revision]),
    v: RULE_KEYS.map((k) => [k, values[k] === undefined ? null : values[k]]),
  });
  return `kv-${crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12)}`;
}

/**
 * Etkin kuralları sunucudaki kayıtlardan çözer.
 * Dönen `version`, katman revizyonları + etkin değerlerden türetilir: herhangi bir
 * katman değişirse sürüm değişir; aynı veriyi okuyan her oturum aynı sürümü görür.
 */
async function resolveInstitutionRules({ hospitalId = null, sectionId, serviceId = '', role = '', model = DutyRule } = {}) {
  const scopes = layerScopes({ sectionId, serviceId, role });
  const docs = await Promise.all(
    scopes.map((s) => model.findOne({ ...(hospitalId ? { hospitalId } : {}), ...s, 'policy.revision': { $gte: 1 } }).lean())
  );

  const values = {};
  const sources = {};
  const origin = {};
  const layers = [];
  scopes.forEach((s, i) => {
    const doc = docs[i];
    const policy = doc?.policy;
    if (!policy || !(Number(policy.revision) >= 1)) return;
    const level = scopeLevel(s);
    layers.push({
      level,
      scope: s,
      revision: Number(policy.revision),
      updatedAt: policy.updatedAt || null,
      updatedBy: policy.updatedBy || null,
      updatedByName: policy.updatedByName || null,
      values: { ...(policy.values || {}) },
      sources: { ...(policy.sources || {}) },
    });
    for (const key of RULE_KEYS) {
      const v = policy.values?.[key];
      if (v === undefined || v === null) continue;
      values[key] = v;
      sources[key] = policy.sources?.[key] || 'belirsiz';
      origin[key] = level;
    }
  });

  const missingRequired = REQUIRED_KEYS.filter((k) => values[k] === undefined);
  return {
    scope: normalizeScope({ sectionId, serviceId, role }),
    configured: layers.length > 0,
    complete: layers.length > 0 && missingRequired.length === 0,
    missingRequired,
    values,
    sources,
    origin,
    layers,
    version: layers.length ? computeVersion(layers, values) : null,
  };
}

class RulesNotReadyError extends Error {
  constructor(resolved) {
    const notConfigured = !resolved?.configured;
    const missing = resolved?.missingRequired || [];
    super(
      notConfigured
        ? 'Kurum kuralları sunucuda tanımlı değil. Parametreler → Nöbet Kuralları → "Kurum kuralları" bölümünden kaydedin (bu tarayıcıdaki eski ayarları oradan aktarabilirsiniz).'
        : `Zorunlu kurum kuralı eksik: ${missing.map((k) => RULE_CATALOG[k]?.label || k).join(', ')}. Parametreler → Nöbet Kuralları → "Kurum kuralları" bölümünden tamamlayın.`
    );
    this.code = notConfigured ? 'RULES_NOT_CONFIGURED' : 'RULES_INCOMPLETE';
    this.status = 422;
    this.missingRequired = missing;
  }
}

function assertRulesReady(resolved) {
  if (!resolved?.complete) throw new RulesNotReadyError(resolved);
  return resolved;
}

/** Motorun beklediği kural nesnesi (yalnız katalog anahtarları). */
function toSchedulerRules(resolved) {
  const out = {};
  for (const key of RULE_KEYS) {
    if (resolved?.values?.[key] !== undefined) out[key] = resolved.values[key];
  }
  return out;
}

/** Plan kaydına eklenecek anlık kopya. */
function buildRuleSnapshot(resolved, { by = null, mode = 'generated' } = {}) {
  return {
    version: resolved?.version || null,
    values: { ...(resolved?.values || {}) },
    sources: { ...(resolved?.sources || {}) },
    layers: (resolved?.layers || []).map((l) => ({ level: l.level, revision: l.revision })),
    capturedAt: new Date(),
    capturedBy: by,
    mode,
  };
}

/** İstemcinin gönderdiği kural değerlerinden sunucuyla farklı olanlar (yalnız raporlama). */
function diffClientRules(clientRules, resolved) {
  const out = [];
  if (!clientRules || typeof clientRules !== 'object') return out;
  for (const key of RULE_KEYS) {
    if (!(key in clientRules)) continue;
    const server = resolved?.values?.[key];
    if (clientRules[key] !== server) out.push({ key, client: clientRules[key], server: server ?? null });
  }
  return out;
}

function catalogForClient() {
  return RULE_KEYS.map((key) => {
    const d = RULE_CATALOG[key];
    return {
      key,
      label: d.label,
      type: d.type,
      unit: d.unit,
      min: d.min ?? null,
      max: d.max ?? null,
      required: d.required,
      zeroMeans: d.zeroMeans || null,
      legacyUiIds: d.legacyUiIds,
    };
  });
}

module.exports = {
  RULE_CATALOG,
  RULE_KEYS,
  REQUIRED_KEYS,
  RULE_SOURCES,
  SOURCE_LABEL,
  RulesNotReadyError,
  assertRulesReady,
  buildRuleSnapshot,
  catalogForClient,
  computeVersion,
  diffClientRules,
  layerScopes,
  normalizeScope,
  resolveInstitutionRules,
  scopeLevel,
  toSchedulerRules,
  validatePolicyInput,
};
