// services/validation.service.js
// hospitalScope plugin (AsyncLocalStorage) otomatik hospitalId filtresi ekler;
// bu fonksiyonlar request bağlamı içinden çağrıldığında ek filtre gerekmez.
'use strict';
const Assignment = require('../models/Assignment');

/**
 * Belirtilen tarih aralığında kişinin aktif nöbeti var mı kontrol eder.
 * hospitalScope plugin'i sorguya hospitalId'yi otomatik ekler.
 *
 * @param {string} personId
 * @param {string} startDate — 'YYYY-MM-DD'
 * @param {string} endDate   — 'YYYY-MM-DD'
 * @param {object} [sessionOpts] — { session } mongoose transaction session
 * @returns {Promise<Array>} Çakışan Assignment belgeleri (boş → çakışma yok)
 */
async function checkConflict(personId, startDate, endDate, sessionOpts = {}) {
  if (!personId || !startDate || !endDate) return [];

  const pid   = String(personId).trim();
  const start = String(startDate).slice(0, 10);
  const end   = String(endDate).slice(0, 10);

  const query = Assignment.find(
    { personId: pid, date: { $gte: start, $lte: end }, status: 'active' },
  ).select('personId personName date shiftCode roleLabel sectionId serviceId').lean();

  if (sessionOpts?.session) query.session(sessionOpts.session);
  return query;
}

module.exports = { checkConflict };
