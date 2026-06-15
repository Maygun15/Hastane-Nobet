#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * backfillAssignments.js
 *
 * MonthlySchedule ve GeneratedSchedule koleksiyonlarından Assignment koleksiyonunu
 * geriye dönük olarak doldurur. Mevcut aylar için SSOT read path geçişini
 * desteklemek amacıyla çalıştırılır.
 *
 * Kullanım:
 *   node scripts/backfillAssignments.js [--dry-run] [--year 2026] [--month 5] [--serviceId abc]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const MonthlySchedule = require('../models/MonthlySchedule');
const GeneratedSchedule = require('../models/GeneratedSchedule');
const { replaceAssignmentsForSchedule } = require('../services/assignmentSyncService');

function parseArgs(argv) {
  const out = { dryRun: false, year: null, month: null, serviceId: null, sectionId: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--year') out.year = Number(argv[++i]);
    else if (argv[i] === '--month') out.month = Number(argv[++i]);
    else if (argv[i] === '--serviceId') out.serviceId = String(argv[++i]).trim();
    else if (argv[i] === '--sectionId') out.sectionId = String(argv[++i]).trim();
  }
  return out;
}

async function run() {
  const args = parseArgs(process.argv);
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('MongoDB bağlantısı kuruldu.');

  const query = {};
  if (args.year) query.year = args.year;
  if (args.month) query.month = args.month;
  if (args.serviceId) query.serviceId = args.serviceId;
  if (args.sectionId) query.sectionId = args.sectionId;

  const monthlyDocs = await MonthlySchedule.find(query).lean();
  console.log(`${monthlyDocs.length} MonthlySchedule belgesi bulundu.`);

  let total = 0;
  let errors = 0;

  for (const doc of monthlyDocs) {
    const scope = {
      sectionId: doc.sectionId,
      serviceId: doc.serviceId || '',
      role: doc.role || '',
      year: doc.year,
      month: doc.month,
      sourceScheduleId: doc._id,
    };
    const payload = doc.data || {};
    if (args.dryRun) {
      console.log(`[DRY-RUN] ${scope.sectionId}/${scope.serviceId}/${scope.role} ${scope.year}-${scope.month}`);
      continue;
    }
    try {
      const result = await replaceAssignmentsForSchedule({
        scope, payload, source: 'backfill-monthly', mode: 'legacy-script',
      });
      total += result.count;
      console.log(`  ✓ ${scope.sectionId}/${scope.serviceId}/${scope.role} ${scope.year}-${scope.month}: ${result.count} atama`);
    } catch (err) {
      errors++;
      console.error(`  ✗ HATA ${scope.year}-${scope.month}:`, err.message);
    }
  }

  // GeneratedSchedule'dan da backfill yap (MonthlySchedule'da assignments yoksa)
  const Assignment = require('../models/Assignment');
  const generatedDocs = await GeneratedSchedule.find(query).lean();
  console.log(`\n${generatedDocs.length} GeneratedSchedule belgesi bulundu.`);

  for (const doc of generatedDocs) {
    const scope = {
      sectionId: doc.sectionId,
      serviceId: doc.serviceId || '',
      role: doc.role || '',
      year: doc.year,
      month: doc.month,
      sourceScheduleId: doc._id,
    };
    // Zaten monthly'den doldurulduysa atla
    const existing = await Assignment.countDocuments({
      sectionId: scope.sectionId, serviceId: scope.serviceId,
      role: scope.role, year: scope.year, month: scope.month,
    });
    if (existing > 0) {
      console.log(`  — ${scope.sectionId}/${scope.serviceId}/${scope.role} ${scope.year}-${scope.month}: ${existing} kayıt mevcut, atlanıyor`);
      continue;
    }
    if (args.dryRun) {
      console.log(`[DRY-RUN] Generated ${scope.sectionId}/${scope.serviceId} ${scope.year}-${scope.month}`);
      continue;
    }
    try {
      const payload = doc.data || {};
      const result = await replaceAssignmentsForSchedule({
        scope, payload, source: 'backfill-generated', mode: 'legacy-script',
      });
      total += result.count;
      console.log(`  ✓ Generated ${scope.year}-${scope.month}: ${result.count} atama`);
    } catch (err) {
      errors++;
      console.error(`  ✗ HATA Generated ${scope.year}-${scope.month}:`, err.message);
    }
  }

  console.log(`\nToplam: ${total} atama yazıldı, ${errors} hata.`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
