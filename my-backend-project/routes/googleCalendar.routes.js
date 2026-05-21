const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Assignment = require('../models/Assignment');
const CalendarSyncEvent = require('../models/CalendarSyncEvent');
const { requireAuth } = require('../middleware/authz');
const {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  buildEventPayload,
  hashPayload,
  createEvent,
  updateEvent,
  DEFAULT_REMINDER_MINUTES,
} = require('../services/googleCalendarService');

const secureRouter = express.Router();
const publicRouter = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5174';

function uid(req) {
  return String(req.user?.uid || req.user?.id || req.user?._id || '');
}

function finishUrl(status, message = '') {
  const url = new URL('/#/takvimim', FRONTEND_ORIGIN);
  url.searchParams.set('googleCalendar', status);
  if (message) url.searchParams.set('message', message);
  return url.toString();
}

function normalizeMonth(input) {
  const n = Number(input);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? Math.trunc(n) : new Date().getMonth() + 1;
}

function normalizeYear(input) {
  const n = Number(input);
  return Number.isFinite(n) && n >= 2000 && n <= 2100 ? Math.trunc(n) : new Date().getFullYear();
}

async function getUserWithCalendar(userId) {
  return User.findById(userId)
    .select([
      'name',
      'email',
      'hospitalId',
      'personId',
      'googleCalendar.connected',
      'googleCalendar.calendarId',
      'googleCalendar.expiryDate',
      'googleCalendar.scope',
      'googleCalendar.lastSyncAt',
      'googleCalendar.reminderMinutes',
      '+googleCalendar.accessToken',
      '+googleCalendar.refreshToken',
    ].join(' '))
    .lean();
}

async function ensureAccessToken(user) {
  const google = user?.googleCalendar || {};
  if (!google.connected || !google.refreshToken) {
    const err = new Error('Google Takvim bağlantısı yok');
    err.status = 400;
    throw err;
  }
  const expiry = google.expiryDate ? new Date(google.expiryDate).getTime() : 0;
  if (google.accessToken && expiry > Date.now() + 60_000) return google.accessToken;

  const refreshed = await refreshAccessToken(google.refreshToken);
  await User.findByIdAndUpdate(user._id, {
    $set: {
      'googleCalendar.connected': true,
      'googleCalendar.accessToken': refreshed.accessToken,
      'googleCalendar.expiryDate': refreshed.expiryDate,
      'googleCalendar.scope': refreshed.scope || google.scope || '',
    },
  });
  return refreshed.accessToken;
}

secureRouter.get('/status', requireAuth, async (req, res) => {
  try {
    const user = await getUserWithCalendar(uid(req));
    const google = user?.googleCalendar || {};
    res.json({
      connected: !!google.connected && !!google.refreshToken,
      calendarId: google.calendarId || 'primary',
      lastSyncAt: google.lastSyncAt || null,
      reminderMinutes: DEFAULT_REMINDER_MINUTES,
    });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'Google Takvim durumu alınamadı' });
  }
});

secureRouter.post('/auth-url', requireAuth, async (req, res) => {
  try {
    if (!JWT_SECRET) return res.status(500).json({ message: 'JWT_SECRET tanımlı değil' });
    const state = jwt.sign(
      { uid: uid(req), hospitalId: req.hospitalId || req.user?.hospitalId || null },
      JWT_SECRET,
      { expiresIn: '10m' }
    );
    res.json({ url: buildAuthUrl(state) });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'Google bağlantı adresi oluşturulamadı' });
  }
});

secureRouter.delete('/disconnect', requireAuth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(uid(req), {
      $set: { 'googleCalendar.connected': false },
      $unset: {
        'googleCalendar.accessToken': 1,
        'googleCalendar.refreshToken': 1,
        'googleCalendar.expiryDate': 1,
        'googleCalendar.scope': 1,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'Google Takvim bağlantısı kaldırılamadı' });
  }
});

