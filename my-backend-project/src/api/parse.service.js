// src/api/parse.service.js
const { validateParsedRequest } = require('./validators/ajv');

// "1-3" gibi aralıkları YYYY-MM-DD listesine çevirir
function expandDaysFromInput(activeYM, rawText) {
  const m = rawText?.match?.(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/);
  if (!m) return [];
  const start = Number(m[1]);
  const end = Number(m[2]);
  const days = [];
  for (let d = start; d <= end; d++) {
    const dd = String(d).padStart(2, '0');
    days.push(`${activeYM}-${dd}`);
  }
  return days;
}

async function parseRequest({ rawText, activeYM, personId, locale = 'tr-TR' }) {
  const days = expandDaysFromInput(activeYM, rawText);

  const payload = {
    schemaVersion: '1.0.0',
    personId: personId || null,
    locale,
    items: [
      ...(days.length
        ? [{ kind: 'LEAVE', code: 'B', dates: days, note: 'mock-day1-range' }]
        : [])
    ]
  };

  const { ok, errors } = validateParsedRequest(payload);
  if (!ok) {
    const err = new Error('ParsedRequest schema validation failed');
    err.status = 400;
    err.errors = errors;
    throw err;
  }

  return payload;
}

module.exports = { parseRequest, expandDaysFromInput };
