const { sendMail, isConfigured } = require('../utils/mailer');
const User = require('../models/User');
const Person = require('../models/Person');
const Notification = require('../models/Notification');
const { broadcast } = require('./sseService');

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

function notificationsEnabled() {
  return ENABLED_VALUES.has(String(process.env.NOTIFICATIONS_ENABLED || '').toLowerCase());
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.includes('@') ? email : '';
}

function normalizeName(value) {
  return String(value || '').trim();
}

async function resolveRecipient({ userId, personId, fallbackName = '', fallbackEmail = '' } = {}) {
  const directEmail = normalizeEmail(fallbackEmail);
  if (directEmail) {
    return { email: directEmail, name: normalizeName(fallbackName) || 'Çalışan' };
  }

  let person = null;
  if (personId) {
    person = await Person.findById(String(personId)).select('email name userId').lean();
    const personEmail = normalizeEmail(person?.email);
    if (personEmail) {
      return {
        email: personEmail,
        name: normalizeName(person?.name) || normalizeName(fallbackName) || 'Çalışan',
      };
    }
  }

  const lookupUserId = userId || person?.userId;
  if (lookupUserId) {
    const user = await User.findById(String(lookupUserId)).select('email name').lean();
    const userEmail = normalizeEmail(user?.email);
    if (userEmail) {
      return {
        email: userEmail,
        name: normalizeName(user?.name) || normalizeName(fallbackName) || normalizeName(person?.name) || 'Çalışan',
      };
    }
  }

  return null;
}

function leaveDateText(request = {}) {
  const start = String(request?.targetDate || '').trim();
  const end = String(request?.targetDateEnd || '').trim();
  if (!start && !end) return '-';
  if (start && end && start !== end) return `${start} - ${end}`;
  return start || end;
}

function leaveApprovedTemplate({ name, request, actorName }) {
  const personName = htmlEscape(name || 'Çalışan');
  const resolverName = htmlEscape(actorName || 'Yetkili');
  const type = htmlEscape(request?.type || 'izin');
  const dateRange = htmlEscape(leaveDateText(request));
  const note = htmlEscape(request?.adminNote || '-');
  const message = htmlEscape(request?.message || '-');
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 12px;color:#059669">İzin Talebiniz Onaylandı</h2>
      <p>Merhaba <strong>${personName}</strong>,</p>
      <p><strong>${type}</strong> talebiniz <strong>${resolverName}</strong> tarafından onaylandı.</p>
      <table style="border-collapse:collapse;margin-top:8px">
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Tarih</td><td style="padding:4px 0"><strong>${dateRange}</strong></td></tr>
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Talep Notu</td><td style="padding:4px 0">${message}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Yönetici Notu</td><td style="padding:4px 0">${note}</td></tr>
      </table>
      <p style="margin-top:16px;color:#64748b;font-size:12px">Bu e-posta bilgilendirme amaçlıdır.</p>
    </div>
  `;
}

function leaveRejectedTemplate({ name, request, actorName }) {
  const personName = htmlEscape(name || 'Çalışan');
  const resolverName = htmlEscape(actorName || 'Yetkili');
  const type = htmlEscape(request?.type || 'izin');
  const dateRange = htmlEscape(leaveDateText(request));
  const note = htmlEscape(request?.adminNote || '-');
  const message = htmlEscape(request?.message || '-');
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 12px;color:#dc2626">İzin Talebiniz Reddedildi</h2>
      <p>Merhaba <strong>${personName}</strong>,</p>
      <p><strong>${type}</strong> talebiniz <strong>${resolverName}</strong> tarafından reddedildi.</p>
      <table style="border-collapse:collapse;margin-top:8px">
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Tarih</td><td style="padding:4px 0"><strong>${dateRange}</strong></td></tr>
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Talep Notu</td><td style="padding:4px 0">${message}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Yönetici Notu</td><td style="padding:4px 0">${note}</td></tr>
      </table>
      <p style="margin-top:16px;color:#64748b;font-size:12px">Bu e-posta bilgilendirme amaçlıdır.</p>
    </div>
  `;
}

