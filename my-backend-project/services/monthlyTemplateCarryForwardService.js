'use strict';

const MonthlySchedule = require('../models/MonthlySchedule');
const { draftPublication } = require('./schedulePublicationService');

const TEMPLATE_DEF_FIELDS = new Set([
  'id',
  'rowId',
  'label',
  'name',
  'area',
  'shiftId',
  'shiftCode',
  'start',
  'startTime',
  'end',
  'endTime',
  'duration',
  'hours',
  'defaultCount',
  'required',
  'requiredCount',
  'pattern',
  'weekendOff',
  'holidayPolicy',
  'supervisorTask',
]);

const TEMPLATE_SHIFT_OPTION_FIELDS = new Set([
  'id',
  'code',
  'shiftId',
  'shiftCode',
  'label',
  'name',
  'start',
  'startTime',
  'end',
  'endTime',
  'duration',
  'hours',
  'isNight',
]);

function previousYearMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function copyWhitelistedObject(source, allowedFields) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!allowedFields.has(key)) continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out[key] = value.filter((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item));
      continue;
    }
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = value;
    }
  }
  return out;
}

function sanitizeTemplateDefs(defs = []) {
  return (Array.isArray(defs) ? defs : [])
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => copyWhitelistedObject(item, TEMPLATE_DEF_FIELDS))
    .filter((item) => Object.keys(item).length > 0);
}

function sanitizeShiftOptions(shiftOptions = []) {
  return (Array.isArray(shiftOptions) ? shiftOptions : [])
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => copyWhitelistedObject(item, TEMPLATE_SHIFT_OPTION_FIELDS))
    .filter((item) => Object.keys(item).length > 0);
}

function getScheduleDefs(doc) {
  if (Array.isArray(doc?.data?.defs) && doc.data.defs.length > 0) return doc.data.defs;
  if (Array.isArray(doc?.data?.rows)) return doc.data.rows;
  return Array.isArray(doc?.data?.defs) ? doc.data.defs : [];
}

const LOOKBACK_MONTHS = 12;

function monthsBack(year, month, count) {
  let y = year;
  let m = month;
  for (let i = 0; i < count; i += 1) ({ year: y, month: m } = previousYearMonth(y, m));
  return { year: y, month: m };
}

async function findLatestTemplateSource({ hospitalId, sectionId, serviceId, role, year, month }) {
  const oldest = monthsBack(year, month, LOOKBACK_MONTHS);
  const hasTemplate = {
    $or: [{ 'data.defs.0': { $exists: true } }, { 'data.rows.0': { $exists: true } }],
  };
  const before = {
    $or: [{ year: { $lt: year } }, { year, month: { $lt: month } }],
  };
  const notOlder = {
    $or: [{ year: { $gt: oldest.year } }, { year: oldest.year, month: { $gte: oldest.month } }],
  };
  return MonthlySchedule.findOne({
    hospitalId,
    sectionId,
    serviceId,
    role,
    $and: [hasTemplate, before, notOlder],
  })
    .sort({ year: -1, month: -1 })
    .lean();
}

function createPreviousTemplateNotFoundError() {
  const error = new Error('Önceki ay için taşınabilecek çizelge şablonu bulunamadı.');
  error.code = 'PREVIOUS_TEMPLATE_NOT_FOUND';
  error.status = 404;
  return error;
}

async function carryForwardMonthlyTemplate({
  hospitalId,
  sectionId,
  serviceId,
  role,
  year,
  month,
  userId = null,
}) {
  const exactScope = { hospitalId, sectionId, serviceId, role, year, month };
  const target = await MonthlySchedule.findOne(exactScope).lean();
  const targetDefs = getScheduleDefs(target);

  if (targetDefs.length > 0) {
    return {
      carried: false,
      reason: 'TARGET_ALREADY_HAS_TEMPLATE',
      defsCount: targetDefs.length,
      scheduleId: String(target._id),
    };
  }

  // Şablonu olan EN SON önceki ayı bul (en fazla LOOKBACK_MONTHS geriye).
  // Yalnızca bir önceki aya bakmak, arada boş ay varsa (ör. Kasım boş,
  // son dolu ay Temmuz) Aralık'ın şablonsuz açılmasına yol açıyordu.
  const previous = await findLatestTemplateSource({
    hospitalId, sectionId, serviceId, role, year, month,
  });
  const defs = sanitizeTemplateDefs(getScheduleDefs(previous));
  if (!defs.length) throw createPreviousTemplateNotFoundError();
  const from = { year: previous.year, month: previous.month };

  const shiftOptions = sanitizeShiftOptions(previous?.data?.shiftOptions);
  const templateData = {
    defs,
    ...(shiftOptions.length ? { shiftOptions } : {}),
  };
  const now = new Date();

  let saved;
  if (target) {
    saved = await MonthlySchedule.findOneAndUpdate(
      {
        ...exactScope,
        $or: [
          { 'data.defs': { $exists: false } },
          { 'data.defs': null },
          { 'data.defs': { $size: 0 } },
        ],
      },
      {
        $set: {
          'data.defs': defs,
          ...(shiftOptions.length ? { 'data.shiftOptions': shiftOptions } : {}),
          'meta.templateCarryForward': {
            from,
            copiedAt: now,
            copiedBy: userId,
          },
          updatedBy: userId,
        },
      },
      { new: true }
    ).lean();
  } else {
    saved = await MonthlySchedule.findOneAndUpdate(
      exactScope,
      {
        $setOnInsert: {
          ...exactScope,
          data: templateData,
          publication: draftPublication(userId, 'carryForward'),
          meta: {
            templateCarryForward: {
              from,
              copiedAt: now,
              copiedBy: userId,
            },
          },
          createdBy: userId,
          updatedBy: userId,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  }

  if (!saved) {
    const concurrentTarget = await MonthlySchedule.findOne(exactScope).lean();
    const concurrentDefs = getScheduleDefs(concurrentTarget);
    if (concurrentDefs.length > 0) {
      return {
        carried: false,
        reason: 'TARGET_ALREADY_HAS_TEMPLATE',
        defsCount: concurrentDefs.length,
        scheduleId: String(concurrentTarget._id),
      };
    }
    throw new Error('Çizelge şablonu hedef aya kaydedilemedi.');
  }

  return {
    carried: true,
    from,
    to: { year, month },
    defsCount: defs.length,
    assignmentsCopied: 0,
    scheduleId: String(saved._id),
  };
}

module.exports = {
  carryForwardMonthlyTemplate,
  createPreviousTemplateNotFoundError,
  findLatestTemplateSource,
  LOOKBACK_MONTHS,
  previousYearMonth,
  sanitizeShiftOptions,
  sanitizeTemplateDefs,
};
