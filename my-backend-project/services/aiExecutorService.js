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

// ── Assign shift: kişiye belirli tarih + vardiya ata ──
async function execAssignShift({ entities }) {
  const { person, date, shiftCode, shiftLabel } = entities || {};
  if (!person)    return { ok: false, message: 'Kişi belirtilmedi' };
  if (!date)      return { ok: false, message: 'Tarih belirtilmedi' };
  if (!shiftCode) return { ok: false, message: 'Vardiya kodu belirtilmedi' };

  const ym = parseYM(date);
  if (!ym) return { ok: false, message: 'Geçersiz tarih formatı' };

  const resolvedPerson = await resolvePerson(person);
  if (!resolvedPerson) return { ok: false, message: `Kişi bulunamadı: ${person}` };

  const serviceId = String(resolvedPerson.serviceId || '');
  const doc = await MonthlySchedule.findOne({ year: ym.year, month: ym.month, serviceId }).lean();
  if (!doc) return { ok: false, message: `${ym.year}-${String(ym.month).padStart(2,'0')} için çizelge bulunamadı` };

  const data = doc.data || {};
  const assignments = Array.isArray(data.assignments) ? [...data.assignments] : [];
  const pid = String(resolvedPerson._id);

  const alreadyAssigned = assignments.some(
    (a) => String(a.personId) === pid && String(a.date || a.day || '').slice(0, 10) === date
  );
  if (alreadyAssigned) {
    return { ok: false, message: `${resolvedPerson.name} için ${date} tarihinde zaten bir atama var` };
  }

  assignments.push({
    personId:   pid,
    personName: resolvedPerson.name,
    date,
    shiftId:    shiftCode,
    shiftCode,
    shiftLabel: shiftLabel || shiftCode,
  });

  await MonthlySchedule.findByIdAndUpdate(doc._id, { $set: { 'data.assignments': assignments } });
  return { ok: true, humanReadable: `${resolvedPerson.name} için ${date} tarihine ${shiftCode} vardiyası atandı` };
}

// ── Remove shift: kişinin belirli tarihteki nöbetini sil ──
async function execRemoveShift({ entities }) {
  const { person, date, shiftCode } = entities || {};
  if (!person) return { ok: false, message: 'Kişi belirtilmedi' };
  if (!date)   return { ok: false, message: 'Tarih belirtilmedi' };

  const ym = parseYM(date);
  if (!ym) return { ok: false, message: 'Geçersiz tarih formatı' };

  const resolvedPerson = await resolvePerson(person);
  if (!resolvedPerson) return { ok: false, message: `Kişi bulunamadı: ${person}` };

  const serviceId = String(resolvedPerson.serviceId || '');
  const doc = await MonthlySchedule.findOne({ year: ym.year, month: ym.month, serviceId }).lean();
  if (!doc) return { ok: false, message: 'Çizelge bulunamadı' };

  const data = doc.data || {};
  const assignments = Array.isArray(data.assignments) ? [...data.assignments] : [];
  const pid = String(resolvedPerson._id);

  const filtered = assignments.filter((a) => {
    const aDate = String(a.date || a.day || '').slice(0, 10);
    const aPid  = String(a.personId || '');
    if (aPid !== pid || aDate !== date) return true;
    // shiftCode belirtildiyse sadece o kodu sil; yoksa o gündeki tüm atamayı sil
    if (shiftCode) return String(a.shiftId || a.shiftCode || '').toUpperCase() !== shiftCode.toUpperCase();
    return false;
  });

  if (filtered.length === assignments.length) {
    return { ok: false, message: `${resolvedPerson.name} için ${date} tarihinde silinecek atama bulunamadı` };
  }

  await MonthlySchedule.findByIdAndUpdate(doc._id, { $set: { 'data.assignments': filtered } });
  return { ok: true, humanReadable: `${resolvedPerson.name} için ${date} tarihindeki vardiya silindi` };
}

/**
 * Onaylanmış bir AI komutunu çalıştırır.
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
      return execAssignShift({ entities });
    case 'remove_shift':
      return execRemoveShift({ entities });
    case 'swap_shifts':
      // swap iki kişi gerektirir; AI entity şeması tek kişiyi destekliyor.
      // Frontend takas talep akışını kullanmalı.
      return {
        ok: false,
        requiresManual: true,
        message: 'Takas işlemi için Talepler ekranındaki takas talebi akışını kullanın.',
        hint: { intent, entities },
      };
    case 'generate_schedule':
      return {
        ok: false,
        requiresManual: true,
        message: 'Otomatik çizelge oluşturma için ✨ AI Çizelge sekmesinden çalıştırın.',
      };
    default:
      return { ok: false, message: `Bilinmeyen intent: ${intent}` };
  }
}

module.exports = { executeCommand, resolvePerson };
