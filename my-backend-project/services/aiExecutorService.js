// services/aiExecutorService.js — AI JSON çıktısını gerçek DB işlemine dönüştürür
const MonthlySchedule = require('../models/MonthlySchedule');
const Setting         = require('../models/Setting');
const Person          = require('../models/Person');

// Kişi adı veya ID ile Person kaydını bul
async function resolvePerson(nameOrId) {
  if (!nameOrId) return null;
  const s = String(nameOrId).trim();
  if (/^[a-f0-9]{24}$/i.test(s)) return Person.findById(s).lean();
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Person.findOne({ name: new RegExp(escaped, 'i') }).lean();
}

function parseYM(dateStr) {
  const m = String(dateStr || '').slice(0, 7).match(/^(\d{4})-(\d{2})$/);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

// ── Query: belirtilen kişi ve tarih için atamaları getir ──
async function execQuerySchedule({ entities }) {
  const { person, date, dateStart } = entities || {};
  const targetDate = date || dateStart;
  if (!targetDate) return { ok: false, message: 'Tarih belirtilmedi' };

  const ym = parseYM(targetDate);
  if (!ym) return { ok: false, message: 'Geçersiz tarih formatı' };

  const docs = await MonthlySchedule.find({ year: ym.year, month: ym.month }).lean();
  const resolvedPerson = await resolvePerson(person);

  let assignments = [];
  for (const doc of docs) {
    const list = Array.isArray(doc?.data?.assignments) ? doc.data.assignments : [];
    if (resolvedPerson) {
      assignments.push(...list.filter((a) => {
        const aPid = String(a?.personId || '').trim();
        const aName = String(a?.personName || '').trim().toLowerCase();
        return aPid === String(resolvedPerson._id) || aName === String(person || '').toLowerCase();
      }));
    } else {
      assignments.push(...list);
    }
  }

  if (date) {
    assignments = assignments.filter((a) => String(a?.date || a?.day || '').slice(0, 10) === date);
  }

  return {
    ok: true,
    data: assignments,
    humanReadable: assignments.length
      ? `${assignments.length} atama bulundu`
      : 'Bu tarihe ait atama yok',
  };
}

// ── Add leave: kişiye izin yaz ──
async function execAddLeave({ entities }) {
  const { person, date, dateStart, dateEnd, leaveType } = entities || {};
  const resolvedPerson = await resolvePerson(person);
  if (!resolvedPerson) return { ok: false, message: `Kişi bulunamadı: ${person}` };

  const startStr = date || dateStart;
  const endStr   = dateEnd || startStr;
  if (!startStr) return { ok: false, message: 'Tarih belirtilmedi' };

  const start = new Date(`${startStr}T00:00:00`);
  const end   = new Date(`${endStr}T00:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    return { ok: false, message: 'Geçersiz tarih aralığı' };
  }

  const code = String(leaveType || 'YILLIK').trim().toUpperCase();
  const pid  = String(resolvedPerson._id);
  const sid  = String(resolvedPerson.serviceId || '');

  // Günleri aya göre grupla
  const byMonth = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    (byMonth[mk] ??= []).push(d.getDate());
  }

  for (const [monthKey, days] of Object.entries(byMonth)) {
    let doc = await Setting.findOne({ key: 'leavesV2', serviceId: sid });
    if (!doc) doc = new Setting({ key: 'leavesV2', serviceId: sid, value: {} });
    const value = typeof doc.value === 'object' ? { ...doc.value } : {};
    value[pid] ??= {};
    value[pid][monthKey] ??= {};
    for (const day of days) value[pid][monthKey][String(day)] = { code };
    doc.value = value;
    doc.markModified('value');
    await doc.save();
  }

  const days = Math.round((end - start) / 86400000) + 1;
  return { ok: true, humanReadable: `${resolvedPerson.name} için ${days} günlük ${code} izni kaydedildi` };
}

// ── Remove leave: kişinin iznini sil ──
async function execRemoveLeave({ entities }) {
  const { person, date, dateStart, dateEnd } = entities || {};
  const resolvedPerson = await resolvePerson(person);
  if (!resolvedPerson) return { ok: false, message: `Kişi bulunamadı: ${person}` };

  const startStr = date || dateStart;
  const endStr   = dateEnd || startStr;
  if (!startStr) return { ok: false, message: 'Tarih belirtilmedi' };

  const start = new Date(`${startStr}T00:00:00`);
  const end   = new Date(`${endStr}T00:00:00`);
  const pid   = String(resolvedPerson._id);
  const sid   = String(resolvedPerson.serviceId || '');

  const byMonth = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    (byMonth[mk] ??= []).push(d.getDate());
  }

  for (const [monthKey, days] of Object.entries(byMonth)) {
    const doc = await Setting.findOne({ key: 'leavesV2', serviceId: sid });
    if (!doc?.value) continue;
    const value = { ...doc.value };
    for (const day of days) delete (value[pid]?.[monthKey] || {})[String(day)];
    doc.value = value;
    doc.markModified('value');
    await doc.save();
  }

  return { ok: true, humanReadable: `${resolvedPerson.name} için izin silindi` };
}

/**
 * Onaylanmış bir AI komutunu çalıştırır.
 * assign_shift / remove_shift → route'lara yönlendir (executor yetersiz bağlam nedeniyle)
 * query_schedule / add_leave / remove_leave → burada çalıştır
 */
async function executeCommand({ intent, entities }) {
  switch (intent) {
    case 'query_schedule':
    case 'query_person':
      return execQuerySchedule({ entities });
    case 'add_leave':
      return execAddLeave({ entities });
    case 'remove_leave':
      return execRemoveLeave({ entities });
    case 'assign_shift':
    case 'remove_shift':
    case 'swap_shifts':
      // Tam bağlam (sectionId, serviceId, year/month, etc.) gerektirir.
      // Frontend bu intentler için kendi schedule route'larına yönlendirilmeli.
      return {
        ok: false,
        requiresManual: true,
        message: `"${intent}" işlemi için çizelge ekranından manuel atama yapılmalı. AI gerekli tüm bağlamı belirleyemiyor.`,
        hint: { intent, entities },
      };
    case 'generate_schedule':
      return {
        ok: false,
        requiresManual: true,
        message: 'Otomatik çizelge oluşturma için Çizelge sekmesinden çalıştırın.',
      };
    default:
      return { ok: false, message: `Bilinmeyen intent: ${intent}` };
  }
}

module.exports = { executeCommand, resolvePerson };
