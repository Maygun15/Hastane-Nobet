#!/usr/bin/env node
// scripts/ensureCommercialIndexes.js — uygulamanın verdiği güvencelerin dayandığı dizinler.
// Üretim modunda autoIndex kapalı (index.js) → dizinler kendiliğinden oluşmaz.
//
//   requests        {fromUserId, clientRequestId} tekil, kısmi (clientRequestId metin olanlar)
//                   → aynı form kimliğiyle tekrar / eş zamanlı gönderimde tek talep
//   notifications   {dedupeKey} tekil, kısmi → aynı revizyon bildirimi bir kez
//   schedulechanges iki sorgu dizini → işlem geçmişi, yayın sürümü
//
// Adımlar: 1) ön tarama (eksik alan, çift kayıt, kapsam)  2) önizleme  3) --apply ile oluşturma
//          4) veritabanından geri okuyup tanımla karşılaştırma. Hiçbir dizini SİLMEZ.
// Kullanım: node scripts/ensureCommercialIndexes.js --target=local|staging|production [--apply] [--json]
// MongoDB: tekil dizin, çift kayıt varken kurulamaz; alan eksik belgeler null sayılır; kısmi dizinde
// tekillik yalnız filtreye uyan belgelerde aranır (docs/manual/core/index-unique).
'use strict';
const { connectTarget } = require('./lib/dbTarget');
const { REQUIRED_INDEXES, checkIndexes } = require('../services/deploymentInfo');

const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');

