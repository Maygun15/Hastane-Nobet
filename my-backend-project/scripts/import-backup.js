#!/usr/bin/env node
// scripts/import-backup.js
// Usage: node scripts/import-backup.js /path/to/backup.json

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Setting = require('../models/Setting');
const Person = require('../models/Person');

const filePath = process.argv[2];
if (!filePath) {
  console.log('Kullanım: node scripts/import-backup.js /path/to/backup.json');
  process.exit(1);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function cleanStr(v) {
  return (v ?? '').toString().trim();
}

function normalizeRole(raw, hint) {
  const s = cleanStr(raw).toUpperCase();
  if (!s && hint) return hint;
  if (s.includes('DOKTOR') || s.includes('DOCTOR')) return 'Doctor';
  if (s.includes('HEMŞ') || s.includes('HEMS') || s.includes('NURSE')) return 'Nurse';
  return hint || (s ? raw : '');
}

function arrFromAny(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

function mapPerson(p, roleHint) {
  if (!p) return null;
  const name = cleanStr(p.name || p.fullName || p['AD SOYAD'] || p.displayName);
  if (!name) return null;

  const serviceId =
    cleanStr(p.serviceId || p.service || p.department || p.unit || p.sectionId || p.departmentId) ||
    'default';

  const role = normalizeRole(p.role || p.title || p.unvan, roleHint) || roleHint || '';
  const title = cleanStr(p.title || p.unvan || '');
  const tc = cleanStr(p.tc || p.tckn || p.tcNo);
  const phone = cleanStr(p.phone || p.telefon);
  const email = cleanStr(p.email || p.mail);

  const areas = arrFromAny(p.areas || p.workAreas || p['ÇALIŞMA ALANLARI']);
  const shiftCodes = arrFromAny(p.shiftCodes || p.codes || p.shifts || p['VARDİYE KODLARI']);
  const workAreaIds = arrFromAny(p.workAreaIds || p.areaIds || p.meta?.workAreaIds);

  return {
    name,
    serviceId,
    role,
    title,
    tc,
    phone,
    email,
    meta: {
      role,
      title,
      areas,
      shiftCodes,
      workAreaIds,
    },
  };
}

async function upsertSetting(key, value) {
  if (value === undefined) return;
  await Setting.findOneAndUpdate(
    { key, serviceId: '' },
    { $set: { key, serviceId: '', value } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function upsertPerson(p) {
  const query = {};
  if (p.tc) query.tc = p.tc;
  else if (p.email) query.email = p.email.toLowerCase();
  else query.name = p.name;

  const update = {
    name: p.name,
    serviceId: p.serviceId,
    meta: p.meta,
    tc: p.tc || undefined,
    phone: p.phone || undefined,
    email: p.email ? p.email.toLowerCase() : undefined,
  };

  await Person.findOneAndUpdate(query, { $set: update }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function main() {
  const payload = readJson(filePath);
  const items = payload?.items || payload || {};

  const settingsKeys = [
    'workAreas',
    'workAreasV2',
    'workingHours',
    'workingHoursV2',
    'leaveTypes',
    'leaveTypesV2',
    'izinTurleri',
    'requestBoxV1',
    'requestBox',
    'personLeaves',
    'personLeavesV2',
    'allLeaves',
    'dutyRules',
    'dutyRulesV2',
    'scheduleRowsV2',
    'scheduleTemplateRows',
  ];

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI bulunamadı (.env)');
    process.exit(1);
  }
  await mongoose.connect(uri);

  // Settings
  for (const key of settingsKeys) {
    if (key in items) {
      await upsertSetting(key, items[key]);
      console.log(`✅ Setting yazıldı: ${key}`);
    }
  }

  // People
  const people = [];
  const nurses = Array.isArray(items.nurses) ? items.nurses : [];
  const doctors = Array.isArray(items.doctors) ? items.doctors : [];
  if (nurses.length) people.push(...nurses.map((p) => mapPerson(p, 'Nurse')).filter(Boolean));
  if (doctors.length) people.push(...doctors.map((p) => mapPerson(p, 'Doctor')).filter(Boolean));

  // Fallback: peopleAll varsa
  if (!people.length && Array.isArray(items.peopleAll)) {
    people.push(...items.peopleAll.map((p) => mapPerson(p, p.role)).filter(Boolean));
  }

  // Dedupe by tc/email/name+serviceId
  const deduped = [];
  const seen = new Set();
  for (const p of people) {
    const key = p.tc || p.email || `${p.name}|${p.serviceId}|${p.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  for (const p of deduped) {
    await upsertPerson(p);
  }
  console.log(`✅ Personel yazıldı: ${deduped.length}`);

  await mongoose.disconnect();
  console.log('✅ Import tamamlandı.');
}

main().catch((err) => {
  console.error('Import hatası:', err);
  process.exit(1);
});
