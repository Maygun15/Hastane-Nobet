// src/tabs/DutyRulesTab.Explained.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

/**
 * Nöbet Kuralları — Tam Sürüm
 * - Türkçe başlık/açıklama
 * - Sağ panelde Düzenle
 * - Arama, toplu seçim/işlem, satır-içi değer & aktiflik düzenleme
 * - Hızlı Ekle çekmecesi
 * - Metinden Yükle (önizleme + akıllı ID eşleme)
 * - Excel içe/dışa aktar, sıfırla
 *
 * Kaynak kural metinleri: "Acil Servis Nöbet Planlama Kuralları" (kullanıcı dosyası).  :contentReference[oaicite:1]{index=1}
 */

const LS_KEY = "dutyRulesV2";

/* -------------- helpers -------------- */
const uid = () =>
  (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2, 8));

const toBool = (v) =>
  typeof v === "boolean" ? v : ["1", "true", "evet", "aktif", "yes"].includes(String(v).trim().toLowerCase());

const humanizeId = (s = "") =>
  s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (m) => m.toUpperCase());

function normalizeAndSort(arr = []) {
  const withIndex = (arr || []).map((it, i) => ({
    ...it,
    order: typeof it.order === "number" ? it.order : i,
    enabled: typeof it.enabled === "boolean" ? it.enabled : true,
    name: typeof it.name === "string" ? it.name : it.id, // UI fallback
  }));
  return [...withIndex].sort((a, b) => a.order - b.order);
}

