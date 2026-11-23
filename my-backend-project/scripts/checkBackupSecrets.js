#!/usr/bin/env node
// Otomatik yedek ön kontrolü: gizli değerler var mı / biçimi uygun mu. Değerler yazdırılmaz.
'use strict';
const { checkSecrets } = require('./lib/backupResult');

const r = checkSecrets(process.env);
if (r.ok) {
  console.log('[ön kontrol] STAGING_MONGODB_URI: tanımlı, biçim uygun');
  console.log('[ön kontrol] BACKUP_PASSPHRASE: tanımlı, uzunluk yeterli');
  process.exit(0);
}
for (const e of r.errors) console.log(`::error title=${e.code}::${e.message}`);
process.exit(1);