function shiftChangedTemplate({
  name,
  personName,
  date,
  previousShift,
  newShift,
  roleLabel,
  note,
  changedByName,
  action,
}) {
  const targetName = htmlEscape(name || personName || 'Çalışan');
  const changer = htmlEscape(changedByName || 'Yetkili');
  const dateText = htmlEscape(date || '-');
  const prev = htmlEscape(previousShift || '-');
  const next = htmlEscape(newShift || '-');
  const area = htmlEscape(roleLabel || '-');
  const noteText = htmlEscape(note || '-');
  const actionText = action === 'removed' ? 'silindi' : 'güncellendi';
  const title = action === 'removed' ? 'Vardiya Kaydı Silindi' : 'Vardiya Kaydı Güncellendi';

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 12px;color:#2563eb">${title}</h2>
      <p>Merhaba <strong>${targetName}</strong>,</p>
      <p>${dateText} tarihindeki vardiya kaydınız <strong>${changer}</strong> tarafından <strong>${actionText}</strong>.</p>
      <table style="border-collapse:collapse;margin-top:8px">
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Tarih</td><td style="padding:4px 0"><strong>${dateText}</strong></td></tr>
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Alan/Görev</td><td style="padding:4px 0">${area}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Eski Vardiya</td><td style="padding:4px 0">${prev}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Yeni Vardiya</td><td style="padding:4px 0">${next}</td></tr>
        <tr><td style="padding:4px 10px 4px 0;color:#475569">Not</td><td style="padding:4px 0">${noteText}</td></tr>
      </table>
      <p style="margin-top:16px;color:#64748b;font-size:12px">Bu e-posta bilgilendirme amaçlıdır.</p>
    </div>
  `;
}

async function dispatchMail({ to, subject, html, text }) {
  if (!notificationsEnabled()) return { ok: false, skipped: true, reason: 'notifications disabled' };
  if (!isConfigured()) return { ok: false, skipped: true, reason: 'smtp not configured' };
  if (!to) return { ok: false, skipped: true, reason: 'recipient email missing' };
  return sendMail({ to, subject, html, text });
}

async function saveAndBroadcast({ userId, hospitalId, type, title, message, data } = {}) {
  if (!userId || !message) return;
  try {
    const notif = await Notification.create({
      userId: String(userId),
      hospitalId: String(hospitalId || ''),
      type: type || 'info',
      title: title || '',
      message,
      data: data || null,
    });
    broadcast(String(userId), 'notification', {
      id: String(notif._id),
      type: notif.type,
      title: notif.title,
      message: notif.message,
      ts: Date.now(),
    });
  } catch (err) {
    console.error('[saveAndBroadcast]', err?.message || err);
  }
}

async function sendLeaveApproved({ request, actorName }) {
  const recipient = await resolveRecipient({
    userId: request?.fromUserId,
    personId: request?.fromPersonId,
    fallbackName: request?.fromName,
  });

  // SSE + DB — email'den bağımsız her zaman tetiklenir
  void saveAndBroadcast({
    userId: request?.fromUserId,
    hospitalId: request?.hospitalId,
    type: 'success',
    title: 'İzin Onaylandı',
    message: `${leaveDateText(request)} tarihli izin talebiniz onaylandı.`,
    data: { requestId: request?._id },
  });

  if (!recipient?.email) return { ok: false, skipped: true, reason: 'recipient not found' };
  const html = leaveApprovedTemplate({ name: recipient.name, request, actorName });
  return dispatchMail({
    to: recipient.email,
    subject: 'İzin Talebiniz Onaylandı',
    html,
    text: `Merhaba ${recipient.name || 'çalışan'}, ${leaveDateText(request)} tarihli izin talebiniz onaylandı.`,
  });
}

async function sendLeaveRejected({ request, actorName }) {
  const recipient = await resolveRecipient({
    userId: request?.fromUserId,
    personId: request?.fromPersonId,
    fallbackName: request?.fromName,
  });

  void saveAndBroadcast({
    userId: request?.fromUserId,
    hospitalId: request?.hospitalId,
    type: 'error',
    title: 'İzin Reddedildi',
    message: `${leaveDateText(request)} tarihli izin talebiniz reddedildi.`,
    data: { requestId: request?._id },
  });

  if (!recipient?.email) return { ok: false, skipped: true, reason: 'recipient not found' };
  const html = leaveRejectedTemplate({ name: recipient.name, request, actorName });
  return dispatchMail({
    to: recipient.email,
    subject: 'İzin Talebiniz Reddedildi',
    html,
    text: `Merhaba ${recipient.name || 'çalışan'}, ${leaveDateText(request)} tarihli izin talebiniz reddedildi.`,
  });
}

async function sendShiftChanged({
  personId,
  userId,
  personName,
  email,
  date,
  previousShift,
  newShift,
  roleLabel,
  note,
  changedByName,
  action = 'updated',
  hospitalId,
}) {
  const recipient = await resolveRecipient({
    userId,
    personId,
    fallbackName: personName,
    fallbackEmail: email,
  });

  const actionText = action === 'removed' ? 'silindi' : 'güncellendi';
  const resolvedUserId = userId || recipient?.userId;
  if (resolvedUserId) {
    void saveAndBroadcast({
      userId: resolvedUserId,
      hospitalId,
      type: action === 'removed' ? 'warning' : 'info',
      title: `Vardiya ${actionText === 'silindi' ? 'Silindi' : 'Güncellendi'}`,
      message: `${date || '-'} tarihli vardiya kaydınız ${actionText}.`,
      data: { date, previousShift, newShift },
    });
  }

  if (!recipient?.email) return { ok: false, skipped: true, reason: 'recipient not found' };

  const html = shiftChangedTemplate({
    name: recipient.name,
    personName,
    date,
    previousShift,
    newShift,
    roleLabel,
    note,
    changedByName,
    action,
  });

  return dispatchMail({
    to: recipient.email,
    subject: `Vardiya Kaydınız ${actionText === 'silindi' ? 'Silindi' : 'Güncellendi'}`,
    html,
    text: `Merhaba ${recipient.name || 'çalışan'}, ${date || '-'} tarihli vardiya kaydınız ${actionText}.`,
  });
}

async function sendNewRequestNotification({ request, senderName }) {
  if (!notificationsEnabled()) return;
  try {
    // In-app notification: admin ve yetkili rolleri için tüm kullanıcılara broadcast
    const admins = await User.find({
      role: { $in: ['admin', 'Admin', 'authorized', 'Authorized', 'manager', 'Manager'] },
      ...(request.hospitalId ? { hospitalId: request.hospitalId } : {}),
    }).select('_id email name').lean();

    const typeLabel = { izin: 'İzin', takas: 'Takas', tercih: 'Tercih', diger: 'Diğer' }[request.type] || request.type;
    const title = `Yeni ${typeLabel} Talebi`;
    const body = `${senderName || 'Bir personel'} yeni bir ${typeLabel.toLowerCase()} talebi gönderdi.`;

    for (const admin of admins) {
      try {
        const notif = await Notification.create({
          userId: admin._id,
          hospitalId: request.hospitalId || null,
          type: 'request_new',
          title,
          message: body,
          data: { requestId: request._id, requestType: request.type },
          read: false,
        });
        broadcast(String(admin._id), 'notification', {
          id: String(notif._id),
          type: 'request_new',
          title,
          message: body,
          body,
          read: false,
          createdAt: notif.createdAt || new Date().toISOString(),
          data: { requestId: request._id, requestType: request.type },
        });
      } catch {}
    }
  } catch (e) {
    console.warn('[notification] sendNewRequestNotification hata:', e?.message);
  }
}

/**
 * Hastanedeki tüm aktif kullanıcılara duyuru gönderir.
 * @param {ObjectId} hospitalId
 * @param {string} title
 * @param {string} body
 * @param {string} [type='announcement']
 */
async function broadcastAnnouncement(hospitalId, title, body, type = 'announcement', options = {}) {
  try {
    const mode = String(options?.mode || 'info').trim().toLowerCase();
    const normalizedMode = ['info', 'ack', 'reply'].includes(mode) ? mode : 'info';
    const users = await User.find({ hospitalId, active: true }).select('_id').lean();

    if (!users.length) {
      throw new Error('Aktif kullanıcı bulunamadı');
    }

    const docs = users.map(u => ({
      hospitalId: String(hospitalId || ''),
      userId: String(u._id),
      title,
      message: body,
      type,
      data: {
        announcementMode: normalizedMode,
        requireAck: normalizedMode === 'ack',
        allowReply: normalizedMode === 'reply',
      },
      read: false,
    }));
    const inserted = await Notification.insertMany(docs, { ordered: false });
    const insertedByUserId = new Map(
      inserted.map((item) => [String(item.userId), item])
    );

    // SSE: her kullanıcıya bireysel broadcast yap
    for (const u of users) {
      try {
        const item = insertedByUserId.get(String(u._id));
        broadcast(String(u._id), 'notification', {
          id: item?._id ? String(item._id) : undefined,
          _id: item?._id ? String(item._id) : undefined,
          type,
          title,
          message: body,
          body,
          data: item?.data || {
            announcementMode: normalizedMode,
            requireAck: normalizedMode === 'ack',
            allowReply: normalizedMode === 'reply',
          },
          read: false,
          createdAt: item?.createdAt || new Date().toISOString(),
          ts: Date.now(),
        });
      } catch {}
    }
    return { targetedUsers: users.length, createdNotifications: inserted.length };
  } catch (err) {
    console.error('[broadcastAnnouncement]', err?.message || err);
    throw err;
  }
}

const TR_MONTHS_NS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

/**
 * Nöbet çizelgesi yayınlandığında her personele adillik skoru içeren
 * profesyonel bir bildirim gönderir.
 *
 * @param {{ hospitalId, year, month, people: Array<{personId, personName, fairnessScore}> }} params
 */
async function sendSchedulePublished({ hospitalId, year, month, people = [] }) {
  const monthLabel = TR_MONTHS_NS[(Number(month) - 1)] || `Ay ${month}`;
  const yearNum    = Number(year);

  for (const p of people) {
    const score   = Number(p.fairnessScore ?? 100);
    const userId  = p.userId || null;

    // Hangi userId'yi kullanacağız: fairnessEngine personId bir Mongo ObjectId olabilir
    // ya da personName, bu yüzden User koleksiyonuna bakmayı dene
    let resolvedUserId = userId;
    if (!resolvedUserId && p.personId) {
      try {
        const person = await Person.findById(String(p.personId)).select('userId').lean();
        resolvedUserId = person?.userId ? String(person.userId) : null;
      } catch {}
    }

    if (!resolvedUserId) continue;

    const message = `${monthLabel} ${yearNum} nöbet dağılımınız, hastanemizin adil nöbet politikasına göre %${score} uyum sağlamıştır.`;

    void saveAndBroadcast({
      userId:     resolvedUserId,
      hospitalId: String(hospitalId || ''),
      type:       score >= 80 ? 'success' : score >= 55 ? 'warning' : 'info',
      title:      `${monthLabel} ${yearNum} Nöbet Çizelgesi Yayınlandı`,
      message,
      data:       { year: yearNum, month: Number(month), fairnessScore: score },
    });
  }
}

module.exports = {
  sendLeaveApproved,
  sendLeaveRejected,
  sendShiftChanged,
  saveAndBroadcast,
  sendNewRequestNotification,
  broadcastAnnouncement,
  sendSchedulePublished,
};
