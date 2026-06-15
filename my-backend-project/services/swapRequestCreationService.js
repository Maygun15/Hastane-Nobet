'use strict';

const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');

const SELECTION_REQUIRED_CODE = 'SWAP_ASSIGNMENT_SELECTION_REQUIRED';
const SELECTION_REQUIRED_MESSAGE = 'Both swap shifts must be selected from verified assignments.';
const INVALID_SCOPE_CODE = 'INVALID_SWAP_ASSIGNMENT_SCOPE';
const INVALID_SCOPE_MESSAGE = 'Selected swap assignments do not belong to the same schedule scope.';

function createSwapCreationError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  error.statusCode = 400;
  return error;
}

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeScopeValue(value) {
  return normalize(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isSpecificScopeValue(value, invalidValues) {
  return !invalidValues.has(normalizeScopeValue(value));
}

function normalizeDate(value) {
  const raw = normalize(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    return '';
  }
  return raw;
}

function assignmentShiftId(assignment) {
  return normalize(assignment?.shiftId || assignment?.shiftCode || assignment?.rowId);
}

function assignmentLabel(assignment) {
  return normalize(
    assignment?.roleLabel
      || assignment?.shiftCode
      || assignment?.shiftId
      || assignment?.rowId
  );
}

function sameValue(left, right) {
  return normalize(left) === normalize(right);
}

function invalidScope() {
  return createSwapCreationError(INVALID_SCOPE_CODE, INVALID_SCOPE_MESSAGE);
}

async function verifySwapCreationAssignments({
  hospitalId,
  requesterPersonId,
  swapWithPersonId,
  swapMyAssignmentId,
  swapTargetAssignmentId,
  swapMyDate,
  swapTargetDate,
  swapMyShiftId,
  swapTargetShiftId,
} = {}) {
  if (!swapMyAssignmentId || !swapTargetAssignmentId) {
    throw createSwapCreationError(SELECTION_REQUIRED_CODE, SELECTION_REQUIRED_MESSAGE);
  }

  if (
    !mongoose.isValidObjectId(swapMyAssignmentId)
    || !mongoose.isValidObjectId(swapTargetAssignmentId)
  ) {
    throw invalidScope();
  }

  const projection = [
    '_id',
    'sourceScheduleId',
    'sectionId',
    'serviceId',
    'role',
    'year',
    'month',
    'date',
    'rowId',
    'shiftId',
    'shiftCode',
    'roleLabel',
    'personId',
    'personName',
  ].join(' ');

  const [source, target] = await Promise.all([
    Assignment.findOne({ _id: swapMyAssignmentId, hospitalId }).select(projection).lean(),
    Assignment.findOne({ _id: swapTargetAssignmentId, hospitalId }).select(projection).lean(),
  ]);

  if (!source || !target) throw invalidScope();

  const sourceDate = normalizeDate(source.date);
  const targetDate = normalizeDate(target.date);
  const requestedSourceDate = normalizeDate(swapMyDate);
  const requestedTargetDate = normalizeDate(swapTargetDate);
  const sourceShiftId = assignmentShiftId(source);
  const targetShiftId = assignmentShiftId(target);
  const invalidServices = new Set(['', 'all', 'all services', 'tumu', 'tum servisler']);
  const invalidRoles = new Set(['', 'all', 'all roles', 'tumu', 'tum roller']);

  const hasCompleteScope = (
    Boolean(normalize(source.sectionId))
    && Boolean(normalize(target.sectionId))
    && isSpecificScopeValue(source.serviceId, invalidServices)
    && isSpecificScopeValue(target.serviceId, invalidServices)
    && isSpecificScopeValue(source.role, invalidRoles)
    && isSpecificScopeValue(target.role, invalidRoles)
  );

  const sameScope = (
    sameValue(source.sectionId, target.sectionId)
    && sameValue(source.serviceId, target.serviceId)
    && sameValue(source.role, target.role)
    && Number(source.year) === Number(target.year)
    && Number(source.month) === Number(target.month)
  );

  const datesMatch = (
    sourceDate
    && targetDate
    && requestedSourceDate === sourceDate
    && requestedTargetDate === targetDate
    && Number(source.year) === Number(sourceDate.slice(0, 4))
    && Number(source.month) === Number(sourceDate.slice(5, 7))
    && Number(target.year) === Number(targetDate.slice(0, 4))
    && Number(target.month) === Number(targetDate.slice(5, 7))
  );

  const peopleMatch = (
    sameValue(source.personId, requesterPersonId)
    && sameValue(target.personId, swapWithPersonId)
  );

  const submittedShiftIdsMatch = (
    (!normalize(swapMyShiftId) || sameValue(swapMyShiftId, sourceShiftId))
    && (!normalize(swapTargetShiftId) || sameValue(swapTargetShiftId, targetShiftId))
  );

  if (
    !hospitalId
    || !requesterPersonId
    || !swapWithPersonId
    || !hasCompleteScope
    || !sameScope
    || !datesMatch
    || !peopleMatch
    || !sourceShiftId
    || !targetShiftId
    || !submittedShiftIdsMatch
  ) {
    throw invalidScope();
  }

  return {
    source,
    target,
    requestFields: {
      swapMyAssignmentId: source._id,
      swapTargetAssignmentId: target._id,
      swapWithPersonId: normalize(target.personId),
      swapWithPersonName: normalize(target.personName),
      swapSectionId: normalize(source.sectionId),
      serviceId: normalize(source.serviceId),
      role: normalize(source.role),
      swapMyDate: sourceDate,
      swapMyShiftId: sourceShiftId,
      swapMyShiftLabel: assignmentLabel(source),
      swapTargetDate: targetDate,
      swapTargetShiftId: targetShiftId,
      swapTargetShiftLabel: assignmentLabel(target),
    },
  };
}

module.exports = {
  INVALID_SCOPE_CODE,
  INVALID_SCOPE_MESSAGE,
  SELECTION_REQUIRED_CODE,
  SELECTION_REQUIRED_MESSAGE,
  verifySwapCreationAssignments,
};
