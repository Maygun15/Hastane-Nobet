// services/aiCommandService.js — Türkçe komut → yapılandırılmış JSON
const { llmChat } = require('./llmService');

// ── Güvenlik: Prompt injection koruması ──────────────────────────────────────
const MAX_INPUT_LENGTH = 800; // LLM'e gönderilecek max karakter sayısı

// Yaygın prompt injection pattern'ları
const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|prior)\s+(instructions?|prompts?|rules?|system)/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+(if\s+you\s+are|a\s+)/i,
  /forget\s+(everything|all|your|previous)/i,
  /system\s*:\s*you/i,
  /\[system\]/i,
  /\<system\>/i,
  /\|\s*system\s*\|/i,
  /jailbreak/i,
  /dan\s+mode/i,
];

function sanitizeUserInput(text) {
  if (!text) return '';
  let s = String(text)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars (keep \n \r \t)
    .replace(/\r\n/g, '\n')
    .trim();

  // Uzunluk sınırı
  if (s.length > MAX_INPUT_LENGTH) s = s.slice(0, MAX_INPUT_LENGTH) + '…';

  // Injection pattern tespiti — sıfırlamak yerine loglayıp devam ediyoruz
  // (kullanıcı Türkçe yazdığı için İngilizce pattern'ler zararsız olabilir)
  const hasInjection = INJECTION_PATTERNS.some((rx) => rx.test(s));
  if (hasInjection) {
    // Güvenli fallback: intent'i unknown yap, LLM'e gönderme
    throw Object.assign(new Error('INJECTION_DETECTED'), { code: 'INJECTION_DETECTED' });
  }

  return s;
}

// ── KVKK: Bağlam verisini anonimleştir (servis adı tutulur, PII temizlenir) ──
function sanitizeContext(context = {}) {
  return {
    // activeYM tarih bilgisi — kişisel veri değil, tutulur
    activeYM: context.activeYM ? String(context.activeYM).slice(0, 7) : null,
    // serviceName — organizasyonel birim — PII değil, tutulur
    serviceName: context.serviceName ? String(context.serviceName).slice(0, 64) : null,
    // Diğer context alanları atlanır (personId, userId vs. LLM'e gitmez)
  };
}

// Her sessionId için son N mesajı bellekte tut (server restart'ta temizlenir — MVP için yeterli)
const SESSION_HISTORY = new Map(); // sessionId → [{role, content}]
const SESSION_MAX_MSGS = 10; // 5 tur (user + assistant)
const SESSION_TTL_MS   = 30 * 60 * 1000; // 30 dk
const sessionTimers    = new Map();

function getHistory(sessionId) {
  return sessionId ? (SESSION_HISTORY.get(sessionId) || []) : [];
}

function pushHistory(sessionId, role, content) {
  if (!sessionId) return;
  const hist = SESSION_HISTORY.get(sessionId) || [];
  hist.push({ role, content });
  // son N mesajı tut
  if (hist.length > SESSION_MAX_MSGS) hist.splice(0, hist.length - SESSION_MAX_MSGS);
  SESSION_HISTORY.set(sessionId, hist);

  // TTL sıfırla
  if (sessionTimers.has(sessionId)) clearTimeout(sessionTimers.get(sessionId));
  sessionTimers.set(sessionId, setTimeout(() => {
    SESSION_HISTORY.delete(sessionId);
    sessionTimers.delete(sessionId);
  }, SESSION_TTL_MS));
}

function clearSession(sessionId) {
  if (!sessionId) return;
  SESSION_HISTORY.delete(sessionId);
  if (sessionTimers.has(sessionId)) {
    clearTimeout(sessionTimers.get(sessionId));
    sessionTimers.delete(sessionId);
  }
}