async function prescan(db) {
  const req = db.collection('requests');
  const notif = db.collection('notifications');
  const chg = db.collection('schedulechanges');
  const dupGroups = async (col, groupId, match) => col.aggregate([
    { $match: match }, { $group: { _id: groupId, n: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { n: { $gt: 1 } } }, { $limit: 50 },
  ]).toArray();

  const reqDups = await dupGroups(req, { u: '$fromUserId', c: '$clientRequestId' }, { clientRequestId: { $type: 'string' } });
  const notifDups = await dupGroups(notif, '$dedupeKey', { dedupeKey: { $type: 'string' } });
  const pubDups = await dupGroups(chg, { h: '$hospitalId', s: '$sectionId', v: '$serviceId', r: '$role', y: '$year', m: '$month', p: '$publishVersion' }, { kind: 'publish' });
  return {
    requests: {
      total: await req.estimatedDocumentCount(),
      withClientRequestId: await req.countDocuments({ clientRequestId: { $type: 'string' } }),
      // Filtre dışı kalır (tekillik aranmaz) ama raporlanır: kimlik metin değil
      nonStringClientRequestId: await req.countDocuments({ clientRequestId: { $exists: true, $not: { $type: 'string' } } }),
      // Kimliği olup göndereni olmayan kayıt: dizinde fromUserId=null sayılır, çakışabilir
      clientRequestIdWithoutUser: await req.countDocuments({ clientRequestId: { $type: 'string' }, fromUserId: { $in: [null] } }),
      withoutHospital: await req.countDocuments({ hospitalId: { $in: [null] } }),
      duplicateGroups: reqDups.map((g) => ({ fromUserId: String(g._id.u), clientRequestId: g._id.c, count: g.n, ids: g.ids.map(String) })),
    },
    notifications: {
      total: await notif.estimatedDocumentCount(),
      withDedupeKey: await notif.countDocuments({ dedupeKey: { $type: 'string' } }),
      duplicateGroups: notifDups.map((g) => ({ dedupeKey: g._id, count: g.n, ids: g.ids.map(String) })),
    },
    schedulechanges: {
      total: await chg.estimatedDocumentCount(),
      withoutHospital: await chg.countDocuments({ hospitalId: { $in: [null] } }),
      duplicatePublishGroups: pubDups.map((g) => ({ scope: `${g._id.y}-${g._id.m} ${g._id.v || ''} ${g._id.r || ''}`.trim(), publishVersion: g._id.p, count: g.n, ids: g.ids.map(String) })),
    },
  };
}

async function main() {
  const { conn, db, target, host, marker } = await connectTarget({ readOnly: !APPLY });
  const out = { target, host, marker, mode: APPLY ? 'uygula' : 'kuru çalıştırma', at: new Date().toISOString() };
  try {
    // Modeller bu bağlantıya bağlanır (varsayılan mongoose bağlantısı kullanılmaz).
    const models = ['Request', 'Notification', 'ScheduleChange'].map((name) => {
      const M = require(`../models/${name}`);
      return conn.model(M.modelName, M.schema, M.collection.name);
    });

    out.prescan = await prescan(db);
    const blockers = [];
    if (out.prescan.requests.duplicateGroups.length) blockers.push(`requests: ${out.prescan.requests.duplicateGroups.length} çift (fromUserId, clientRequestId) grubu`);
    if (out.prescan.requests.clientRequestIdWithoutUser) blockers.push(`requests: ${out.prescan.requests.clientRequestIdWithoutUser} kayıtta form kimliği var, gönderen yok`);
    if (out.prescan.notifications.duplicateGroups.length) blockers.push(`notifications: ${out.prescan.notifications.duplicateGroups.length} çift dedupeKey grubu`);
    if (out.prescan.schedulechanges.duplicatePublishGroups.length) blockers.push(`schedulechanges: ${out.prescan.schedulechanges.duplicatePublishGroups.length} çift yayın sürümü grubu (eş zamanlı yayın kalıntısı)`);
    out.blockers = blockers;

    out.plan = [];
    for (const M of models) {
      if (APPLY) await M.createCollection().catch(() => {});
      const exists = (await db.listCollections({ name: M.collection.name }).toArray()).length > 0;
      const have = exists ? await db.collection(M.collection.name).indexes() : [];
      for (const [key, opts = {}] of M.schema.indexes()) {
        if (have.some((ix) => JSON.stringify(ix.key) === JSON.stringify(key))) continue;
        out.plan.push({ collection: M.collection.name, key, unique: !!opts.unique, partialFilterExpression: opts.partialFilterExpression || null, expireAfterSeconds: opts.expireAfterSeconds ?? null });
      }
    }

    out.created = [];
    if (APPLY && out.plan.length && blockers.length) out.skippedForConflicts = true;
    if (APPLY && out.plan.length && !blockers.length) {
      for (const M of models) {
        const mine = out.plan.filter((p) => p.collection === M.collection.name);
        if (!mine.length) continue;
        await M.createIndexes(); // yalnız eksikleri oluşturur; var olanı silmez
        out.created.push(...mine.map((p) => `${p.collection} ${JSON.stringify(p.key)}`));
      }
    }

    // Geri okuma: güvence tablosu + seçenek karşılaştırması
    const check = await checkIndexes(db);
    out.readback = { ok: check.ok, guarantees: check.guarantees, missing: check.missing.map((m) => m.label), details: [] };
    for (const r of REQUIRED_INDEXES) {
      const ix = (await db.collection(r.collection).indexes().catch(() => [])).find((i) => JSON.stringify(i.key) === JSON.stringify(r.key));
      out.readback.details.push({
        collection: r.collection, key: r.key, present: !!ix, name: ix?.name || null,
        unique: !!ix?.unique, uniqueExpected: !!r.unique,
        partialFilterExpression: ix?.partialFilterExpression || null,
        matches: !!ix && (!!ix.unique === !!r.unique),
      });
    }
  } finally {
    await conn.close();
  }

  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log(`[dizin] hedef ${out.target} (${out.host}), işaret ${out.marker || 'YOK'} — ${out.mode}`);
  const p = out.prescan;
  console.log(`[ön tarama] requests: ${p.requests.total} kayıt, form kimlikli ${p.requests.withClientRequestId}, metin olmayan kimlik ${p.requests.nonStringClientRequestId}, göndereni olmayan kimlikli ${p.requests.clientRequestIdWithoutUser}, hastanesiz ${p.requests.withoutHospital}, çift grup ${p.requests.duplicateGroups.length}`);
  console.log(`[ön tarama] notifications: ${p.notifications.total} kayıt, dedupeKey'li ${p.notifications.withDedupeKey}, çift grup ${p.notifications.duplicateGroups.length}`);
  console.log(`[ön tarama] schedulechanges: ${p.schedulechanges.total} kayıt, hastanesiz ${p.schedulechanges.withoutHospital}, çift yayın sürümü grubu ${p.schedulechanges.duplicatePublishGroups.length}`);
  for (const g of p.requests.duplicateGroups) console.log(`  ÇAKIŞMA requests kullanıcı ${g.fromUserId} kimlik ${g.clientRequestId}: ${g.count} kayıt (${g.ids.join(', ')})`);
  for (const g of p.notifications.duplicateGroups) console.log(`  ÇAKIŞMA notifications ${g.dedupeKey}: ${g.count} kayıt`);
  for (const g of p.schedulechanges.duplicatePublishGroups) console.log(`  ÇAKIŞMA schedulechanges yayın ${g.scope} sürüm ${g.publishVersion}: ${g.count} kayıt (${g.ids.join(', ')})`);
  if (out.blockers.length) console.log(`[engel] ${out.blockers.join('; ')} → kayıtlar elle birleştirilmeli/silinmeli; dizin kurulmaz`);
  if (out.skippedForConflicts) console.log('[uygula] veri çakışması nedeniyle HİÇBİR dizin oluşturulmadı');
  for (const x of out.plan) console.log(`[önizleme] ${x.collection} ${JSON.stringify(x.key)}${x.unique ? ' TEKİL' : ''}${x.partialFilterExpression ? ' kısmi ' + JSON.stringify(x.partialFilterExpression) : ''}${x.expireAfterSeconds != null ? ' TTL ' + x.expireAfterSeconds + ' sn' : ''}`);
  if (!out.plan.length) console.log('[önizleme] oluşturulacak dizin yok');
  for (const c of out.created) console.log(`[oluşturuldu] ${c}`);
  for (const d of out.readback.details) console.log(`[geri okuma] ${d.collection} ${JSON.stringify(d.key)}: ${d.present ? `var (${d.name})${d.unique ? ' tekil' : ''}` : 'YOK'} ${d.matches ? '✓' : '✗'}`);
  console.log(`[güvence] ${Object.entries(out.readback.guarantees).map(([k, v]) => `${k}=${v}`).join(', ')} — ${out.readback.ok ? 'HAZIR' : 'EKSİK'}`);
  if (out.skippedForConflicts) process.exitCode = 3;
  else if (!out.readback.ok) process.exitCode = 2;
}

main().catch((e) => { console.error('[dizin] HATA:', e.message); process.exit(1); });
