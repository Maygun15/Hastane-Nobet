'use strict';

// Çizelge yayın durumu (taslak / yayınlandı).
//
// - MonthlySchedule.publication.status: 'draft' | 'published'
// - Alan hiç yoksa (eski kayıtlar) çizelge YAYINLANMIŞ sayılır; böylece bugün
//   personelin gördüğü hiçbir çizelge bu değişiklikle kaybolmaz.
// - Yeni oluşan ay ve yeniden üretilen çizelge taslaktır; personel ('user')
//   taslağı göremez, sorumlu/yönetici görür.

const MonthlySchedule = require('../models/MonthlySchedule');

const PUBLICATION_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
});

// Taslağı görebilen roller (çizelgeyi hazırlayan/yöneten taraf).
const DRAFT_VIEWER_ROLES = new Set(['admin', 'superadmin', 'manager', 'authorized', 'staff']);

function canViewDrafts(user) {
  return DRAFT_VIEWER_ROLES.has(String(user?.role || '').toLowerCase());
}

function isDraftSchedule(doc) {
  return String(doc?.publication?.status || '') === PUBLICATION_STATUS.DRAFT;
}

function draftPublication(user = null, reason = '') {
  return {
    status: PUBLICATION_STATUS.DRAFT,
    draftedAt: new Date(),
    draftedBy: user?.uid || user || null,
    ...(reason ? { draftReason: reason } : {}),
  };
}

function publishedPublication(user = null) {
  return {
    status: PUBLICATION_STATUS.PUBLISHED,
    publishedAt: new Date(),
    publishedBy: user?.uid || user || null,
    publishedByName: user?.name || user?.email || '',
  };
}

/**
 * Bir ay için taslaktaki çizelgelerin kapsamlarını döner:
 * [{ sectionId, serviceId, role }]
 */
async function findDraftScopes({ hospitalId = null, year, month, sectionId = null } = {}) {
  const filter = {
    year: Number(year),
    month: Number(month),
    'publication.status': PUBLICATION_STATUS.DRAFT,
  };
  if (hospitalId) filter.hospitalId = hospitalId;
  if (sectionId) filter.sectionId = String(sectionId);

  const docs = (await MonthlySchedule.find(filter).select('sectionId serviceId role').lean()) || [];
  return docs.map((d) => ({
    sectionId: String(d.sectionId || ''),
    serviceId: String(d.serviceId || ''),
    role: String(d.role || ''),
  }));
}

/**
 * Assignment sorgusuna taslak kapsamları hariç tutan koşulu ekler.
 * Sorgu nesnesini değiştirmez, yenisini döner.
 */
function excludeDraftScopes(query = {}, draftScopes = []) {
  if (!Array.isArray(draftScopes) || !draftScopes.length) return query;
  return {
    ...query,
    $nor: draftScopes.map((s) => ({ sectionId: s.sectionId, serviceId: s.serviceId, role: s.role })),
  };
}

async function setPublicationStatus(scopeQuery, status, user = null) {
  const publication = status === PUBLICATION_STATUS.PUBLISHED
    ? publishedPublication(user)
    : draftPublication(user, 'manual');
  return MonthlySchedule.findOneAndUpdate(
    scopeQuery,
    { $set: { publication, updatedBy: user?.uid || null } },
    { new: true }
  ).lean();
}

module.exports = {
  PUBLICATION_STATUS,
  canViewDrafts,
  draftPublication,
  excludeDraftScopes,
  findDraftScopes,
  isDraftSchedule,
  publishedPublication,
  setPublicationStatus,
};
