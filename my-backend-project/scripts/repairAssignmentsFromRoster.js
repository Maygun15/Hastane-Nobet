#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');
const MonthlySchedule = require('../models/MonthlySchedule');
const { replaceAssignmentsForSchedule } = require('../services/assignmentSyncService');

function parseArgs(argv) {
  const out = {
    sectionId: 'calisma-cizelgesi',
    serviceId: null,
    role: null,
    year: null,
    month: null,
    dryRun: false,
    force: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--sectionId') out.sectionId = String(argv[++i] || out.sectionId).trim();
    else if (arg === '--serviceId') out.serviceId = String(argv[++i] || '').trim();
    else if (arg === '--role') out.role = String(argv[++i] || '').trim();
    else if (arg === '--year') out.year = Number(argv[++i]);
    else if (arg === '--month') out.month = Number(argv[++i]);
  }
  return out;
}

function buildDefsIndex(defs = []) {
  const byId = new Map();
  const byShift = new Map();
  for (const row of defs || []) {
    const id = String(row?.id || row?.rowId || '').trim();
    const shiftCode = String(row?.shiftCode || row?.code || '').trim();
    if (id) byId.set(id, row);
    if (shiftCode) byShift.set(shiftCode, row);
  }
  return { byId, byShift };
}

function countNamedAssignments(namedAssignments = {}) {
  let total = 0;
  for (const byRow of Object.values(namedAssignments || {})) {
    if (!byRow || typeof byRow !== 'object') continue;
    for (const names of Object.values(byRow || {})) {
      if (Array.isArray(names)) total += names.length;
    }
  }
  return total;
}

function buildAssignmentsFromNamed({ year, month, defs = [], namedAssignments = {} }) {
  const out = [];
  const seen = new Set();
  const defIndex = buildDefsIndex(defs);
  const pad2 = (n) => String(n).padStart(2, '0');

  for (const [dayStr, perRow] of Object.entries(namedAssignments || {})) {
    const day = Number(dayStr);
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    const weekday = new Date(year, month - 1, day).getDay();
    for (const [rowIdRaw, names] of Object.entries(perRow || {})) {
      const rowId = String(rowIdRaw || '').trim();
      const def = defIndex.byId.get(rowId) || defIndex.byShift.get(rowId) || null;
      const shiftId = String(def?.id || def?.rowId || rowId).trim();
      const shiftCode = String(def?.shiftCode || def?.code || rowId).trim();
      const roleLabel = String(def?.label || def?.name || def?.area || rowId).trim();
      for (const personNameRaw of names || []) {
        const personName = String(personNameRaw || '').trim();
        if (!personName) continue;
        const key = `${date}|${shiftId}|${personName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          date,
          day: date,
          weekday,
          shiftId,
          shiftCode,
          roleLabel,
          personName,
        });
      }
    }
  }
  return out;
}

function isMalformedAssignment(item = {}) {
  const shiftCode = String(item?.shiftCode || item?.shiftId || '').trim();
  const roleLabel = String(item?.roleLabel || item?.rowLabel || item?.label || '').trim();
  const hours = Number(item?.hours || 0);
  if (!shiftCode) return true;
  if (/^\d{10,}$/.test(shiftCode)) return true;
  if (!roleLabel) return true;
  if (!(hours > 0)) return true;
  return false;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!Number.isFinite(args.year) || !Number.isFinite(args.month)) {
    throw new Error('Usage: node scripts/repairAssignmentsFromRoster.js --year 2026 --month 3 [--sectionId calisma-cizelgesi] [--serviceId ""] [--role Nurse] [--dry-run] [--force]');
  }
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI missing in environment');

  const connectOpts = {};
  if (process.env.MONGODB_DB) connectOpts.dbName = process.env.MONGODB_DB;
  await mongoose.connect(mongoUri, connectOpts);

  const query = {
    sectionId: args.sectionId,
    year: args.year,
    month: args.month,
  };
  if (args.serviceId !== null) query.serviceId = args.serviceId;
  if (args.role !== null) query.role = args.role;

  const docs = await MonthlySchedule.find(query).lean();
  console.log(`[repair] matched docs: ${docs.length}`);

  let changed = 0;
  for (const doc of docs) {
    const data = doc?.data && typeof doc.data === 'object' ? doc.data : {};
    const defs = Array.isArray(data.defs) ? data.defs : Array.isArray(data.rows) ? data.rows : [];
    const named = data?.roster?.namedAssignments && typeof data.roster.namedAssignments === 'object'
      ? data.roster.namedAssignments
      : null;
    if (!named) continue;

    const assignmentCount = Array.isArray(data.assignments) ? data.assignments.length : 0;
    const malformedCount = Array.isArray(data.assignments)
      ? data.assignments.filter(isMalformedAssignment).length
      : 0;
    const namedCount = countNamedAssignments(named);
    if (!namedCount) continue;

    const looksCorrupted =
      args.force ||
      assignmentCount === 0 ||
      assignmentCount < Math.ceil(namedCount * 0.2) ||
      malformedCount > 0;
    if (!looksCorrupted) continue;

    const rebuilt = buildAssignmentsFromNamed({
      year: doc.year,
      month: doc.month,
      defs,
      namedAssignments: named,
    });
    if (!rebuilt.length) continue;

    console.log(
      `[repair] ${doc._id} ${doc.serviceId || '(all)'} ${doc.role || '(all)'} `
      + `${assignmentCount} -> ${rebuilt.length} (malformed=${malformedCount})`
    );
    if (!args.dryRun) {
      await MonthlySchedule.updateOne({ _id: doc._id }, { $set: { 'data.assignments': rebuilt } });
      await replaceAssignmentsForSchedule({
        scope: {
          sectionId: doc.sectionId,
          serviceId: doc.serviceId || '',
          role: doc.role || '',
          year: doc.year,
          month: doc.month,
          sourceScheduleId: doc._id,
        },
        payload: {
          ...(data || {}),
          defs,
          assignments: rebuilt,
        },
        source: 'repair-monthly',
      });
    }
    changed += 1;
  }

  console.log(`[repair] changed docs: ${changed}${args.dryRun ? ' (dry-run)' : ''}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[repair] failed:', err.message || err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
