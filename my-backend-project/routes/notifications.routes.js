// routes/notifications.routes.js — SSE stream + notification history
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/authz');
const { register, broadcast, connectionCount } = require('../services/sseService');
const Notification = require('../models/Notification');

const HEARTBEAT_MS = 25000;

function uid(req) {
  return String(req.user?.uid || req.user?._id || req.user?.id || '');
}

/* ─── GET /api/notifications/stream ─── */
router.get('/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  register(uid(req), res);
  res.write(`event: connected\ndata: ${JSON.stringify({ uid: uid(req), connections: connectionCount() })}\n\n`);

  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); }
  }, HEARTBEAT_MS);

  req.on('close', () => clearInterval(hb));
});

/* ─── GET /api/notifications — geçmiş bildirimler ─── */
router.get('/', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query?.limit) || 50, 100);
    const items = await Notification.find({ userId: uid(req) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ items });
  } catch {
    res.json({ items: [] });
  }
});

/* ─── GET /api/notifications/unread-count ─── */
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: uid(req), read: false });
    res.json({ count });
  } catch {
    res.json({ count: 0 });
  }
});

/* ─── PATCH /api/notifications/read-all ─── */
router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    await Notification.updateMany({ userId: uid(req), read: false }, { $set: { read: true } });
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

/* ─── PATCH /api/notifications/:id/read ─── */
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { $set: { read: true } }
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

/* ─── POST /api/notifications/test (dev) ─── */
if (process.env.NODE_ENV !== 'production') {
  router.post('/test', requireAuth, (req, res) => {
    const { userId, event = 'notification', data = {} } = req.body || {};
    const target = userId || uid(req);
    broadcast(target, event, { message: 'Test bildirimi', ...data, ts: Date.now() });
    return res.json({ ok: true, target });
  });
}

module.exports = router;