const SYSTEM_PROMPT = `Sen bir hastane nöbet yönetim asistanısın. Türkçe komutları anlayıp SADECE geçerli JSON döndürürsün.

ÇIKTI FORMATI — daima bu JSON yapısı, başka hiçbir şey ekleme:
{
  "intent": "<intent_kodu>",
  "confidence": <0.0-1.0>,
  "entities": {
    "person": "<kişi adı veya null>",
    "date": "<YYYY-MM-DD veya null>",
    "dateStart": "<YYYY-MM-DD veya null>",
    "dateEnd": "<YYYY-MM-DD veya null>",
    "shiftCode": "<nöbet kodu veya null (örn: GECE, SABAH, A)>",
    "shiftLabel": "<nöbet adı veya null>",
    "serviceName": "<servis/birim adı veya null>",
    "leaveType": "<YILLIK|HASTALIK|UCRETSIZ veya null>"
  },
  "humanReadable": "<Türkçe kısa açıklama — ne yapılacak>",
  "missingInfo": ["<eksik bilgi listesi, boş dizi ise canExecute true olabilir>"],
  "requiresConfirmation": true,
  "canExecute": <true/false>
}

INTENT KODLARI:
- assign_shift    → kişiye nöbet/vardiya ata
- remove_shift    → kişinin nöbetini kaldır
- add_leave       → kişiye izin ekle
- remove_leave    → kişinin iznini sil
- query_schedule  → çizelge/nöbet sorgula
- query_person    → kişi bilgisi sorgula
- swap_shifts     → iki kişinin vardiyasını değiştir
- generate_schedule → otomatik çizelge oluştur
- unknown         → anlaşılamayan komut

KURALLAR:
- requiresConfirmation daima true (güvenlik gereği)
- canExecute: zorunlu bilgiler tamam ise true, eksik varsa false
- Tarihler YYYY-MM-DD formatında
- Emin değilsen confidence 0.7'nin altında ver
- Sadece JSON döndür, açıklama yazma`;

/**
 * Doğal dil komutunu parse eder.
 * @param {object} opts
 * @param {string} opts.text       — kullanıcı komutu
 * @param {string} [opts.sessionId] — konuşma geçmişi için
 * @param {object} [opts.context]  — aktif ay, servis vb. ek bağlam
 * @param {*}      [opts.hospitalId]
 * @param {*}      [opts.userId]
 */
async function parseCommand({ text, sessionId, context = {}, hospitalId, userId }) {
  // ── Güvenlik: input sanitize + injection tespiti ──
  let safeText;
  try {
    safeText = sanitizeUserInput(text);
  } catch (err) {
    if (err?.code === 'INJECTION_DETECTED') {
      return {
        intent: 'unknown', confidence: 0, entities: {},
        humanReadable: 'Güvenlik politikası: bu komut işlenemiyor. Lütfen sade Türkçe yazın.',
        missingInfo: [], requiresConfirmation: true, canExecute: false,
        _securityBlock: true,
      };
    }
    throw err;
  }

  const safeCtx = sanitizeContext(context);
  const history = getHistory(sessionId);

  // Bağlam bilgisini kullanıcı mesajına ekle — yalnızca anonimleştirilmiş veriler
  let enrichedText = safeText;
  if (safeCtx.activeYM)    enrichedText += `\n[Aktif ay: ${safeCtx.activeYM}]`;
  if (safeCtx.serviceName) enrichedText += `\n[Servis: ${safeCtx.serviceName}]`;

  const messages = [...history, { role: 'user', content: enrichedText }];

  let result;
  try {
    result = await llmChat({
      systemPrompt: SYSTEM_PROMPT,
      messages,
      maxTokens: 512,
      action: 'parse-command',
      hospitalId,
      userId,
    });
  } catch (err) {
    // AI erişilemez → fallback
    return {
      intent: 'unknown',
      confidence: 0,
      entities: {},
      humanReadable: 'AI servisi şu an yanıt vermiyor. Lütfen manuel işlem yapın.',
      missingInfo: [],
      requiresConfirmation: true,
      canExecute: false,
      _fallback: true,
      _error: String(err?.response?.data?.error?.message || err?.message || 'Bilinmeyen hata'),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    parsed = {
      intent: 'unknown',
      confidence: 0,
      entities: {},
      humanReadable: 'Yanıt JSON formatında değil. Lütfen komutu yeniden deneyin.',
      missingInfo: [],
      requiresConfirmation: true,
      canExecute: false,
    };
  }

  // Konuşma geçmişine ekle
  pushHistory(sessionId, 'user', enrichedText);
  pushHistory(sessionId, 'assistant', result.content);

  return {
    ...parsed,
    _meta: {
      tokens:    { prompt: result.promptTokens, completion: result.completionTokens, total: result.totalTokens },
      durationMs: result.durationMs,
      model:     result.model,
    },
  };
}

module.exports = { parseCommand, clearSession };
