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

  const actionText = action === 'removed' ? 'silindi' : 'güncellendi';
  return dispatchMail({
    to: recipient.email,
    subject: `Vardiya Kaydınız ${actionText === 'silindi' ? 'Silindi' : 'Güncellendi'}`,
    html,
    text: `Merhaba ${recipient.name || 'çalışan'}, ${date || '-'} tarihli vardiya kaydınız ${actionText}.`,
  });
}

module.exports = {
  sendLeaveApproved,
  sendLeaveRejected,
  sendShiftChanged,
  saveAndBroadcast,
};
