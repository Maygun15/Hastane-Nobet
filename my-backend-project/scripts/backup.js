#!/usr/bin/env node
// scripts/backup.js — Otomatik MongoDB yedekleme
// Kullanım: node scripts/backup.js
// Cron örneği: 0 3 * * * cd /app && node scripts/backup.js >> /var/log/backup.log 2>&1
//
// Gerektirilen: mongodump PATH'te olmalı (MongoDB Tools paketi)
// Ortam değişkenleri: MONGODB_URI, BACKUP_DIR (varsayılan: ./backups), BACKUP_KEEP_DAYS (varsayılan: 7)

'use strict';
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI    = process.env.MONGODB_URI;
const BACKUP_DIR     = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
const KEEP_DAYS      = parseInt(process.env.BACKUP_KEEP_DAYS || '7', 10);
const DB_NAME        = process.env.BACKUP_DB_NAME || 'hastane';

if (!MONGODB_URI) {
  console.error('[backup] MONGODB_URI tanımlı değil. .env dosyasını kontrol edin.');
  process.exit(1);
}

// mongodump mevcut mu?
const dumpCheck = spawnSync('mongodump', ['--version'], { stdio: 'pipe' });
if (dumpCheck.status !== 0 && dumpCheck.error) {
  console.error('[backup] mongodump bulunamadı. MongoDB Database Tools kurulu olmalı.');
  process.exit(1);
}

// Yedek klasörü oluştur
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Zaman damgalı klasör adı
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(BACKUP_DIR, `backup-${ts}`);

console.log(`[backup] Başlatılıyor: ${ts}`);
console.log(`[backup] Hedef: ${outDir}`);

try {
  execSync(
    `mongodump --uri="${MONGODB_URI}" --db="${DB_NAME}" --out="${outDir}"`,
    { stdio: 'inherit', timeout: 5 * 60 * 1000 }
  );
  console.log('[backup] Yedekleme tamamlandı.');
} catch (err) {
  console.error('[backup] mongodump hatası:', err?.message || err);
  process.exit(1);
}

// Eski yedekleri temizle (KEEP_DAYS'den eski)
const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
let removed = 0;
try {
  const entries = fs.readdirSync(BACKUP_DIR);
  for (const entry of entries) {
    if (!entry.startsWith('backup-')) continue;
    const fullPath = path.join(BACKUP_DIR, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() && stat.mtimeMs < cutoff) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      removed++;
      console.log(`[backup] Eski yedek silindi: ${entry}`);
    }
  }
} catch (e) {
  console.warn('[backup] Temizlik hatası:', e?.message || e);
}

// Mevcut yedek listesi
const remaining = fs.readdirSync(BACKUP_DIR).filter((e) => e.startsWith('backup-'));
console.log(`[backup] Tamamlandı. Mevcut yedekler: ${remaining.length}, Silinen: ${removed}`);
console.log(`[backup] Sonuç: ${outDir}`);
