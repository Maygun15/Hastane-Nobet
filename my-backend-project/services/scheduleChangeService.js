'use strict';

/**
 * Çizelge işlem geçmişi ve yayın sürümleri (İP-5 / E).
 *
 * İlişki (taslak → yayın → revizyon):
 *  - MonthlySchedule.revision: içerik her değiştiğinde +1 (İP-3).
 *  - publication.contentRevision: yayınlanan içerik revizyonu; publication.version: yayın sürümü.
 *  - Yayından sonra içerik değişirse plan "yayınlanmamış değişiklik var" durumuna geçer.
 *    Personel çizelgenin GÜNCEL hâlini görür (ayrı yayın kopyası tutulmaz) ama bildirim
 *    almaz; "Değişiklikleri yayınla" yeni sürüm oluşturur ve yalnız etkilenenleri bildirir.
 *  - Her içerik değişikliği / yayın bir ScheduleChange kaydıdır: kim, ne zaman, hangi nöbet.
 */

const ScheduleChange = require('../models/ScheduleChange');

const MAX_LISTED = 200;

function slotOf(a = {}) {
  return {
    date: String(a.date || a.day || '').slice(0, 10),
    rowId: String(a.rowId || a.shiftId || ''),
    shiftCode: String(a.shiftCode || a.code || ''),
    personId: String(a.personId || ''),
    personName: String(a.personName || a.name || ''),
  };
}

// Kişi kimliği: isim varsa isim (büyük harf), yoksa personId. Çizelge verisi iki biçimde
// dolaşıyor (personId'li atama / yalnız isimli tablo) — aynı nöbet aynı anahtarı almalı.
function personPart(s) {
  const name = String(s.personName || '').trim().toLocaleUpperCase('tr-TR');
  return name ? `n:${name}` : `i:${s.personId}`;
}
function slotKey(a = {}) {
  const s = slotOf(a);
  return `${s.date}|${s.rowId || s.shiftCode}|${personPart(s)}`;
}

/** İki atama listesi arasındaki fark (eklenen / çıkan). */
function diffAssignments(before = [], after = []) {
  const b = new Map((before || []).map((a) => [slotKey(a), a]));
  const a = new Map((after || []).map((x) => [slotKey(x), x]));
  const added = [];
  const removed = [];
  for (const [k, v] of a) if (!b.has(k)) added.push(slotOf(v));
  for (const [k, v] of b) if (!a.has(k)) removed.push(slotOf(v));
  const byDate = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  return { added: added.sort(byDate), removed: removed.sort(byDate) };
}

function scopeOf(q = {}) {
  return {
    hospitalId: q.hospitalId || null,
    sectionId: String(q.sectionId || ''),
    serviceId: String(q.serviceId || ''),
    role: String(q.role || ''),
    year: Number(q.year),
    month: Number(q.month),
  };
}

/**
 * Değişiklik kaydı yazar. İçerik değişmediyse (edit/undo) kayıt yazılmaz.
 * Geçmiş yazımı ana işlemi bozmaz: hata yutulur ve günlüğe yazılır.
 */
async function recordChange({ scope, scheduleId = null, kind = 'edit', source = '', before = null, after = null, added: addedIn = null, removed: removedIn = null, contentRevision = null, publishVersion = null, snapshot, user = null, note = '', throwOnDuplicate = false } = {}) {
  try {
    let added = Array.isArray(addedIn) ? addedIn.map(slotOf) : [];
    let removed = Array.isArray(removedIn) ? removedIn.map(slotOf) : [];
    if (!addedIn && !removedIn && (Array.isArray(before) || Array.isArray(after))) {
      ({ added, removed } = diffAssignments(before || [], after || []));
    }
    if ((kind === 'edit' || kind === 'undo') && !added.length && !removed.length) return null;
    return await ScheduleChange.create({
      ...scopeOf(scope),
      scheduleId,
      kind,
      source,
      contentRevision,
      publishVersion,
      added: added.slice(0, MAX_LISTED),
      removed: removed.slice(0, MAX_LISTED),
      addedCount: added.length,
      removedCount: removed.length,
      ...(snapshot ? { snapshot } : {}),
      by: user?.uid || null,
      byName: user?.name || user?.email || '',
      note,
    });
  } catch (err) {
    if (throwOnDuplicate && err?.code === 11000) throw err; // yayın sürümü zaten yazılmış (eş zamanlı yayın)
    console.error('[scheduleChange] kayıt yazılamadı:', err?.message || err);
    return null;
  }
}

async function listChanges(scope, { limit = 50 } = {}) {
  return ScheduleChange.find(scopeOf(scope))
    .sort({ at: -1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .lean();
}

async function lastPublishEvent(scope) {
  return ScheduleChange.findOne({ ...scopeOf(scope), kind: 'publish' })
    .sort({ publishVersion: -1, at: -1 })
    .select('+snapshot')
    .lean();
}

/** Yayın için: önceki yayına göre fark, yeni sürüm numarası, etkilenen kişiler. */
async function preparePublish(scope, assignments = []) {
  const prev = await lastPublishEvent(scope);
  const snapshot = (assignments || []).map(slotKey);
  if (!prev) {
    return { version: 1, isRevision: false, added: [], removed: [], affectedPersonIds: [], snapshot };
  }
  const prevKeys = new Set(prev.snapshot || []);
  const nowKeys = new Set(snapshot);
  const added = (assignments || []).filter((a) => !prevKeys.has(slotKey(a))).map(slotOf);
  const removed = [...prevKeys].filter((k) => !nowKeys.has(k)).map((k) => {
    const [date, rowId, person = ''] = k.split('|');
    const isName = person.startsWith('n:');
    return { date, rowId, shiftCode: '', personId: isName ? '' : person.replace(/^i:/, ''), personName: isName ? person.slice(2) : '' };
  });
  const affected = new Set([...added, ...removed].map((x) => x.personId || (x.personName ? `n:${x.personName.toLocaleUpperCase('tr-TR')}` : '')).filter(Boolean));
  return {
    version: Number(prev.publishVersion || 0) + 1,
    isRevision: true,
    previousVersion: Number(prev.publishVersion || 0),
    added,
    removed,
    affectedPersonIds: [...affected],
    snapshot,
  };
}

module.exports = {
  diffAssignments,
  listChanges,
  preparePublish,
  recordChange,
  slotKey,
};
