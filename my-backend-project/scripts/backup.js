#!/usr/bin/env node
// scripts/backup.js — MongoDB yedeği (tek dosya, gzip arşiv) + doğrulama bildirimi (manifest).
// Kullanım:  MONGODB_URI=... BACKUP_DIR=/guvenli/yol node scripts/backup.js
// Ortam: MONGODB_URI (zorunlu, .env OKUNMAZ — yanlışlıkla üretime bağlanmasın), BACKUP_DIR
//        (varsayılan ./backups), BACKUP_KEEP_DAYS (7), BACKUP_DB_NAME (varsayılan hastane — uygulamayla aynı).
//        Üretim kümesi için BACKUP_ALLOW_PROD=1 açıkça verilmelidir.
// Geri yükleme ve doğrulama: scripts/restore-verify.js — docs/OPERASYON.md
'use strict';
const fs = require('fs');
const path = require('path');
const { assertAllowed, runTool, collectionManifest, hostOf } = require('./backupLib');

async function main() {
  const uri = process.env.MONGODB_URI;
  assertAllowed(uri, { label: 'yedek', allowProdEnv: 'BACKUP_ALLOW_PROD' });
  // Uygulama her zaman 'hastane' veritabanını kullanır (index.js dbName); adresteki ad dikkate alınmaz.
  const dbName = process.env.BACKUP_DB_NAME || 'hastane';
  const dir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
  const keepDays = parseInt(process.env.BACKUP_KEEP_DAYS || '7', 10);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archive = path.join(dir, `backup-${dbName}-${ts}.archive.gz`);
  console.log(`[yedek] başlıyor: veritabanı ${dbName}`);
  runTool('mongodump', uri, [`--db=${dbName}`, `--archive=${archive}`, '--gzip']);
  fs.chmodSync(archive, 0o600);
  const collections = await collectionManifest(uri, dbName);
  const manifest = { createdAt: new Date().toISOString(), db: dbName, host: hostOf(uri).replace(/^[^.]*/, '<küme>'), archive: path.basename(archive), bytes: fs.statSync(archive).size, collections };
  fs.writeFileSync(`${archive}.manifest.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  const total = Object.values(collections).reduce((s, c) => s + c.count, 0);
  console.log(`[yedek] tamam: ${Object.keys(collections).length} koleksiyon, ${total} belge, ${manifest.bytes} bayt → ${archive}`);

  const cutoff = Date.now() - keepDays * 86400000;
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('backup-')) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < cutoff) { fs.rmSync(p, { recursive: true, force: true }); console.log(`[yedek] eski yedek silindi: ${f}`); }
  }
}

main().catch((e) => { console.error('[yedek] HATA:', e.message); process.exit(1); });
