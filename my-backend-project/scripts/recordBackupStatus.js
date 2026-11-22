#!/usr/bin/env node
// Geri yükleme doğrulamasının sonucunu kaynak veritabanına yazar (ops_meta.backupStatus).
// Kullanım: node scripts/recordBackupStatus.js --target=staging --restore=ok|fail [--docs=N] [--note=...]
'use strict';
const { connectTarget } = require('./lib/dbTarget');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');

connectTarget().then(async ({ conn, db, target }) => {
  const ok = arg('restore') === 'ok';
  const set = { lastRestoreCheckAt: new Date(), lastRestoreOk: ok, lastRestoreNote: arg('note').slice(0, 200) || null };
  if (arg('docs')) set.lastRestoreDocs = Number(arg('docs'));
  if (arg('backup') === 'fail') { set.lastBackupOk = false; set.lastBackupFailedAt = new Date(); }
  await db.collection('ops_meta').updateOne({ _id: 'backupStatus' }, { $set: set }, { upsert: true });
  console.log(`[durum] ${target}: geri yükleme ${ok ? 'başarılı' : 'BAŞARISIZ'} kaydedildi`);
  await conn.close();
}).catch((e) => { console.error('[durum] HATA:', e.message); process.exit(1); });
