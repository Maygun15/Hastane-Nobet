// routes/notifications.routes.js — SSE stream + notification history
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/authz');
const { register, broadcast, connectionCount } = require('../services/sseService');

const HEARTBEAT_MS = 25000; // 25s — nginx/Vercel idle timeout safe

/* ─── GET /api/notifications/stream ────────────────────────────
   Long-lived SSE connection.  Client subscribes with:
     const es = new EventSource('/api/notifications/stream', { withCredentials: true })
     es.addEventListener('notification', (e) => ...)
   ─────────────────────────────────────────────────────────────── */
router.get('/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx disable buffering
  res.flushHeaders();

  const uid = String(req.user?.uid || req.user?._id || req.user?.id || '');
  register(uid, res);

  // Welcome event
  res.write(`event: connected\ndata: ${JSON.stringify({ uid, connections: connectionCount() })}\n\n`);

  // Heartbeat to keep connection alive through proxies
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); }
  }, HEARTBEAT_MS);

  req.on('close', () => clearInterval(hb));
});

/* ─── POST /api/notifications/test ─────────────────────────────
   Dev helper: push a test notification to a specific user.
   ─────────────────────────────────────────────────────────────── */
if (process.env.NODE_ENV !== 'production') {
  router.post('/test', requireAuth, (req, res) => {
    const { userId, event = 'notification', data = {} } = req.body || {};
    const target = userId || String(req.user?.uid || '');
    broadcast(target, event, { message: 'Test bildirimi', ...data, ts: Date.now() });
    return res.json({ ok: true, target });
  });
}

module.exports = router;
