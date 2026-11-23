#!/usr/bin/env node
// Otomatik yedek çalıştırmasının sonucunu kaynak veritabanına yazar (ops_meta.backupStatus).
//   lastAttempt : her çalıştırma (başarılı/başarısız, ilk geçmeyen adım)
//   lastSuccess : yalnız TÜM adımlar geçtiyse (yedek, şifre, geri yükleme, okuma, artifact yükleme ve geri indirme)
// Kullanım: node scripts/recordBackupStatus.js --target=staging --steps=secrets:success,dump:success,…
//            [--backup-at=ISO] [--backup-docs=N] [--restored-docs=N] [--restored-collections=N]
//            [--restored-indexes=N] [--artifact-id=ID] [--run-url=URL]
// Veritabanına yazılamazsa nedeni açıkça yazılır, GITHUB_OUTPUT'a written=false düşülür ve çıkış kodu 1 olur.
'use strict';
const fs = require('fs');
const { connectTarget } = require('./lib/dbTarget');
const { summarizeSteps, buildStatusUpdate } = require('./lib/backupResult');
const { redactText } = require("../utils/safeLog");

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const out = (line) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`); };
const runner = process.env.GITHUB_RUN_ID ? `github:${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT || 1}` : 'elle';

const summary = summarizeSteps(arg('steps'));
console.log(`[durum] çalıştırma ${runner}: ${summary.ok ? 'tüm adımlar geçti' : `geçmeyen adım: ${summary.failedLabel}`}`);
const set = buildStatusUpdate({
  summary, runner, runUrl: arg('run-url') || null,
  info: { backupAt: arg('backup-at'), backupDocs: arg('backup-docs'), restoredDocs: arg('restored-docs'), restoredCollections: arg('restored-collections'), restoredIndexes: arg('restored-indexes'), artifactId: arg('artifact-id') },
});

connectTarget().then(async ({ conn, db, target }) => {
  await db.collection('ops_meta').updateOne({ _id: 'backupStatus' }, { $set: set }, { upsert: true });
  console.log(`[durum] ${target}: son deneme ${summary.ok ? 'BAŞARILI' : 'BAŞARISIZ'} kaydedildi${summary.ok ? '; son başarılı yedek güncellendi' : '; son başarılı yedek değişmedi'}`);
  out('written=true');
  await conn.close();
}).catch((e) => {
  // dbTarget hata mesajları adres içermez (maskeli).
  console.error(`::error title=KAYIT_YAZILAMADI::Sonuç veritabanına yazılamadı: ${redactText(String(e.message))}`);
  out('written=false');
  process.exit(1);
});
