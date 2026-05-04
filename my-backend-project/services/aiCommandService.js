// services/aiCommandService.js — Türkçe komut → yapılandırılmış JSON
const { llmChat } = require('./llmService');

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
  const history = getHistory(sessionId);

  // Bağlam bilgisini kullanıcı mesajına ekle (AI daha iyi anlar)
  let enrichedText = text;
  if (context.activeYM) enrichedText += `\n[Aktif ay: ${context.activeYM}]`;
  if (context.serviceName) enrichedText += `\n[Servis: ${context.serviceName}]`;

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
