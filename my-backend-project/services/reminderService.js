// services/reminderService.js — 24h shift reminder, runs daily at 08:00
const MonthlySchedule = require('../models/MonthlySchedule');
const Person          = require('../models/Person');
const User            = require('../models/User');
const { sendMail, isConfigured } = require('../utils/mailer');

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

function notificationsEnabled() {
  return ENABLED_VALUES.has(String(process.env.NOTIFICATIONS_ENABLED || '').toLowerCase());
}

function formatDate(d) {
  return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()}`;
}

function reminderHtml(name, date, shiftId) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 12px;color:#6366f1">Yarınki Nöbet Hatırlatması</h2>
      <p>Merhaba <strong>${String(name || 'Çalışan').replace(/[<>&"]/g,'')}</strong>,</p>
      <p>Yarın <strong>${String(date).replace(/[<>&"]/g,'')}</strong> tarihinde
         <strong>${String(shiftId || '—').replace(/[<>&"]/g,'')}</strong> nöbetiniz bulunmaktadır.</p>
      <p style="margin-top:16px;color:#64748b;font-size:12px">
        Bu e-posta otomatik gönderilmiştir.
      </p>
    </div>`;
}

async function sendReminders() {
  if (!notificationsEnabled() || !isConfigured()) return { skipped: true };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const year  = tomorrow.getFullYear();
  const month = tomorrow.getMonth() + 1;
  const dayStr = `${year}-${String(month).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;

  const docs = await MonthlySchedule.find({ year, month }).lean();
  const assignments = docs.flatMap((d) => (d?.data?.assignments || []));
  const tomorrowAssignments = assignments.filter((a) => String(a?.date || '').slice(0,10) === dayStr);

  if (!tomorrowAssignments.length) return { sent: 0, date: dayStr };

  // Group by personId to send one email per person even if multiple shifts
  const byPerson = {};
  for (const a of tomorrowAssignments) {
    const pid = String(a?.personId || '');
    if (!pid) continue;
    (byPerson[pid] ??= { shifts: [], name: a.personName || '' }).shifts.push(a.shiftId || '—');
  }

  let sent = 0;
  for (const [personId, info] of Object.entries(byPerson)) {
    const person = await Person.findById(personId).select('email name userId').lean();
    const email = String(person?.email || '').trim().toLowerCase();
    const name = info.name || person?.name || '';

    let recipientEmail = email;
    if (!recipientEmail?.includes('@') && person?.userId) {
      const user = await User.findById(person.userId).select('email').lean();
      recipientEmail = String(user?.email || '').trim().toLowerCase();
    }
    if (!recipientEmail?.includes('@')) continue;

    try {
      await sendMail({
        to: recipientEmail,
        subject: `Yarın (${formatDate(tomorrow)}) nöbetiniz var`,
        html: reminderHtml(name, formatDate(tomorrow), info.shifts.join(', ')),
      });
      sent++;
    } catch (err) {
      console.warn('[reminder] mail error:', recipientEmail, err?.message || err);
    }
  }

  return { sent, date: dayStr };
}

function msUntilNextRun(hour = 8, minute = 0) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

let _started = false;
function startReminderJob() {
  if (_started) return;
  _started = true;

  function schedule() {
    const delay = msUntilNextRun(8, 0);
    setTimeout(async () => {
      try {
        const result = await sendReminders();
        console.log('[reminder] ran:', result);
      } catch (err) {
        console.error('[reminder] error:', err?.message || err);
      }
      schedule(); // reschedule next day
    }, delay);
  }

  schedule();
  console.log(`[reminder] scheduled — next run at 08:00 (in ${Math.round(msUntilNextRun(8,0)/60000)} min)`);
}

module.exports = { startReminderJob, sendReminders };
