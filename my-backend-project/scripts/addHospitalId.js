#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Hospital = require('../models/Hospital');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'hastane';
const DEFAULT_HOSPITAL_NAME = process.env.DEFAULT_HOSPITAL_NAME || 'Default Hospital';
const DEFAULT_HOSPITAL_SLUG = process.env.DEFAULT_HOSPITAL_SLUG || 'default-hospital';
const DEFAULT_HOSPITAL_EMAIL = process.env.DEFAULT_HOSPITAL_EMAIL || '';

async function ensureDefaultHospital() {
  let hospital = await Hospital.findOne({ slug: DEFAULT_HOSPITAL_SLUG }).lean();
  if (hospital) return hospital;

  hospital = await Hospital.create({
    name: DEFAULT_HOSPITAL_NAME,
    slug: DEFAULT_HOSPITAL_SLUG,
    contactEmail: DEFAULT_HOSPITAL_EMAIL,
    active: true,
  });
  return hospital.toObject();
}

async function backfillCollection(collectionName, hospitalId) {
  const collection = mongoose.connection.collection(collectionName);
  const filterMissing = { $or: [{ hospitalId: { $exists: false } }, { hospitalId: null }] };
  const toBackfill = await collection
    .find(filterMissing, { projection: { _id: 1 }, limit: 100000 })
    .toArray();

  if (!toBackfill.length) {
    console.log(`[addHospitalId] ${collectionName}: already up-to-date`);
    return 0;
  }

  const ops = toBackfill.map((row) => ({
    updateOne: {
      filter: { _id: row._id },
      update: { $set: { hospitalId } },
    },
  }));

  const result = await collection.bulkWrite(ops, { ordered: false });
  const modified = Number(result.modifiedCount || 0);
  console.log(`[addHospitalId] ${collectionName}: backfilled ${modified}`);
  return modified;
}

async function main() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI tanımlı değil');
  }

  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  console.log('[addHospitalId] Mongo connected');

  const hospital = await ensureDefaultHospital();
  const hospitalId = hospital._id;
  console.log('[addHospitalId] default hospital:', hospital.slug, String(hospitalId));

  const candidates = [
    'people',
    'schedules',
    'leaves',
    'users',
    'services',
    'monthlyschedules',
    'generatedschedules',
  ];

  const existing = new Set(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray().then((x) => x.map((i) => i.name)));
  const targets = candidates.filter((name) => existing.has(name));

  if (!targets.length) {
    console.log('[addHospitalId] No target collections found');
    return;
  }

  let total = 0;
  for (const name of targets) {
    total += await backfillCollection(name, hospitalId);
  }

  console.log(`[addHospitalId] done. modified: ${total}`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[addHospitalId] error:', err?.message || err);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  });
