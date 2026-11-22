#!/usr/bin/env node
// Eski (şemada artık olmayan) TEKİL dizinleri bulur. Kurum (hospitalId) içermeyen eski tekil dizin,
// iki kurumun aynı değeri kullanmasını engeller (ör. leave_types.code_1: iki hastane "Y" tanımlayamaz).
// Varsayılan: yalnız rapor. --apply: yalnız İZİN LİSTESİNDEKİ dizinleri siler (aynı alanları kurum
// kapsamında kapsayan güncel tekil dizin varsa). Kullanım: node scripts/staleIndexes.js --target=staging [--apply]
'use strict';
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connectTarget } = require('./lib/dbTarget');

const APPLY = process.argv.includes('--apply');
// Silinmesi onaylı eski dizinler: koleksiyon → dizin adı. Yalnız aynı alan + hospitalId ile tekil
// güncel dizin varsa silinir.
// Deneme ortamında 22 Kas 2026'da bulunan, çok kurumlu yapıdan önceki tekil dizinler.
const DROP_ALLOWLIST = {
  leave_types: ['code_1'],
  request_types: ['code_1'],
  services: ['code_1'],
  settings: ['key_1_serviceId_1'],
  monthlyschedules: ['sectionId_1_serviceId_1_role_1_year_1_month_1'],
  schedulerules: ['sectionId_1_serviceId_1_role_1'],
  dutyrules: ['sectionId_1_serviceId_1_role_1'],
};
// Kurum kapsamlı tekil karşılığı olmayan ama uygulamanın kurum filtresiyle yazdığı koleksiyonlar.
const NO_TWIN_OK = new Set(['dutyrules']);

async function main() {
  const { conn, db, target, host } = await connectTarget({ readOnly: !APPLY });
  // Tüm modellerin şema dizinleri
  const dir = path.join(__dirname, '..', 'models');
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) { try { require(path.join(dir, f)); } catch { /* model değil */ } }
  try { require('../routes/services.routes'); } catch { /* Service modeli rota içinde */ }
  const schemaKeys = new Map();
  for (const name of mongoose.modelNames()) {
    const M = mongoose.model(name);
    const keys = new Set(M.schema.indexes().map(([k]) => JSON.stringify(k)));
    for (const [p, st] of Object.entries(M.schema.paths)) if (st?.options?.unique || st?.options?.index) keys.add(JSON.stringify({ [p]: 1 }));
    schemaKeys.set(M.collection.name, new Set([...(schemaKeys.get(M.collection.name) || []), ...keys]));
  }
  const report = [];
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    const ixs = await db.collection(name).indexes();
    for (const ix of ixs) {
      if (ix.name === '_id_' || !ix.unique) continue;
      const known = schemaKeys.get(name);
      if (known && known.has(JSON.stringify(ix.key))) continue;
      const fields = Object.keys(ix.key);
      const tenantSafe = fields.includes('hospitalId');
      const scopedTwin = ixs.find((o) => o.unique && o.name !== ix.name && o.key.hospitalId && fields.every((f) => f in o.key));
      report.push({ collection: name, index: ix.name, key: ix.key, tenantSafe, inSchema: !!known, scopedTwin: scopedTwin?.name || null,
        droppable: !!(DROP_ALLOWLIST[name] || []).includes(ix.name) && !tenantSafe && (!!scopedTwin || NO_TWIN_OK.has(name)) });
    }
  }
  console.log(`[eski dizin] hedef ${target} (${host}) — ${APPLY ? 'uygula' : 'yalnız rapor'}`);
  if (!report.length) console.log('[eski dizin] şemada olmayan tekil dizin yok');
  for (const r of report) {
    console.log(`  ${r.collection}.${r.index} ${JSON.stringify(r.key)} — ${r.tenantSafe ? 'kurum kapsamlı' : 'KURUM KAPSAMSIZ (kurumlar arası çakışma)'}${r.scopedTwin ? `; güncel karşılığı: ${r.scopedTwin}` : ''}${r.droppable ? ' → silinebilir (izin listesinde)' : ''}`);
  }
  if (APPLY) {
    for (const r of report.filter((x) => x.droppable)) {
      await db.collection(r.collection).dropIndex(r.index);
      console.log(`[eski dizin] silindi: ${r.collection}.${r.index}`);
    }
  }
  await conn.close();
}
main().catch((e) => { console.error('[eski dizin] HATA:', e.message); process.exit(1); });
