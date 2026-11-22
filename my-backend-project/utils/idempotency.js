'use strict';
// İşlem kimliği (clientRequestId / opId) ile tekrar-güvenli istekler için içerik parmak izi.
// Aynı kimlik + aynı içerik → önceki sonuç döner. Aynı kimlik + FARKLI içerik → 409 (açıklamalı).
const crypto = require('crypto');

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  return JSON.stringify(value ?? null);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stable(value)).digest('hex').slice(0, 32);
}

// Talep içeriğinin karşılaştırılan alanları (kayıtta saklandığı biçimde normalize).
function requestContent(src = {}) {
  const s = (v) => String(v ?? '').trim();
  return {
    type: s(src.type),
    targetDate: s(src.targetDate).slice(0, 10),
    targetDateEnd: s(src.targetDateEnd).slice(0, 10),
    leaveTypeCode: s(src.leaveTypeCode).toUpperCase(),
    message: s(src.message),
    preferenceKind: s(src.preferenceKind),
    swapWithPersonId: s(src.swapWithPersonId),
    swapMyAssignmentId: s(src.swapMyAssignmentId),
    swapTargetAssignmentId: s(src.swapTargetAssignmentId),
  };
}

const KEY_REUSED = {
  code: 'IDEMPOTENCY_KEY_REUSED',
  message: 'Bu işlem kimliği daha önce farklı içerikli bir istek için kullanıldı. Yeni bir işlem için formu yenileyip tekrar gönderin.',
};

module.exports = { stable, fingerprint, requestContent, KEY_REUSED };
