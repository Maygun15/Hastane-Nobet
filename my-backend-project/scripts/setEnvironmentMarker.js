#!/usr/bin/env node
// Veritabanına ortam işareti yazar (ops_meta {_id:'environment'}). Bir kez, hedef doğrulandıktan sonra.
// Kullanım: node scripts/setEnvironmentMarker.js --target=staging
'use strict';
const { connectTarget } = require('./lib/dbTarget');
connectTarget({ initMarker: true })
  .then(async ({ conn, target, host, marker, markerCreated }) => {
    console.log(`[işaret] hedef ${target} (${host}): ${markerCreated ? 'işaret yazıldı' : 'işaret zaten var'} → ${marker}`);
    await conn.close();
  })
  .catch((e) => { console.error('[işaret] HATA:', e.message); process.exit(1); });