secureRouter.post('/sync', requireAuth, async (req, res) => {
  try {
    const user = await getUserWithCalendar(uid(req));
    if (!user) return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
    const hospitalId = req.hospitalId || user.hospitalId || null;
    if (!hospitalId) return res.status(400).json({ message: 'hospitalId eksik' });
    if (!user.personId) return res.status(400).json({ message: 'Kullanıcı bir personel kaydına bağlı değil' });

    const year = normalizeYear(req.body?.year || req.query?.year);
    const month = normalizeMonth(req.body?.month || req.query?.month);
    const sectionId = String(req.body?.sectionId || req.query?.sectionId || 'calisma-cizelgesi');
    const google = user.googleCalendar || {};
    const calendarId = google.calendarId || 'primary';
    const accessToken = await ensureAccessToken(user);

    const assignments = await Assignment.find({
      hospitalId,
      personId: String(user.personId),
      sectionId,
      year,
      month,
      status: { $ne: 'deleted' },
    }).sort({ date: 1, shiftCode: 1, roleLabel: 1 }).lean();

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const assignment of assignments) {
      const payload = buildEventPayload(assignment, DEFAULT_REMINDER_MINUTES);
      const payloadHash = hashPayload(payload);
      const mapping = await CalendarSyncEvent.findOne({
        hospitalId,
        userId: user._id,
        assignmentId: assignment._id,
      });

      try {
        if (mapping?.googleEventId) {
          if (mapping.payloadHash === payloadHash) {
            skipped += 1;
            continue;
          }
          const event = await updateEvent({
            accessToken,
            calendarId,
            eventId: mapping.googleEventId,
            payload,
          });
          mapping.googleEventId = event.id || mapping.googleEventId;
          mapping.payloadHash = payloadHash;
          mapping.lastSyncedAt = new Date();
          await mapping.save();
          updated += 1;
          continue;
        }

        const event = await createEvent({ accessToken, calendarId, payload });
        await CalendarSyncEvent.findOneAndUpdate(
          { hospitalId, userId: user._id, assignmentId: assignment._id },
          {
            $set: {
              hospitalId,
              userId: user._id,
              assignmentId: assignment._id,
              googleEventId: event.id,
              payloadHash,
              lastSyncedAt: new Date(),
            },
          },
          { upsert: true, new: true }
        );
        created += 1;
      } catch (eventErr) {
        errors.push({
          assignmentId: String(assignment._id),
          date: assignment.date,
          message: eventErr?.response?.data?.error?.message || eventErr?.message || 'Google etkinliği yazılamadı',
        });
      }
    }

    await User.findByIdAndUpdate(user._id, { $set: { 'googleCalendar.lastSyncAt': new Date() } });
    res.json({
      ok: errors.length === 0,
      year,
      month,
      total: assignments.length,
      created,
      updated,
      skipped,
      errors,
    });
  } catch (err) {
    const status = err?.status || 500;
    res.status(status).json({ message: err?.message || 'Google Takvim senkronizasyonu başarısız' });
  }
});

publicRouter.get('/callback', async (req, res) => {
  try {
    const code = String(req.query?.code || '');
    const state = String(req.query?.state || '');
    if (!code || !state) return res.redirect(finishUrl('error', 'Eksik Google dönüş bilgisi'));
    const decoded = jwt.verify(state, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded?.uid) return res.redirect(finishUrl('error', 'Geçersiz bağlantı durumu'));

    const tokens = await exchangeCode(code);
    const update = {
      'googleCalendar.connected': true,
      'googleCalendar.calendarId': 'primary',
      'googleCalendar.accessToken': tokens.accessToken,
      'googleCalendar.expiryDate': tokens.expiryDate,
      'googleCalendar.scope': tokens.scope,
    };
    if (tokens.refreshToken) update['googleCalendar.refreshToken'] = tokens.refreshToken;

    await User.findByIdAndUpdate(decoded.uid, { $set: update });
    return res.redirect(finishUrl('connected'));
  } catch (err) {
    return res.redirect(finishUrl('error', err?.message || 'Google bağlantısı tamamlanamadı'));
  }
});

module.exports = { secureRouter, publicRouter };