function useHybridRules(external, setExternal) {
  const controlled = typeof setExternal === "function" && Array.isArray(external);
  const [inner, setInner] = useState(() => {
    if (controlled) return [];
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const setR = (updater) => {
    if (controlled) {
      setExternal((prev) =>
        normalizeAndSort(typeof updater === "function" ? updater(prev || []) : updater)
      );
    } else {
      setInner((prev0) => {
        const next = normalizeAndSort(typeof updater === "function" ? updater(prev0 || []) : updater);
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  };

  const list = controlled ? (external ?? []) : (inner ?? []);
  useEffect(() => {
    if (!controlled) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(list ?? []));
      } catch {}
    }
  }, [controlled, list]);

  return [list, setR, controlled];
}

/* -------------- Kategori & seviyeler -------------- */
const LEVEL = { HARD: 1, HIGH: 2, MED: 3, LOW: 4 };
const CATS = [
  { id: "personel", label: "Personel & Yetkinlik" },
  { id: "kadro", label: "Kadro & Vardiya" },
  { id: "sure", label: "Süre & Dinlenme" },
  { id: "izin", label: "İzin/Rapor" },
  { id: "adalet", label: "Gece/Tatil Adaleti" },
  { id: "cakisma", label: "Çakışma/Saat" },
  { id: "tercih", label: "Tercih & Mazeret" },
  { id: "kidem", label: "Kıdem & Unvan" },
];

/* -------------- Kural kütüphanesi (desc Türkçe) -------------- */
const RULE_LIBRARY = {
  // Personel / Kadro
  QUAL_ONLY_IN_SPECIALTY: { cat: "personel", level: LEVEL.HARD, desc: "Kişi yalnızca kendi uzmanlık/unvanına uygun görevlerde çalışır." },
  CERT_REQUIRED_FOR_CRITICAL: { cat: "personel", level: LEVEL.HARD, desc: "Kritik görevler sadece gerekli sertifikalı personele atanır." },
  TRIAGE_NURSES_ONLY: { cat: "personel", level: LEVEL.HARD, desc: "Triaj görevi yalnızca hemşirelere atanır." },
  RESUS_MIN_TWO: { cat: "kadro", level: LEVEL.HARD, desc: "Resüsitasyon alanında her vardiyada en az 2 sağlık personeli bulunur.", suggestedParams: { min: 2 } },
  RED_YELLOW_CHILD_MIN1: { cat: "kadro", level: LEVEL.HARD, desc: "Kırmızı, Sarı ve Çocuk alanlarında her vardiyada en az 1 kişi bulunur." },
  GREEN_MIN_STAFF: { cat: "kadro", level: LEVEL.HARD, desc: "Yeşil alanda min. kadro: hafta içi 3, hafta sonu 4." },
  PHARMACY_ONE_PER_24H: { cat: "kadro", level: LEVEL.HARD, desc: "Eczaneye her 24 saatte 1 personel atanır." },
  SERVICE_LEAD_WEEKDAY_DAY: { cat: "kadro", level: LEVEL.HARD, desc: "Servis sorumlusu yalnız hafta içi gündüz vardiyalarında yazılır." },
  SUPERVISOR_UNUSED: { cat: "kadro", level: LEVEL.LOW, desc: "Süpervizör vardiyası tanımlı fakat kullanılmıyor." },
  RED_YELLOW_TEAMLEAD_ONE: { cat: "kadro", level: LEVEL.HARD, desc: "Kırmızı/Sarı ekip sorumlusu her nöbette 1 kişi olur." },
  SURGERY_ROOM_MIN2: { cat: "kadro", level: LEVEL.HARD, desc: "Cerrahi müdahale odasında her nöbette 2 personel bulunur." },
  VACCINATION_UNUSED: { cat: "kadro", level: LEVEL.LOW, desc: "Aşı uygulama nöbeti tanımlı fakat kullanılmıyor." },
  ROTATION_APPLIES: { cat: "personel", level: LEVEL.MED, desc: "Görev yerleri rotasyonla dağıtılır." },
  NO_UNQUALIFIED_ASSIGN: { cat: "personel", level: LEVEL.HARD, desc: "Yetkin olmadığı alana atama yapılmaz." },
  SUPPORT_ROLES_OPTIONAL: { cat: "kadro", level: LEVEL.LOW, desc: "Destek rolleri ihtiyaç halinde tanımlanabilir." },

  // Süre & Dinlenme
  WEEKLY_MAX_80H: { cat: "sure", level: LEVEL.HARD, desc: "Haftalık toplam çalışma saati üst sınırı 80 saattir.", suggestedParams: { max: 80 } },
  DAILY_MAX_24H: { cat: "sure", level: LEVEL.HARD, desc: "Bir günde toplam çalışma 24 saati geçemez.", suggestedParams: { max: 24 } },
  MAX_CONSECUTIVE_6D: { cat: "sure", level: LEVEL.HARD, desc: "Maksimum ardışık çalışma 6 gündür.", suggestedParams: { maxDays: 6 } },
  WEEKLY_MIN_1_OFF: { cat: "sure", level: LEVEL.HARD, desc: "Her hafta en az 1 gün kesintisiz tatil olmalıdır.", suggestedParams: { minOffDays: 1 } },
  MIN_REST_11H: { cat: "sure", level: LEVEL.HARD, desc: "Vardiyalar arasında en az 11 saat dinlenme olmalıdır.", suggestedParams: { minHours: 11 } },
  OVERTIME_MINIMIZE: { cat: "sure", level: LEVEL.HIGH, desc: "Fazla mesai yapılabilir ama minimumda tutulur." },
  MONTHLY_TARGET_CALC: { cat: "sure", level: LEVEL.MED, desc: "Aylık hedef saat = (resmi iş günü × 8) olarak planlanır." },
  ONE_SHIFT_PER_DAY: { cat: "cakisma", level: LEVEL.HARD, desc: "Bir personele bir günde yalnızca 1 vardiya atanır." },
  LONG_SHIFTS_MAX2_PER_WEEK: { cat: "sure", level: LEVEL.HIGH, desc: "16/24 saatlik uzun nöbetler haftada en fazla 2 kez verilir.", suggestedParams: { maxPerWeek: 2 } },
  NIGHT_7_5H_NORM_INFO: { cat: "sure", level: LEVEL.LOW, desc: "Gece çalışma normu 7.5 saattir (sağlık sektörü istisna olabilir)." },

  // İzin/Rapor
  LEAVE_BLOCK_AN_FIRSTDAY: { cat: "izin", level: LEVEL.HARD, desc: "AN kodu olan personele yeni ayın ilk günü nöbet yazılmaz." },
  LEAVE_BLOCK_GENERIC: {
    cat: "izin", level: LEVEL.HARD,
    desc: "İzin/rapor kodlu günlere atama yapılmaz; bazıları çalışılmış sayılır. (Bİ, Dİ, E, Eİ, G, U, H, R, RE, S, Sİ, İ, İİ, Üİ, Y vb.)",
  },

  // Gece/Tatil Adaleti
  NIGHT_FAIR_DISTRIBUTION: { cat: "adalet", level: LEVEL.HIGH, desc: "Gece nöbetleri personel arasında adil dağıtılır." },
  NO_CONSEC_NIGHTS: { cat: "sure", level: LEVEL.HARD, desc: "Arka arkaya iki gece nöbeti yazılmaz." },
  WEEKEND_NIGHTS_FAIR: { cat: "adalet", level: LEVEL.HIGH, desc: "Hafta sonu gece nöbetleri adil paylaşılır." },
  NIGHT_BALANCE_MONTH_YEAR: { cat: "adalet", level: LEVEL.MED, desc: "Gece nöbet sayıları aylık/yıllık dengelenir." },
  AN_CONSIDER_FOR_NIGHTS: { cat: "adalet", level: LEVEL.MED, desc: "AN kodu olanlar yeni ayda gece dağılımında dikkate alınır." },
  EQUAL_NIGHTS_EXCEPT_EXEMPT: { cat: "adalet", level: LEVEL.MED, desc: "Muaf/kıdem özel durumlar dışında herkes eşit sıklıkta geceye girer." },
  VOLUNTEERS_MORE_NIGHTS_IF_FAIR: { cat: "adalet", level: LEVEL.LOW, desc: "Gönüllü olanlara daha fazla gece verilebilir; adalet korunur." },

  // Tatil
  HOLIDAY_EQUAL: { cat: "adalet", level: LEVEL.HIGH, desc: "Resmi/dini bayram nöbetleri eşit dağıtılır." },
  HOLIDAY_SIMILAR_COUNT_YEAR: { cat: "adalet", level: LEVEL.MED, desc: "Yıl genelinde herkese benzer sayıda tatil nöbeti düşer." },
  HOLIDAY_RESPECT_PREFS: { cat: "tercih", level: LEVEL.MED, desc: "Tatil günlerinde tercihlere mümkün olduğunca uyulur." },
  HOLIDAY_NO_CONSEC_ALL_DAYS: { cat: "adalet", level: LEVEL.HIGH, desc: "Bir bayramın tüm günleri aynı kişiye yazılmaz (ardışık gün yasağı)." },
  HOLIDAY_ROTATE_SPECIAL_DAYS: { cat: "adalet", level: LEVEL.MED, desc: "Yılbaşı/bayram 1. gün gibi özel nöbetler dönüşümlü verilir." },
  HOLIDAY_BEFORE_AFTER_ATTENTION: { cat: "adalet", level: LEVEL.LOW, desc: "Tatil öncesi/sonrası nöbetler dikkatle planlanır." },

  // Aynı gün / Çakışma
  NO_MULTIPLE_ASSIGNMENTS_PER_DAY: { cat: "cakisma", level: LEVEL.HARD, desc: "Aynı günde birden fazla nöbet atanamaz." },
  NO_DOUBLE_BOOKING: { cat: "cakisma", level: LEVEL.HARD, desc: "Aynı anda iki görevde olunamaz." },
  NO_SPLIT_SHIFT: { cat: "cakisma", level: LEVEL.HARD, desc: "Bölünmüş vardiya uygulanmaz." },

  // Nöbet sonrası
  NIGHT_NEXT_DAY_OFF: { cat: "sure", level: LEVEL.HARD, desc: "Gece nöbeti tutan kişi ertesi gün izinlidir." },
  LONG16_NEXT_DAY_LIGHT: { cat: "sure", level: LEVEL.HIGH, desc: "16 saatlik vardiya sonrası ertesi gün ağır/erken görevlere yazılmaz." },
  NIGHT_OFF_PLANNED: { cat: "sure", level: LEVEL.MED, desc: "Gece sonrası izin önceden planlanır." },
  END_OF_MONTH_WEEKEND_NEXT_DAY_OFF: { cat: "sure", level: LEVEL.LOW, desc: "Ay sonu/hafta sonu nöbetlerinden sonra ertesi gün izin uygulanır." },
  NO_IMMEDIATE_NEXT_NIGHT_AFTER_NIGHT: { cat: "sure", level: LEVEL.HARD, desc: "Gece nöbetinden hemen sonra tekrar gece nöbeti verilmez." },

  // Çakışma/geçiş
  NO_OVERLAP_SHIFTS: { cat: "cakisma", level: LEVEL.HARD, desc: "Vardiyalar birbiriyle çakışamaz." },
  MIN_GAP_12H: { cat: "sure", level: LEVEL.HARD, desc: "Vardiyalar arasında en az 12 saat boşluk olmalıdır.", suggestedParams: { minHours: 12 } },
  NO_OVERLAP_ANY: { cat: "cakisma", level: LEVEL.HARD, desc: "Hiçbir vardiya başka vardiya ile üst üste gelmez." },
  SMOOTH_DAY_NIGHT_TRANSITIONS: { cat: "cakisma", level: LEVEL.MED, desc: "Gündüz–gece geçişleri çakışma olmayacak biçimde planlanır." },

  // Tercih & Mazeret
  TRY_RESPECT_OFF_REQUESTS: { cat: "tercih", level: LEVEL.MED, desc: "Boş gün (B) isteği olan personele o gün nöbet yazmamaya çalış." },
  CONSIDER_PREFERRED_SHIFTS: { cat: "tercih", level: LEVEL.LOW, desc: "Tercih ettiği vardiyalar dikkate alınır." },
  AVOID_MAZERET_DAYS: { cat: "tercih", level: LEVEL.MED, desc: "Mazeret günlerine nöbet yazmamaya çalış." },
  ALLOW_SWAP_BY_RULES: { cat: "tercih", level: LEVEL.MED, desc: "Karşılıklı nöbet değişimleri kurallara uygun yapılır." },
  FAIR_ON_MULTI_REQUESTS: { cat: "tercih", level: LEVEL.MED, desc: "Çoklu talepte adalet sağlanır." },
  COMMUNICATE_DURING_PLANNING: { cat: "tercih", level: LEVEL.LOW, desc: "Planlama sürecinde personele danış, iletişim kur." },
  ALLOW_REASONABLE_FLEX: { cat: "tercih", level: LEVEL.LOW, desc: "Moral/motivasyon için makul esneklik tanınır." },

  // Kıdem & Unvan
  SENIOR_MAY_EXEMPT: { cat: "kidem", level: LEVEL.MED, desc: "Kıdemli personel bazı nöbetlerden muaf olabilir." },
  TEAM_LEAD_SHARED_AMONG_SENIORS: { cat: "kidem", level: LEVEL.MED, desc: "Ekip sorumluluğu kıdemliler arasında dönüşümlü paylaşılır." },
  PREGNANT_NO_NIGHTS: { cat: "kidem", level: LEVEL.HARD, desc: "Hamile/emziren personel gece nöbetine yazılmaz." },
  HEALTH_LIMITED_SHIFTS: { cat: "kidem", level: LEVEL.HARD, desc: "Sağlık raporu olan personel kısıtlı vardiyalara yazılır." },
  SENIOR_PREFERENCES: { cat: "kidem", level: LEVEL.LOW, desc: "Kıdemli personelin belirli tercih hakları tanınabilir." },
  SENIOR_JUNIOR_BALANCE: { cat: "kidem", level: LEVEL.MED, desc: "Kıdem–genç dengesi gözetilir." },
  NO_TITLE_CONFLICTS: { cat: "kidem", level: LEVEL.HARD, desc: "Unvan çatışması olmamalıdır." },
  NO_ASSIGN_WITHOUT_TRAINING: { cat: "kidem", level: LEVEL.HARD, desc: "Gerekli eğitim/oryantasyon olmadan atama yapılmaz." },
  FAIR_TOTAL_LOAD: { cat: "kidem", level: LEVEL.MED, desc: "Toplam yük (vardiya/saat) adil dağıtılır." },
};

/* -------------- Varsayılan tam set -------------- */
const DEFAULT_RULES = Object.keys(RULE_LIBRARY).map((id, i) => ({
  id,
  name: id, // UI, Türkçeyi desc'den alır
  enabled: true,
  value:
    RULE_LIBRARY[id]?.suggestedParams?.max ??
    RULE_LIBRARY[id]?.suggestedParams?.min ??
    RULE_LIBRARY[id]?.suggestedParams?.minHours ??
    RULE_LIBRARY[id]?.suggestedParams?.maxPerWeek ??
    null,
  order: i,
}));

/* -------------- Metinden Yükle yardımcıları -------------- */
// Türkçe slug (ID üretimi) — TR karakterler normalize
const slug = (s = "") =>
  s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();

// Başlık → kategori tahmini (doküman başlıkları)
const HEADING2CAT = [
  { key: "personel görev türlerine göre kısıtlamalar", cat: "personel" },
  { key: "günlük/haftalık görev sınırları", cat: "sure" },
  { key: "maksimum ardışık çalışma günleri", cat: "sure" },
  { key: "izin türleri", cat: "izin" },
  { key: "izinli personele", cat: "izin" },
  { key: "gece nöbeti adaleti", cat: "adalet" },
  { key: "ardışık gece", cat: "adalet" },
  { key: "resmi tatil", cat: "adalet" },
  { key: "aynı gün içinde birden fazla", cat: "cakisma" },
  { key: "nöbet sonrası izin", cat: "sure" },
  { key: "vardiya saat çakışmaları", cat: "cakisma" },
  { key: "personel tercihleri", cat: "tercih" },
  { key: "kıdem ve unvan", cat: "kidem" },
];

// Cümlenin içindeki ilk sayıyı yakala (80, 24, 6, 11...)
const sniffNumber = (s = "") => {
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// Akıllı Türkçe kalıp → mevcut ID eşlemesi
const PHRASE2ID = [
  { rx: /ayn[iı] g[uü]n.*tek vardiya|bir g[uü]nde.*tek vardiya|aynı g[uü]n.*yaln[ıi]zca.*1/i, id: "ONE_SHIFT_PER_DAY" },
  { rx: /ard[aı]ş[ıi]k gece|arka arkaya.*gece/i, id: "NO_CONSEC_NIGHTS" },
  { rx: /haftal[iı]k.*80\s*saat|80\s*saat.*hafta/i, id: "WEEKLY_MAX_80H" },
  { rx: /(bir g[uü]n.*24\s*saat|24\s*saat.*g[uü]n)/i, id: "DAILY_MAX_24H" },
  { rx: /(en az|min).*11\s*saat.*(dinlenme|ara)/i, id: "MIN_REST_11H" },
  { rx: /gece n[öo]bet(ler|i).*adalet|adil.*gece/i, id: "NIGHT_FAIR_DISTRIBUTION" },
  { rx: /tatil.*(e[şs]it|adil)|bayram.*d[aı]ğıt[iı]l/i, id: "HOLIDAY_EQUAL" },
  { rx: /yeşil alan.*hafta i[cç]i.*3.*hafta sonu.*4/i, id: "GREEN_MIN_STAFF" },
  { rx: /res[üu]sitasyon.*(2|iki).*personel/i, id: "RESUS_MIN_TWO" },
];

const CATEGORY_ALIASES = {
  PERSONEL: "personel",
  PERSONNEL: "personel",
  YETKİNLİK: "personel",
  YETKINLIK: "personel",
  KADRO: "kadro",
  VARDIYA: "kadro",
  CREW: "kadro",
  SURE: "sure",
  DİNLENME: "sure",
  DINLENME: "sure",
  REST: "sure",
  IZIN: "izin",
  RAPOR: "izin",
  HOLIDAY: "adalet",
  TATIL: "adalet",
  GECE: "adalet",
  ADALET: "adalet",
  NIGHT: "adalet",
  CAKISMA: "cakisma",
  ÇAKIŞMA: "cakisma",
  SCHEDULING: "cakisma",
  TERCIH: "tercih",
  PREFERENCE: "tercih",
  KIDEM: "kidem",
  UNVAN: "kidem",
};

const PRIORITY_ALIASES = {
  HARD: { code: "HARD", level: LEVEL.HARD },
  KATI: { code: "HARD", level: LEVEL.HARD },
  STRICT: { code: "HARD", level: LEVEL.HARD },
  SOFT_HIGH: { code: "SOFT_HIGH", level: LEVEL.HIGH },
  HIGH: { code: "SOFT_HIGH", level: LEVEL.HIGH },
  "SOFT-YUKSEK": { code: "SOFT_HIGH", level: LEVEL.HIGH },
  SOFT_MED: { code: "SOFT_MED", level: LEVEL.MED },
  SOFT_MEDIUM: { code: "SOFT_MED", level: LEVEL.MED },
  MED: { code: "SOFT_MED", level: LEVEL.MED },
  MEDIUM: { code: "SOFT_MED", level: LEVEL.MED },
  SOFT_LOW: { code: "SOFT_LOW", level: LEVEL.LOW },
  LOW: { code: "SOFT_LOW", level: LEVEL.LOW },
};

const PRIORITY_LABEL = {
  HARD: "Katı",
  SOFT_HIGH: "Soft · Yüksek",
  SOFT_MED: "Soft · Orta",
  SOFT_LOW: "Soft · Düşük",
};

const stripQuotes = (s = "") => {
  const trimmed = s.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const mapCategory = (cat) => {
  if (!cat) return null;
  const key = cat.toString().trim().toUpperCase();
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
  const tokens = key.replace(/[^A-ZÇĞİÖŞÜ0-9]+/g, " ").split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (CATEGORY_ALIASES[token]) return CATEGORY_ALIASES[token];
  }
  return key.toLowerCase();
};

const mapPriority = (token) => {
  if (!token) return null;
  const key = token.toString().trim().toUpperCase();
  return PRIORITY_ALIASES[key] || null;
};

const parseScope = (value = "") => {
  const entries = value
    .split(/[;,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [k, v] = chunk.split(/[:=]/);
      if (!v) return null;
      return [k.trim(), v.trim()];
    })
    .filter(Boolean);
  if (!entries.length) return null;
  const out = {};
  for (const [k, v] of entries) out[k] = v;
  return out;
};

function parseDslRules(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let block = null;
  let currentKey = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (block && currentKey && block.body[currentKey]) {
        block.body[currentKey] = `${block.body[currentKey]}\n`;
      }
      continue;
    }
    if (/^RULE\b/i.test(line)) {
      if (block) blocks.push(block);
      const headerMatch = line.match(/^RULE\s+([^:]+?)(?::|$)/i);
      const rawId = headerMatch ? stripQuotes(headerMatch[1]) : `RULE_${blocks.length + 1}`;
      const idCandidate = slug(rawId).slice(0, 48);
      block = {
        id: idCandidate || rawId.replace(/\s+/g, "_").toUpperCase(),
        rawId,
        body: {},
        source: [raw],
      };
      currentKey = null;
      continue;
    }
    if (!block) continue;
    block.source.push(raw);
    if (/^END\b/i.test(line)) {
      blocks.push(block);
      block = null;
      currentKey = null;
      continue;
    }
    const keyMatch = line.match(/^([A-Z][A-Z0-9_]*)(?:\s*[:=]\s*|\s+)(.+)$/i);
    if (keyMatch) {
      const key = keyMatch[1].toUpperCase();
      let value = keyMatch[2] ?? "";
      value = stripQuotes(value);
      block.body[key] = value;
      currentKey = key;
    } else if (currentKey) {
      const existing = block.body[currentKey] || "";
      block.body[currentKey] = `${existing}${existing ? "\n" : ""}${line}`;
    }
  }

  if (block) blocks.push(block);
  if (!blocks.length) return [];

  return blocks.map((b) => {
    const body = b.body;
    const pri = mapPriority(body.PRIORITY || body.LEVEL || body.SEVERITY);
    const category = mapCategory(body.CATEGORY || body.CAT);
    const weightToken = (body.WEIGHT || body.PENALTY || "").trim();
    const weight = weightToken ? weightToken.toUpperCase() : null;
    const enabled = body.ENABLED ? toBool(body.ENABLED) : true;
    const numericValue = body.VALUE && Number.isFinite(Number(body.VALUE)) ? Number(body.VALUE) : null;
    const note = body.NOTE || body.DESCRIPTION || null;
    const name = body.TITLE || body.NAME || humanizeId(b.id);
    const scope = body.SCOPE ? parseScope(body.SCOPE) : null;

    return {
      id: b.id,
      name,
      enabled,
      value: numericValue,
      cat: category,
      priority: pri?.code || null,
      levelOverride: pri?.level || null,
      weight,
      scope,
      note,
      dsl: {
        when: body.WHEN || null,
        then: body.THEN || null,
        else: body.ELSE || null,
        weight,
        scope,
        priority: pri?.code || null,
        raw: b.source.join("\n"),
      },
    };
  });
}

function parseLegacyRules(text) {
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length);

  let currentCat = null;
  const out = [];

  const isHeading = (line) => {
    const l = line.toLowerCase();
    const found = HEADING2CAT.find((h) => l.includes(h.key));
    if (found) {
      currentCat = found.cat;
      return true;
    }
    if (/^[A-ZÇĞİÖŞÜ0-9\s\/\-:,]+$/.test(line) && line.length >= 10) {
      return true;
    }
    return false;
  };

  const isNumbered = (line) => /^(\d+[\).\-])\s+/.test(line);

  for (const line of lines) {
    if (isHeading(line)) continue;
    if (!isNumbered(line)) continue;

    const desc = line.replace(/^(\d+[\).\-])\s+/, "");
    const hit = PHRASE2ID.find((m) => m.rx.test(desc));
    const id = hit ? hit.id : slug(desc).slice(0, 48) || uid();
    const value = sniffNumber(desc);

    out.push({
      id,
      name: desc,
      value,
      enabled: true,
      cat: currentCat,
    });
  }

  const byId = new Map();
  for (const r of out) if (!byId.has(r.id)) byId.set(r.id, r);
  return Array.from(byId.values());
}

