// src/api/ai.routes.js
const express = require('express');
const router  = express.Router();

const { parseCommand, clearSession }  = require('../../services/aiCommandService');
const { executeCommand }              = require('../../services/aiExecutorService');
const { AI_PROVIDER }                 = require('../../services/llmService');
const { aiSuggest, parseRequest }     = require('./ai.service.js'); // geriye dönük uyumluluk
const { validateParsedRequest }       = require('./validators/ajv.js');

const isProd       = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage  = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);
const MONTH_RX     = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ─── Ping ─────────────────────────────────────────────── */
router.get('/ping', (_req, res) => res.json({
  pong: true,
  provider: AI_PROVIDER,
  configured: {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai:    !!process.env.OPENAI_API_KEY,
  },
}));

/* ─── /parse-command ───────────────────────────────────────
   Türkçe komutu parse eder, DB'ye dokunmaz.
   Body: { text, sessionId?, context?: { activeYM, serviceName } }
   ─────────────────────────────────────────────────────────── */
router.post('/parse-command', async (req, res) => {
  try {
    const { text, sessionId, context } = req.body || {};
    if (!text || String(text).trim().length < 2) {
      return res.status(400).json({ ok: false, message: 'text zorunlu (min 2 karakter)' });
    }

    const parsed = await parseCommand({
      text:       String(text).trim(),
      sessionId:  sessionId ? String(sessionId).slice(0, 64) : null,
      context:    context || {},
      hospitalId: req.hospitalId || null,
      userId:     req.user?._id   || null,
    });

    return res.json({ ok: true, data: parsed });
  } catch (err) {
    console.error('[AI /parse-command]', err?.message || err);
    return res.status(500).json({ ok: false, message: safeMessage(err) });
  }
});

/* ─── /confirm-action ──────────────────────────────────────
   Onaylanan intent'i çalıştırır.
   Body: { intent, entities, sessionId? }
   ─────────────────────────────────────────────────────────── */
router.post('/confirm-action', async (req, res) => {
  try {
    const { intent, entities, sessionId } = req.body || {};
    if (!intent) return res.status(400).json({ ok: false, message: 'intent zorunlu' });

    // assign_shift / remove_shift / swap_shifts gibi kompleks işlemler
    // için gerekli schedule bağlamı bu endpoint'te yok; executor bilgilendirir.
    const result = await executeCommand({ intent, entities: entities || {} });
    if (sessionId) clearSession(String(sessionId).slice(0, 64));

    return res.json({ ok: result.ok, result });
  } catch (err) {
    console.error('[AI /confirm-action]', err?.message || err);
    return res.status(500).json({ ok: false, message: safeMessage(err) });
  }
});

/* ─── /session/clear ───────────────────────────────────────
   Konuşma geçmişini temizle.
   ─────────────────────────────────────────────────────────── */
router.delete('/session/:sessionId', (req, res) => {
  clearSession(String(req.params.sessionId || '').slice(0, 64));
  res.json({ ok: true });
});

/* ─── /cost-summary ────────────────────────────────────────
   Son 30 gündeki token & maliyet özeti (admin).
   ─────────────────────────────────────────────────────────── */
router.get('/cost-summary', async (req, res) => {
  try {
    const AILog = require('../../models/AILog');
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const filter = { createdAt: { $gte: since } };
    if (req.hospitalId) filter.hospitalId = req.hospitalId;

    const [total] = await AILog.aggregate([
      { $match: filter },
      { $group: {
        _id: null,
        calls:          { $sum: 1 },
        promptTokens:   { $sum: '$promptTokens' },
        completionTokens: { $sum: '$completionTokens' },
        totalTokens:    { $sum: '$totalTokens' },
        costUsd:        { $sum: '$costUsd' },
        errors:         { $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] } },
      }},
    ]);

    return res.json({ ok: true, period: '30d', summary: total || {} });
  } catch (err) {
    return res.status(500).json({ ok: false, message: safeMessage(err) });
  }
});

/* ─── Geriye dönük uyumluluk (/parse-request, /suggest) ─── */
router.post('/parse-request', async (req, res) => {
  try {
    const { rawText, activeYM, personId, locale } = req.body || {};
    if (!rawText || !activeYM || !MONTH_RX.test(activeYM)) {
      return res.status(400).json({ status: 'error', message: 'Geçersiz payload. { rawText, activeYM: "YYYY-MM" }' });
    }
    const parsed = await parseRequest({ rawText, activeYM, personId, locale });
    const { ok, errors } = validateParsedRequest(parsed);
    if (!ok) return res.status(422).json({ status: 'error', message: 'Schema validation failed', errors });
    return res.json({ status: 'ok', data: parsed });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: safeMessage(e) });
  }
});

router.post('/suggest', async (req, res) => {
  try {
    const { service, month } = req.body || {};
    if (!service || !month || !MONTH_RX.test(month)) {
      return res.status(400).json({ status: 'error', message: 'Geçersiz payload. { service, month: "YYYY-MM" }' });
    }
    const userId = req.user?.id || req.user?._id || 'anonymous';
    const n8n = await aiSuggest({ service, month, userId });
    return res.json({ status: 'ok', payload: { service, month, userId }, n8n, receivedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: safeMessage(e) });
  }
});

module.exports = router;
