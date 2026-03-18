#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');
const MonthlySchedule = require('../models/MonthlySchedule');
const Person = require('../models/Person');

function parseArgs(argv) {
  const out = {
    sectionId: 'calisma-cizelgesi',
    serviceId: null,
    role: null,
    year: null,
    month: null,
    write: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') out.write = true;
    else if (arg === '--sectionId') out.sectionId = String(argv[++i] || out.sectionId).trim();
    else if (arg === '--serviceId') out.serviceId = String(argv[++i] || '').trim();
    else if (arg === '--role') out.role = String(argv[++i] || '').trim();
    else if (arg === '--year') out.year = Number(argv[++i]);
    else if (arg === '--month') out.month = Number(argv[++i]);
  }
  return out;
}

function normalizeScopeValue(value) {
  return String(value == null ? '' : value).trim();
}

function stripDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ş/g, 'S').replace(/İ/g, 'I')
    .replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ç/g, 'c');
}

function canonName(value) {
  return stripDiacritics(String(value || '').trim().toLocaleUpperCase('tr-TR'))
    .replace(/\s+/g, ' ')
    .trim();
}

function isGroupLabel(value) {
  return /^(hemşire(ler)?|hemsire(ler)?|doktor(lar)?|personel|nurses?|doctors?)$/i
    .test(String(value || '').trim());
}

function getPersonName(entry) {
  return (
    entry?.name ||
    entry?.fullName ||
    [entry?.firstName, entry?.lastName].filter(Boolean).join(' ').trim() ||
    entry?.meta?.fullName ||
    ''
  );
}

function buildPersonNameSet(people = []) {
  const out = new Set();
  for (const person of people || []) {
    const canon = canonName(getPersonName(person));
    if (canon) out.add(canon);
  }
  return out;
}

function cleanNamedAssignments(namedAssignments = {}, validNames) {
  const cleaned = {};
  let removed = 0;
  for (const [dayKey, byRow] of Object.entries(namedAssignments || {})) {
    if (!byRow || typeof byRow !== 'object') continue;
    const nextRows = {};
    for (const [rowId, names] of Object.entries(byRow || {})) {
      if (!Array.isArray(names)) continue;
      const kept = [];
      for (const raw of names) {
        const name = String(raw || '').trim();
        const canon = canonName(name);
        if (!canon || isGroupLabel(name) || !validNames.has(canon)) {
          removed += 1;
          continue;
        }
        if (!kept.includes(name)) kept.push(name);
      }
      if (kept.length) nextRows[rowId] = kept;
    }
    if (Object.keys(nextRows).length) cleaned[dayKey] = nextRows;
  }
  return { cleaned, removed };
}

function cleanAssignments(assignments = [], validNames) {
  const cleaned = [];
  let removed = 0;
  for (const item of assignments || []) {
    const rawName = item?.personName || item?.name || '';
    const name = String(rawName || '').trim();
    const canon = canonName(name);
    if (!canon || isGroupLabel(name) || !validNames.has(canon)) {
      removed += 1;
      continue;
    }
    cleaned.push(item);
  }
  return { cleaned, removed };
}

async function findPeopleForSchedule(doc) {
  const filter = {};
  if (doc?.hospitalId) filter.hospitalId = doc.hospitalId;
  const serviceId = normalizeScopeValue(doc?.serviceId);
  if (serviceId) filter.serviceId = serviceId;
  return Person.find(filter).lean();
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI missing in environment');

  const connectOpts = {};
  if (process.env.MONGODB_DB) connectOpts.dbName = process.env.MONGODB_DB;
  await mongoose.connect(mongoUri, connectOpts);

  const query = { sectionId: args.sectionId };
  if (Number.isFinite(args.year)) query.year = args.year;
  if (Number.isFinite(args.month)) query.month = args.month;
  if (args.serviceId !== null) query.serviceId = args.serviceId;
  if (args.role !== null) query.role = args.role;

  const docs = await MonthlySchedule.find(query).lean();
  console.log(`[repair-invalid-names] matched docs: ${docs.length}`);

  let changedDocs = 0;
  let removedNamedTotal = 0;
  let removedAssignmentsTotal = 0;

  for (const doc of docs) {
    const data = doc?.data && typeof doc.data === 'object' ? { ...doc.data } : {};
    const roster = data?.roster && typeof data.roster === 'object' ? { ...data.roster } : null;
    const namedAssignments = roster?.namedAssignments && typeof roster.namedAssignments === 'object'
      ? roster.namedAssignments
      : null;
    const assignments = Array.isArray(data?.assignments) ? data.assignments : null;
    if (!namedAssignments && !assignments) continue;

    const people = await findPeopleForSchedule(doc);
    const validNames = buildPersonNameSet(people);
    if (!validNames.size) {
      console.log(`[repair-invalid-names] skip ${doc._id}: no people found for scope`);
      continue;
    }

    const namedRes = namedAssignments
      ? cleanNamedAssignments(namedAssignments, validNames)
      : { cleaned: namedAssignments, removed: 0 };
    const assignRes = assignments
      ? cleanAssignments(assignments, validNames)
      : { cleaned: assignments, removed: 0 };

    if (!namedRes.removed && !assignRes.removed) continue;

    console.log(
      `[repair-invalid-names] ${doc._id} service=${doc.serviceId || '(all)'} role=${doc.role || '(all)'} namedRemoved=${namedRes.removed} assignmentRemoved=${assignRes.removed}`
    );

    if (args.write) {
      const update = {};
      if (namedAssignments) update['data.roster.namedAssignments'] = namedRes.cleaned;
      if (assignments) update['data.assignments'] = assignRes.cleaned;
      await MonthlySchedule.updateOne({ _id: doc._id }, { $set: update });
    }

    changedDocs += 1;
    removedNamedTotal += namedRes.removed;
    removedAssignmentsTotal += assignRes.removed;
  }

  console.log(
    `[repair-invalid-names] changed docs: ${changedDocs} removed named=${removedNamedTotal} removed assignments=${removedAssignmentsTotal}${args.write ? '' : ' (dry-run)'}`
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[repair-invalid-names] failed:', err.message || err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
