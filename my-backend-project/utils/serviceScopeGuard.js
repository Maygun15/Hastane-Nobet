'use strict';

const ERROR_CODE = 'SPECIFIC_SERVICE_REQUIRED';
const ERROR_MESSAGE = 'A specific service must be selected before modifying or generating schedules.';

const INVALID_SERVICE_VALUES = new Set([
  '',
  'all',
  'all services',
  'tumu',
  'tum servisler',
]);

function normalizeServiceValue(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function createSpecificServiceRequiredError() {
  const error = new Error(ERROR_MESSAGE);
  error.code = ERROR_CODE;
  error.status = 400;
  error.statusCode = 400;
  return error;
}

function assertSpecificServiceId(serviceId) {
  const normalized = normalizeServiceValue(serviceId);
  if (INVALID_SERVICE_VALUES.has(normalized)) {
    throw createSpecificServiceRequiredError();
  }
  return String(serviceId).trim();
}

function specificServiceErrorPayload(error) {
  return {
    ok: false,
    code: error?.code || ERROR_CODE,
    message: error?.message || ERROR_MESSAGE,
  };
}

function requireSpecificServiceScope(req, res, next) {
  try {
    const serviceId = assertSpecificServiceId(req.body?.serviceId);
    req.body = { ...(req.body || {}), serviceId };
    return next();
  } catch (error) {
    return res.status(400).json(specificServiceErrorPayload(error));
  }
}

module.exports = {
  ERROR_CODE,
  ERROR_MESSAGE,
  assertSpecificServiceId,
  createSpecificServiceRequiredError,
  requireSpecificServiceScope,
  specificServiceErrorPayload,
};
