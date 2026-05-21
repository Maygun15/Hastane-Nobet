// routes/notifications.routes.js — SSE stream + notification history
const express = require('express');
const router  = express.Router();
const { requireAuth, requireRole } = require('../middleware/authz');
const { register, broadcast, connectionCount } = require('../services/sseService');
const Notification = require('../models/Notification');
const AnnouncementResponse = require('../models/AnnouncementResponse');

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
  res.write(`event: connected\ndata: ${JSON.stringify({ uid: uid(req) })}\n\n`);

  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); }
  }, HEARTBEAT_MS);

  req.on('close', () => clearInterval(hb));
});

/* ─── GET /api/notifications — geçmiş bildirimler ─── */
router.get('/', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query?.limit) || 50, 100);
    const filter = { userId: uid(req) };
    if (req.query?.type) filter.type = String(req.query.type);
    const items = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ items, notifications: items });
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
    const filter = { userId: uid(req), read: false };
    if (req.query?.type) filter.type = String(req.query.type);
    await Notification.updateMany(filter, { $set: { read: true } });
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

/* ─── POST /api/notifications/:id/respond — duyuru okundu/yanıt kaydı ─── */
router.post('/:id/respond', requireAuth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: uid(req),
      type: 'announcement',
    });
    if (!notification) return res.status(404).json({ message: 'Duyuru bulunamadı' });

    const mode = String(notification.data?.announcementMode || 'info').toLowerCase();
    const responseType = String(req.body?.responseType || '').toLowerCase();
    const message = String(req.body?.message || '').trim();

    if (responseType === 'ack' && mode !== 'ack') {
      return res.status(400).json({ message: 'Bu duyuru okundu onayı istemiyor' });
    }
    if (responseType === 'reply') {
      if (mode !== 'reply') return res.status(400).json({ message: 'Bu duyuru cevap kabul etmiyor' });
      if (!message) return res.status(400).json({ message: 'Cevap içeriği zorunludur' });
    }
    if (!['ack', 'reply'].includes(responseType)) {
      return res.status(400).json({ message: 'Geçersiz yanıt tipi' });
    }

    const response = await AnnouncementResponse.findOneAndUpdate(
      { notificationId: notification._id, userId: uid(req) },
      {
        $set: {
          hospitalId: req.hospitalId || notification.hospitalId || null,
          notificationId: notification._id,
          userId: uid(req),
          userName: req.user?.name || '',
          userEmail: req.user?.email || '',
          title: notification.title || '',
          responseType,
          message: responseType === 'reply' ? message.slice(0, 2000) : '',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    notification.read = true;
    notification.data = {
      ...(notification.data && typeof notification.data === 'object' ? notification.data : {}),
      response: {
        type: response.responseType,
        message: response.message || '',
        createdAt: response.updatedAt || response.createdAt || new Date(),
      },
    };
    notification.markModified('data');
    await notification.save();

    res.json({ ok: true, response });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Duyuru yanıtı kaydedilemedi' });
  }
});

/* ─── GET /api/notifications/announcement-responses — duyuru yanıtlarını listele ─── */
router.get('/announcement-responses', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const filter = {};
    if (req.query?.notificationId) filter.notificationId = String(req.query.notificationId);
    const limit = Math.min(Number(req.query?.limit) || 100, 300);
    const items = await AnnouncementResponse.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Duyuru yanıtları alınamadı' });
  }
});

/* ─── POST /api/notifications/broadcast — toplu duyuru gönder (admin only) ─── */
router.post('/broadcast', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { title, body, type, mode } = req.body || {};
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ message: 'Başlık ve içerik zorunludur' });
    }
    const { broadcastAnnouncement } = require('../services/notificationService');
    const result = await broadcastAnnouncement(req.hospitalId, title.trim(), body.trim(), type || 'announcement', { mode });
    res.json({
      ok: true,
      message: 'Duyuru gönderildi',
      targetedUsers: result?.targetedUsers || 0,
      createdNotifications: result?.createdNotifications || 0,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
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
