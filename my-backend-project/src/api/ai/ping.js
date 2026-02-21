// src/api/ai/ping.js
const express = require('express');
const router = express.Router();

// ✅ AI servisleri için ping testi
router.get('/ping', (_req, res) => {
  res.json({ pong: true, service: 'ai', ts: Date.now() });
});

module.exports = router;
