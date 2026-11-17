#!/usr/bin/env node
// Hesap denetimi: yönetici hesaplarını ve hiçbir personele bağlı olmayan hesapları listeler;
// istenirse askıya alır (active=false). HİÇBİR HESABI SİLMEZ.
//
// Kullanım (varsayılan KURU, sadece rapor):
//   MONGODB_URI=<uri> node scripts/auditAccounts.js
// Askıya alma (açık onaydan sonra):
//   MONGODB_URI=<uri> node scripts/auditAccounts.js --suspend-admins=admin@admin.com,<diğer> --apply
//   MONGODB_URI=<uri> node scripts/auditAccounts.js --suspend-orphans --apply
//
// "Bağsız hesap": yönetici değil, hiçbir personel kaydının userId'si değil ve kendi personId'si
// mevcut bir personeli göstermiyor.
'use strict';

const path = require('path');
const mongoose = require(path.join(__dirname, '..', 'node_modules', 'mongoose'));

const APPLY = process.argv.includes('--apply');
const SUSPEND_ORPHANS = process.argv.includes('--suspend-orphans');
const adminArg = process.argv.find((a) => a.startsWith('--suspend-admins='));
const SUSPEND_ADMINS = new Set(
  (adminArg ? adminArg.split('=').slice(1).join('=') : '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);
const ADMIN_ROLES = new Set(['admin', 'superadmin', 'super_admin']);

const mask = (v) => {
  const s = String(v || '');
  if (!s) return '-';
  if (s.includes('@')) return s.replace(/^(.{1,3}).*(@.*)$/, '$1***$2');
  return s.length > 5 ? `${s.slice(0, 3)}***${s.slice(-2)}` : '***';
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI açıkça verilmeli (.env okunmaz).');
  const host = (String(uri).match(/@([^/?]+)/) || [])[1] || '?';
  console.log(`[hesaplar] sunucu: ${host} · mod: ${APPLY ? 'UYGULA' : 'KURU (yazmaz)'}`);

  await mongoose.connect(uri, { dbName: 'hastane', serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const users = await db.collection('users').find({}, {
    projection: { name: 1, email: 1, tc: 1, role: 1, active: 1, status: 1, personId: 1, createdAt: 1, lastLoginAt: 1 },
  }).toArray();
  const people = await db.collection('people').find({}, { projection: { _id: 1, userId: 1 } }).toArray();
  const personIds = new Set(people.map((p) => String(p._id)));
  const linkedUserIds = new Set(people.map((p) => String(p.userId || '')).filter(Boolean));

  const admins = users.filter((u) => ADMIN_ROLES.has(String(u.role || '').toLowerCase()));
  const orphans = users.filter((u) =>
    !ADMIN_ROLES.has(String(u.role || '').toLowerCase())
    && !linkedUserIds.has(String(u._id))
    && !(u.personId && personIds.has(String(u.personId)))
  );

  console.log(`\nYönetici hesapları (${admins.length}):`);
  for (const u of admins) {
    const flag = SUSPEND_ADMINS.has(String(u.email || '').toLowerCase()) ? '  ← askıya alınacak' : '';
    console.log(`  ${String(u.name || '-').padEnd(18)} ${mask(u.email).padEnd(26)} aktif:${u.active !== false} oluşturma:${u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : '-'}${flag}`);
  }

  console.log(`\nPersonele bağlı OLMAYAN hesaplar (${orphans.length}):`);
  const byRole = orphans.reduce((a, u) => ((a[u.role || '-'] = (a[u.role || '-'] || 0) + 1), a), {});
  console.log(`  rollere göre: ${JSON.stringify(byRole)} · aktif: ${orphans.filter((u) => u.active !== false).length}`);
  for (const u of orphans.slice(0, 10)) {
    console.log(`  ${String(u.name || '-').padEnd(22)} rol:${u.role} tc:${mask(u.tc)} e-posta:${mask(u.email)}`);
  }
  if (orphans.length > 10) console.log(`  … ve ${orphans.length - 10} hesap daha`);

  const unknownAdmins = [...SUSPEND_ADMINS].filter((e) => !admins.some((a) => String(a.email || '').toLowerCase() === e));
  if (unknownAdmins.length) throw new Error(`Bulunamayan yönetici e-postası: ${unknownAdmins.join(', ')} — iptal.`);

  if (APPLY) {
    let n = 0;
    for (const u of admins.filter((a) => SUSPEND_ADMINS.has(String(a.email || '').toLowerCase()))) {
      await db.collection('users').updateOne({ _id: u._id }, { $set: { active: false, suspendedReason: 'auditAccounts' } });
      n++;
    }
    if (SUSPEND_ORPHANS) {
      const res = await db.collection('users').updateMany(
        { _id: { $in: orphans.map((u) => u._id) } },
        { $set: { active: false, suspendedReason: 'auditAccounts:orphan' } }
      );
      n += res.modifiedCount;
    }
    console.log(`\n[hesaplar] askıya alınan: ${n}`);
  } else {
    console.log('\n[hesaplar] KURU çalıştırma — hiçbir şey değişmedi.');
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[hesaplar] HATA:', err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