function parseRulesFromText(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return [];
  const dsl = parseDslRules(trimmed);
  if (dsl.length) return dsl.map((r, i) => ({ ...r, order: i }));
  return parseLegacyRules(trimmed).map((r, i) => ({ ...r, order: i }));
}

/* -------------- Küçük inline number editor -------------- */
function InlineNumber({ value, onChange, placeholder = "değer" }) {
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState(value ?? "");
  useEffect(() => setTemp(value ?? ""), [value]);

  const commit = () => {
    const v = temp === "" ? null : Number(temp);
    if (temp !== "" && Number.isNaN(v)) return;
    onChange(v);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="text-[11px] px-2 py-0.5 rounded border bg-white hover:bg-gray-50"
        onClick={() => setEditing(true)}
        title="Değeri düzenle"
      >
        {value ?? <span className="text-gray-400">{placeholder}</span>}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      className="text-[12px] px-2 py-1 rounded border w-20"
      value={temp}
      onChange={(e) => setTemp(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

/* -------------- Ana Bileşen -------------- */
export default function DutyRulesTabExplained({ rules, setRules }) {
  const [list, setR] = useHybridRules(rules, setRules);
  const [cat, setCat] = useState("all");
  const [expanded, setExpanded] = useState({});
  const [form, setForm] = useState({ id: undefined, name: "", value: "", enabled: true });
  const [editingId, setEditingId] = useState(null);
  const [showEditor, setShowEditor] = useState(false);

  // ergonomi
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState({});
  const [showQuick, setShowQuick] = useState(false);

  // metinden yükle
  const [showTextImport, setShowTextImport] = useState(false);
  const [rawText, setRawText] = useState("");

  const ordered = useMemo(() => normalizeAndSort(list), [list]);
  const fileRef = useRef(null);

  // ilk yükleme (boşsa)
  useEffect(() => {
    if (!Array.isArray(list) || list.length === 0) {
      setR(DEFAULT_RULES);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- toolbar actions ----- */
  const loadDefaults = () => {
    if (!confirm("Tam şablon eklensin mi? (mevcutlar korunur)")) return;
    setR((prev) => {
      const have = new Set((prev || []).map((x) => x.id));
      const fresh = DEFAULT_RULES.filter((d) => !have.has(d.id));
      return [...(prev || []), ...fresh].map((r, i) => ({ ...r, order: i }));
    });
  };
  const clearAll = () => {
    if (!confirm("Tüm nöbet kuralları silinsin mi?")) return;
    setR([]);
    setForm({ id: undefined, name: "", value: "", enabled: true });
    setEditingId(null);
    setShowEditor(false);
    setSelected({});
  };
  const exportToExcel = () => {
    const header = [["id", "name", "value", "enabled", "order"]];
    const data = ordered.map((r) => [r.id, r.name, r.value ?? "", r.enabled ? 1 : 0, r.order]);
    const ws = XLSX.utils.aoa_to_sheet([...header, ...data]);
    ws["!cols"] = [{ wch: 32 }, { wch: 44 }, { wch: 10 }, { wch: 8 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NobetKurallari");
    XLSX.writeFile(wb, `NobetKurallari_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const onImportClick = () => fileRef.current?.click();
  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!aoa || aoa.length < 2) throw new Error("Geçerli veri yok");
      const header = (aoa[0] || []).map((h) => String(h || "").trim().toLowerCase());
      const idx = (k, fb) => {
        const i = header.indexOf(k);
        return i >= 0 ? i : fb;
      };
      const parsed = aoa
        .slice(1)
        .map((row) => {
          const id = String(row[idx("id", 0)] || "").trim() || uid();
          const name = String(row[idx("name", 1)] || "").trim();
          const rawVal = row[idx("value", 2)];
          const value =
            rawVal === "" || rawVal === null || Number.isNaN(Number(rawVal)) ? null : Number(rawVal);
          const enabled = toBool(row[idx("enabled", 3)]);
          const order = Number(row[idx("order", 4)]);
          return { id, name, value, enabled, order: Number.isFinite(order) ? order : undefined };
        })
        .filter((r) => r.id);
      const byId = new Map();
      for (const r of parsed) byId.set(r.id, r);
      const next = normalizeAndSort(Array.from(byId.values()));
      setR(next);
      alert(`Toplam ${next.length} kural içe aktarıldı.`);
    } catch (err) {
      console.error(err);
      alert("Excel içe aktarma hatası: " + (err?.message || String(err)));
    }
  };

  /* ----- CRUD ----- */
  const resetForm = () => {
    setForm({ id: undefined, name: "", value: "", enabled: true });
    setEditingId(null);
  };
  const upsert = (e) => {
    e?.preventDefault?.();
    const name = (form.name || "").trim();
    const value =
      form.value === "" || form.value === null || Number.isNaN(Number(form.value))
        ? null
        : Number(form.value);
    if (!name) return;
    const id = editingId ?? (name.toUpperCase().replace(/[^A-Z0-9_]+/g, "_") || uid());
    const row = { id, name, value, enabled: !!form.enabled };
    setR((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      const without = base.filter((r) => r.id !== id);
      const merged = [...without, row].map((r, i) => ({ ...r, order: i }));
      return merged;
    });
    resetForm();
  };
  const edit = (r) => {
    setEditingId(r.id);
    setForm({ id: r.id, name: r.name || r.id, value: r.value ?? "", enabled: !!r.enabled });
  };
  const del = (id) => {
    setR((prev) => (prev || []).filter((r) => r.id !== id).map((r, i) => ({ ...r, order: i })));
    if (editingId === id) {
      resetForm();
      setShowEditor(false);
    }
  };
  const move = (id, dir) => {
    const arr = [...ordered];
    const i = arr.findIndex((r) => r.id === id);
    if (i < 0) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    const rebased = arr.map((r, k) => ({ ...r, order: k }));
    setR((prev) =>
      (prev || []).map((r) => {
        const f = rebased.find((x) => x.id === r.id);
        return f ? { ...r, order: f.order } : r;
      })
    );
  };

  /* ----- filtreleme + arama ----- */
  const filtered = useMemo(() => {
    const base =
      cat === "all" ? ordered : ordered.filter((r) => (RULE_LIBRARY[r.id]?.cat || r.cat) === cat);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => {
      const meta = RULE_LIBRARY[r.id] || {};
      return (
        (r.id || "").toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q) ||
        (meta.desc || "").toLowerCase().includes(q)
      );
    });
  }, [ordered, cat, query]);

  /* ----- rozet ----- */
  const badgeFor = (rule) => {
    const meta = RULE_LIBRARY[rule.id];
    const lvl = meta?.level ?? rule.levelOverride ?? (rule.priority ? PRIORITY_ALIASES[rule.priority]?.level : null);
    if (lvl === LEVEL.HARD)
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
          Katı
        </span>
      );
    if (lvl === LEVEL.HIGH)
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
          Soft · Yüksek
        </span>
      );
    if (lvl === LEVEL.MED)
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200">
          Soft · Orta
        </span>
      );
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">
        Soft · Düşük
      </span>
    );
  };

  /* ----- Metinden Yükle: canlı önizleme ----- */
  const preview = useMemo(() => parseRulesFromText(rawText || ""), [rawText]);

  /* ----- UI ----- */
  return (
    <div className="space-y-4 text-sm md:text-base">
      {/* üst bar */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight">Nöbet Kuralları</h2>
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 border border-gray-200">
            {ordered.length} kural
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kural ara…"
            className="px-3 py-2 rounded-xl border bg-white w-56"
          />
          <button
            onClick={() => {
              resetForm();
              setShowEditor(true);
            }}
            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
            title="Yeni kural ekle"
          >
            Yeni
          </button>
          <button
            onClick={() => setShowQuick(true)}
            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
          >
            Hızlı Ekle
          </button>
          <button
            onClick={() => setShowTextImport(true)}
            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
          >
            Metinden Yükle
          </button>
          <button onClick={loadDefaults} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50">
            Varsayılanları Ekle
          </button>
          <button onClick={exportToExcel} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50">
            Excele Aktar
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onImportFile} />
          <button onClick={onImportClick} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50">
            Excelden Yükle
          </button>
          <button
            onClick={clearAll}
            disabled={!ordered.length}
            className="px-3 py-2 rounded-xl bg-red-50 text-red-700 border border-red-200 disabled:opacity-50"
          >
            Kuralları Sıfırla
          </button>
        </div>
      </div>

      {/* kategori filtreleri */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCat("all")}
          className={`px-3 py-1.5 rounded-xl border ${
            cat === "all" ? "bg-black text-white" : "bg-white hover:bg-gray-50"
          }`}
        >
          Tümü
        </button>
        {CATS.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={`px-3 py-1.5 rounded-xl border ${
              cat === c.id ? "bg-black text-white" : "bg-white hover:bg-gray-50"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* toplu işlemler */}
      {Object.keys(selected).filter((k) => selected[k]).length > 0 && (
        <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="text-xs font-medium">
            {Object.keys(selected).filter((k) => selected[k]).length} kural seçildi
          </div>
          <button
            className="px-2 py-1 text-xs rounded border bg-white"
            onClick={() => setR((prev) => (prev || []).map((r) => (selected[r.id] ? { ...r, enabled: true } : r)))}
          >
            Etkinleştir
          </button>
          <button
            className="px-2 py-1 text-xs rounded border bg-white"
            onClick={() =>
              setR((prev) => (prev || []).map((r) => (selected[r.id] ? { ...r, enabled: false } : r)))
            }
          >
            Devre Dışı
          </button>
          <button
            className="px-2 py-1 text-xs rounded border bg-white hover:bg-red-50 text-red-600"
            onClick={() => setR((prev) => (prev || []).filter((r) => !selected[r.id]))}
          >
            Seçilileri Sil
          </button>
          <button className="ml-auto px-2 py-1 text-xs rounded border" onClick={() => setSelected({})}>
            Seçimi temizle
          </button>
        </div>
      )}

      {/* liste */}
      <div className="border rounded-2xl overflow-hidden">
        {!filtered.length && <div className="p-4 text-gray-500">Seçili kategoride kural yok.</div>}
        {filtered.map((it, i) => {
          const meta = RULE_LIBRARY[it.id] || {};
          const inferredCat = meta.cat || it.cat || null;
          const isOpen = !!expanded[it.id];
          const displayTitle = meta.uiTitle || meta.desc || it.name || humanizeId(it.id);

          return (
            <div key={it.id} className="p-4 border-b last:border-b-0">
              <div className="flex items-start gap-3">
                {/* seçim kutusu */}
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!selected[it.id]}
                  onChange={(e) =>
                    setSelected((s) => ({ ...s, [it.id]: e.target.checked ? true : undefined }))
                  }
                />
                <div className="w-6 text-right text-xs font-semibold mt-1">{i + 1}.</div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium truncate" title={displayTitle}>
                      {displayTitle}
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-200">
                      {it.id}
                    </span>
                    {badgeFor(it)}
                    {!RULE_LIBRARY[it.id] && it.priority && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-600 border-gray-200">
                        {PRIORITY_LABEL[it.priority] || it.priority}
                      </span>
                    )}
                    {inferredCat && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-700 border-gray-200">
                        {CATS.find((c) => c.id === inferredCat)?.label}
                      </span>
                    )}
                    {/* aktif toggle (inline) */}
                    <label className="ml-2 inline-flex items-center gap-1 text-[11px] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!it.enabled}
                        onChange={(e) =>
                          setR((prev) =>
                            (prev || []).map((r) => (r.id === it.id ? { ...r, enabled: e.target.checked } : r))
                          )
                        }
                      />
                      {it.enabled ? "Aktif" : "Pasif"}
                    </label>
                    {/* değer (inline) */}
                    <InlineNumber
                      value={it.value}
                      placeholder="değer"
                      onChange={(num) =>
                        setR((prev) => (prev || []).map((r) => (r.id === it.id ? { ...r, value: num } : r)))
                      }
                    />
                  </div>

                  <div className="text-gray-700 mt-1">
                    {meta.desc || it.note || it.dsl?.then || it.dsl?.when || "Kural açıklaması"}
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setExpanded((e) => ({ ...e, [it.id]: !isOpen }))}
                      className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-gray-50"
                    >
                      {isOpen ? "Kapat" : "Neden?"}
                    </button>
                    <button
                      onClick={() => {
                        edit(it);
                        setShowEditor(true);
                      }}
                      className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-gray-50"
                    >
                      Düzenle
                    </button>
                    <button
                      onClick={() => del(it.id)}
                      className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-red-50 text-red-600"
                    >
                      Sil
                    </button>
                    <button onClick={() => move(it.id, "up")} className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-gray-50">
                      ↑
                    </button>
                    <button onClick={() => move(it.id, "down")} className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-gray-50">
                      ↓
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="bg-gray-50 border rounded-xl p-3">
                        <div className="text-xs font-semibold mb-1">Neden var?</div>
                        <div className="text-sm text-gray-700">
                          {meta.why || "Kaynak dokümandaki güvenlik, mevzuat ve adalet gereksinimleri."}
                        </div>
                      </div>
                      <div className="bg-gray-50 border rounded-xl p-3">
                        <div className="text-xs font-semibold mb-1">Örnek</div>
                        <div className="text-sm text-gray-700">
                          {meta.example || "Uygulama örneği kurum pratiklerine göre şekillenir."}
                        </div>
                      </div>
                      {meta.suggestedParams && (
                        <div className="md:col-span-2 bg-gray-50 border rounded-xl p-3">
                          <div className="text-xs font-semibold mb-1">Önerilen parametreler</div>
                          <pre className="text-xs whitespace-pre-wrap break-words">
                            {JSON.stringify(meta.suggestedParams, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sağdan kayan Düzenleme Paneli */}
      {showEditor && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowEditor(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl border-l flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold">Kuralı Düzenle</div>
              <button onClick={() => setShowEditor(false)} className="px-2 py-1 text-sm rounded border">
                Kapat
              </button>
            </div>
            <div className="p-4 overflow-auto">
              <form
                onSubmit={(e) => {
                  upsert(e);
                  setShowEditor(false);
                }}
                className="flex flex-col gap-3"
              >
                <label className="text-sm">Kural Başlığı / ID</label>
                <input
                  className="border rounded-xl px-3 py-2"
                  placeholder="Örn: Gece nöbeti adaleti"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <label className="text-sm">Değer (opsiyonel / sayı)</label>
                <input
                  type="number"
                  className="border rounded-xl px-3 py-2"
                  placeholder="Örn: 80, 24, 11..."
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                />
                <label className="inline-flex items-center gap-2 text-sm mt-1">
                  <input
                    type="checkbox"
                    checked={!!form.enabled}
                    onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                  />
                  Kural aktif
                </label>
                <div className="flex gap-2 pt-1">
                  <button type="submit" className="px-3 py-2 border rounded-xl bg-emerald-600 text-white">
                    {editingId ? "Güncelle" : "Ekle"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setShowEditor(false);
                    }}
                    className="px-3 py-2 border rounded-xl bg-slate-100"
                  >
                    İptal
                  </button>
                </div>
              </form>

              {/* Panelde bilgi kartı */}
              {editingId && (() => {
                const meta = RULE_LIBRARY[editingId] || {};
                return (
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="font-semibold">Açıklama</div>
                    <div className="text-gray-700">{meta.desc || "—"}</div>
                    {meta.suggestedParams && (
                      <>
                        <div className="font-semibold mt-2">Önerilen parametreler</div>
                        <pre className="text-xs bg-gray-50 border rounded p-2">
                          {JSON.stringify(meta.suggestedParams, null, 2)}
                        </pre>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Hızlı Ekle çekmecesi */}
      {showQuick && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowQuick(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl border-l flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold">Hızlı Kural Ekle</div>
              <button onClick={() => setShowQuick(false)} className="px-2 py-1 text-sm rounded border">
                Kapat
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-auto">
              {[
                "ONE_SHIFT_PER_DAY",
                "MIN_REST_11H",
                "NO_CONSEC_NIGHTS",
                "WEEKLY_MAX_80H",
                "DAILY_MAX_24H",
                "HOLIDAY_EQUAL",
                "NIGHT_FAIR_DISTRIBUTION",
                "LEAVE_BLOCK_GENERIC",
                "RED_YELLOW_CHILD_MIN1",
                "GREEN_MIN_STAFF",
              ].map((id) => {
                const meta = RULE_LIBRARY[id];
                return (
                  <div key={id} className="border rounded-xl p-3">
                    <div className="font-medium">{meta?.desc || id}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      {CATS.find((c) => c.id === meta?.cat)?.label}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="px-2 py-1 text-xs rounded border bg-white"
                        onClick={() => {
                          setR((prev) => {
                            const have = new Set((prev || []).map((x) => x.id));
                            if (have.has(id)) return prev;
                            const row = {
                              id,
                              name: id,
                              enabled: true,
                              value: null,
                              order: (prev?.length || 0),
                            };
                            return [...(prev || []), row];
                          });
                        }}
                      >
                        Ekle
                      </button>
                      <button
                        className="px-2 py-1 text-xs rounded border bg-white"
                        onClick={() => {
                          setR((prev) => {
                            const row = {
                              id,
                              name: id,
                              enabled: true,
                              value: null,
                              order: 0,
                            };
                            return [row, ...(prev || [])].map((r, i) => ({ ...r, order: i }));
                          });
                        }}
                      >
                        En üste ekle
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Metinden Yükle çekmecesi */}
      {showTextImport && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowTextImport(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-3xl bg-white shadow-xl border-l flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold">Metinden Kural Yükle</div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowTextImport(false)} className="px-2 py-1 text-sm rounded border">
                  Kapat
                </button>
              </div>
            </div>
            <div className="p-4 grid gap-3" style={{ gridTemplateRows: "1fr auto auto" }}>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={`Buraya dokümandan kopyaladığın metni yapıştır.\n(RULE blokları veya başlık + numaralı maddeler)`}
                className="border rounded-xl p-3 h-[48vh] resize-none font-mono text-[12px]"
              />

              {/* canlı önizleme */}
              <div className="mt-1 border rounded-xl p-3 max-h-56 overflow-auto text-sm">
                {preview.length === 0 ? (
                  <div className="text-gray-500">
                    Önizleme için RULE blokları veya numaralı maddeler içeren metin yapıştırın.
                  </div>
                ) : (
                  preview.map((r, i) => (
                    <div
                      key={`${r.id}_${i}`}
                      className="flex items-center justify-between py-1 border-b last:border-b-0"
                    >
                      <div className="truncate space-x-1">
                        <span className="text-gray-500 mr-2">{i + 1}.</span>
                        <span className="font-medium">{r.name || humanizeId(r.id)}</span>
                        {r.priority && (
                          <span className="text-[10px] px-1 py-0.5 rounded border bg-gray-50 text-gray-600 border-gray-200">
                            {PRIORITY_LABEL[r.priority] || r.priority}
                          </span>
                        )}
                        {r.weight && (
                          <span className="text-[10px] px-1 py-0.5 rounded border bg-indigo-50 text-indigo-600 border-indigo-200">
                            {r.weight}
                          </span>
                        )}
                        {r.cat && (
                          <span className="text-[10px] px-1 py-0.5 rounded border bg-gray-50 text-gray-600 border-gray-200">
                            {CATS.find((c) => c.id === r.cat)?.label || r.cat}
                          </span>
                        )}
                        {r.value != null && (
                          <span className="text-xs text-gray-600">({r.value})</span>
                        )}
                      </div>
                      {/* çakışma rozeti */}
                      {ordered.some((x) => x.id === r.id) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                          Mevcut ID
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
                  onClick={() => {
                    const sample = `
RULE REST_AFTER_N:
  TITLE "Gece Sonrası 24 Saat Dinlenme"
  CATEGORY Sure & Dinlenme
  PRIORITY HARD
  WHEN prev_shift in ["N","V1","V2"]
  THEN FORBID shift in ["M","M4","N","V1"]
  NOTE "Gece veya uzun vardiyadan çıkan personele ertesi gün ağır görev yazılmaz."
END

Resmi tatil nöbetlerinin eşit dağılımı
1. Yıl boyunca her personele benzer sayıda tatil nöbeti düşmelidir.
2. Ardışık tüm tatil günleri aynı personele yazılmamalıdır.
`;
                    setRawText(sample.trim());
                  }}
                >
                  Örnek Doldur
                </button>
                <button
                  className="px-3 py-2 rounded-xl bg-emerald-600 text-white"
                  onClick={() => {
                    const parsed = parseRulesFromText(rawText || "");
                    if (!parsed.length) {
                      alert(
                        "Metinden kural çıkarılamadı. RULE blokları veya numaralı maddeler içermeli."
                      );
                      return;
                    }
                    let addedCount = 0;
                    setR((prev) => {
                      const have = new Set((prev || []).map((x) => x.id));
                      const merged = [...(prev || [])];
                      for (const r of parsed) {
                        if (have.has(r.id)) continue;
                        merged.push({
                          id: r.id,
                          name: r.name || humanizeId(r.id),
                          value: r.value ?? null,
                          enabled: r.enabled ?? true,
                          order: merged.length,
                          cat: r.cat || undefined,
                          priority: r.priority || undefined,
                          levelOverride: r.levelOverride || undefined,
                          weight: r.weight || undefined,
                          scope: r.scope || undefined,
                          note: r.note || undefined,
                          dsl: r.dsl || undefined,
                        });
                        have.add(r.id);
                        addedCount += 1;
                      }
                      return merged.map((x, i) => ({ ...x, order: i }));
                    });
                    setShowTextImport(false);
                    setRawText("");
                    alert(
                      addedCount
                        ? `${addedCount} yeni kural eklendi.`
                        : "Tüm kurallar zaten listede mevcuttu."
                    );
                  }}
                >
                  Ayrıştır ve Ekle
                </button>
                <div className="text-xs text-gray-500">
                  İpucu: Sayı içeren cümlelerde (80, 24, 6, 11 gibi) değer alanı otomatik dolar.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
