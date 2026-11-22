#!/usr/bin/env node
// Eski otomatik plan kopyalarını (generatedschedules) temizler: her kapsamda en yeni N tanesi kalır.
// Uygulama yalnız en yenisini okur. Varsayılan kuru çalıştırma; --apply siler (geri alınamaz → önce yedek).
// Kullanım: node scripts/pruneGeneratedSchedules.js --target=staging [--keep=3] [--apply]
'use strict';
const { connectTarget } = require('./lib/dbTarget');
const APPLY = process.argv.includes('--apply');
const KEEP = Math.max(1, Number((process.argv.find((a) => a.startsWith('--keep=')) || '--keep=3').split('=')[1]));

connectTarget({ readOnly: !APPLY }).then(async ({ conn, db, target, host }) => {
  const col = db.collection('generatedschedules');
  const groups = await col.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: { h: '$hospitalId', s: '$sectionId', v: '$serviceId', r: '$role', y: '$year', m: '$month' }, ids: { $push: '$_id' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: KEEP } } },
  ], { allowDiskUse: true }).toArray();
  const doomed = groups.flatMap((g) => g.ids.slice(KEEP));
  const before = (await db.command({ collStats: 'generatedschedules' })).size;
  console.log(`[temizlik] hedef ${target} (${host}) — ${APPLY ? 'uygula' : 'kuru çalıştırma'}; kapsam başına son ${KEEP} kopya kalır`);
  for (const g of groups) console.log(`  ${g._id.y}-${String(g._id.m).padStart(2, '0')} servis ${g._id.v || '(tümü)'} ${g._id.r}: ${g.n} kopya → ${KEEP}`);
  console.log(`[temizlik] silinecek ${doomed.length} kopya (koleksiyon şu an ${Math.round(before / 1024 / 1024)} MB, ${await col.estimatedDocumentCount()} kayıt)`);
  if (APPLY && doomed.length) {
    const r = await col.deleteMany({ _id: { $in: doomed } });
    const after = (await db.command({ collStats: 'generatedschedules' })).size;
    console.log(`[temizlik] silindi ${r.deletedCount}; koleksiyon ${Math.round(after / 1024 / 1024)} MB`);
  }
  await conn.close();
}).catch((e) => { console.error('[temizlik] HATA:', e.message); process.exit(1); });
