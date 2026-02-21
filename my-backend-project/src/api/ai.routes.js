// src/api/ai.routes.js
const express = require('express');
const router = express.Router();

const { aiSuggest } = require('./ai.service.js');
const { parseRequest } = require('./parse.service.js');
const { validateParsedRequest } = require('./validators/ajv.js');

const MONTH_RX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Teşhis için ping */
router.get('/ping', (_req, res) => res.json({ pong: true }));

/** Metinden talep/izinleri parse eder */
router.post('/parse-request', async (req, res) => {
  try {
    const { rawText, activeYM, personId, locale } = req.body || {};
    if (!rawText || !activeYM || !MONTH_RX.test(activeYM)) {
      return res.status(400).json({
        status: 'error',
        message: 'Geçersiz payload. { rawText, activeYM: "YYYY-MM", personId? }'
      });
    }

    const parsed = await parseRequest({ rawText, activeYM, personId, locale });

    // AJV doğrulaması
    const { ok, errors } = validateParsedRequest(parsed);
    if (!ok) {
      return res.status(422).json({
        status: 'error',
        message: 'Schema validation failed',
        errors
      });
    }

    return res.json({ status: 'ok', data: parsed });
  } catch (e) {
    console.error('parse-request error:', e);
    return res.status(500).json({
      status: 'error',
      message: e.message || 'parse-request failed'
    });
  }
});

/** n8n webhook’una proxy: AI öneri */
router.post('/suggest', async (req, res, next) => {
  try {
    const { service, month } = req.body || {};
    if (!service || !month || !MONTH_RX.test(month)) {
      return res.status(400).json({
        status: 'error',
        message: 'Geçersiz payload. { service, month: "YYYY-MM" }'
      });
    }

    const userId = (req.user && (req.user.id || req.user._id)) || 'anonymous';
    const n8n = await aiSuggest({ service, month, userId });

    return res.json({
      status: 'ok',
      via: 'backend',
      payload: { service, month, userId },
      n8n,
      receivedAt: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
