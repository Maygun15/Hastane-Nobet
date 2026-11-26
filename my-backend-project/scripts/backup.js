#!/usr/bin/env node
// scripts/backup.js — MongoDB yedeği (tek dosya, gzip arşiv) + manifest (koleksiyon sayısı, _id özeti, dizinler).
// Kullanım:  node scripts/backup.js --target=local|staging|production
//   Adres hedefe göre scripts/lib/dbTarget.js'den gelir (.env OKUNMAZ). Yedekten önce veritabanının
//   ortam işareti (ops_meta.environment) hedefle aynı olmalı — yanlış veritabanının yedeği alınmaz.
//   Sonuç kaydı yedekte YAZILMAZ: geri yükleme doğrulaması ve artifact sonrası scripts/recordBackupStatus.js yazar.
// Ortam: BACKUP_DIR (./backups), BACKUP_KEEP_DAYS (7), BACKUP_DB_NAME (hastane — uygulamayla aynı).
// Geri yükleme ve doğrulama: scripts/restore-verify.js — docs/OPERASYON.md
'use strict';
const fs = require('fs');
const path = require('path');
const { runTool, collectionManifest } = require('./backupLib');
const { connectTarget, uriFor } = require('./lib/dbTarget');

async function main() {
  const dbName = process.env.BACKUP_DB_NAME || 'hastane';
  // Kimlik: bağlantı öncesi adres–hedef, sonra ortam işareti. Yedek salt okunur.
  const probe = await connectTarget({ readOnly: true, dbName });
  const { target, host, marker } = probe;
  await probe.conn.close();
  // --first-backup: işaret yazılmadan ÖNCEKİ ilk yedek (üretimde her yazımdan önce). Yalnız işaret hiç
  // yoksa geçerlidir; farklı bir işaret (ör. staging) yine reddedilir. Adres–hedef kontrolü yine yapılır.
  const firstBackup = process.argv.includes('--first-backup') && !marker;
  if (marker !== target && !firstBackup) throw new Error(`veritabanı ortam işareti "${marker || 'yok'}", hedef "${target}" — yedek alınmadı`);
  if (firstBackup) console.log('[yedek] ilk yedek: veritabanında ortam işareti henüz yok (--first-backup); yalnız adres–hedef kontrolüyle');
  const uri = uriFor(target);

  const dir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
  const keepDays = parseInt(process.env.BACKUP_KEEP_DAYS || '7', 10);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archive = path.join(dir, `backup-${target}-${dbName}-${ts}.archive.gz`);
  console.log(`[yedek] başlıyor: ${target} (${host}) veritabanı ${dbName}`);
  // Döküm canlı veritabanından alınır; döküm sürerken yazılan koleksiyonlar (ör. auditlogs) önce/sonra
  // manifestiyle işaretlenir: geri yüklenen sayı iki değer arasında olmalı. Değişmeyenler birebir doğrulanır.
  const pre = await collectionManifest(uri, dbName);
  // Atlas ücretsiz katmanında uzun dökümde bağlantı kopabiliyor (deneme: generatedschedules sırasında);
  // en fazla BACKUP_RETRIES (3) deneme, aralarında bekleme.
  const tries = Math.max(1, Number(process.env.BACKUP_RETRIES || 3));
  for (let i = 1; i <= tries; i += 1) {
    try {
      runTool('mongodump', uri, [`--db=${dbName}`, `--archive=${archive}`, '--gzip']);
      break;
    } catch (e) {
      fs.rmSync(archive, { force: true });
      if (i === tries) throw e;
      console.warn(`[yedek] deneme ${i}/${tries} başarısız: ${String(e.message).slice(-160)} — yeniden denenecek`);
      await new Promise((r) => setTimeout(r, 15000 * i));
    }
  }
  fs.chmodSync(archive, 0o600);
  const post = await collectionManifest(uri, dbName);
  const collections = {};
  for (const name of new Set([...Object.keys(pre), ...Object.keys(post)])) {
    const a = pre[name]; const b = post[name];
    if (a && b && a.idHash === b.idHash && a.count === b.count) collections[name] = b;
    else collections[name] = { ...(b || a), changedDuringDump: true, countRange: [Math.min(a?.count ?? 0, b?.count ?? 0), Math.max(a?.count ?? 0, b?.count ?? 0)] };
  }
  const changed = Object.entries(collections).filter(([, c]) => c.changedDuringDump).map(([n]) => n);
  if (changed.length) console.log(`[yedek] döküm sırasında değişen koleksiyon: ${changed.join(', ')} (aralıkla doğrulanır)`);
  const docs = Object.values(collections).reduce((s, c) => s + c.count, 0);
  const manifest = { createdAt: new Date().toISOString(), target, db: dbName, host, archive: path.basename(archive), bytes: fs.statSync(archive).size, docs, collections };
  fs.writeFileSync(`${archive}.manifest.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(`[yedek] tamam: ${Object.keys(collections).length} koleksiyon, ${docs} belge, ${manifest.bytes} bayt → ${path.basename(archive)}`);

  const cutoff = Date.now() - keepDays * 86400000;
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('backup-')) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < cutoff) { fs.rmSync(p, { recursive: true, force: true }); console.log(`[yedek] eski yedek silindi: ${f}`); }
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `archive=${archive}\nbackup_at=${manifest.createdAt}\nbackup_docs=${docs}\n`);
}

main().catch((e) => { console.error('[yedek] HATA:', e.message); process.exit(1); });
