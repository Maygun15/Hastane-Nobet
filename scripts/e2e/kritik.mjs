// Kritik akışlar — yerelde ve DENEME ortamında çalışır, kendi sentetik kumunu kurar.
//
//   E2E_TARGET=local   node scripts/e2e/kritik.mjs      (API localhost:3100, DB 127.0.0.1:27018)
//   E2E_TARGET=staging node scripts/e2e/kritik.mjs      (API nobet-staging-api, DB ~/nöbet/.staging-erisim.env)
//
// Güvenlik:
//  • Veritabanı bağlantısı scripts/lib/dbTarget.js ile: bağlantı öncesi adres–hedef, sonrası ortam işareti.
//  • Yalnız iki sentetik kurum (slug e2e-sentetik-a / -b) ve onlara bağlı kayıtlar oluşturulur ve silinir.
//    Başka hiçbir kayda dokunulmaz (toplu silme yok). Kişi adları "SENTETİK …", e-postalar *.sentetik.test.
//  • Sentetik hesap şifreleri rastgele; yalnız 0600 izinli dosyaya yazılır, ekrana yazılmaz.
//  • E2E_KEEP=1 → kum silinmez (tarayıcı testi için); E2E_CLEANUP_ONLY=1 → yalnız temizler.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(here, '../../my-backend-project');
const require = createRequire(path.join(backend, 'package.json'));
const { connectTarget } = require('./scripts/lib/dbTarget');

const TARGET = process.env.E2E_TARGET || 'local';
const API = { local: 'http://localhost:3100', staging: 'https://nobet-staging-api.onrender.com' }[TARGET];
if (!API) throw new Error(`E2E_TARGET yalnız local | staging (verilen: ${TARGET})`);
const CRED_OUT = TARGET === 'staging'
  ? path.join(os.homedir(), 'nöbet', '.staging-e2e-giris.txt')
  : path.join(os.homedir(), 'nöbet', '.prova-db', 'kritik-giris.txt');

const SECTION = 'calisma-cizelgesi';
const ROLE = 'Nurse';
const Y0 = 2029; const M0 = 12; // önceki ay (yıl sınırı)
const Y1 = 2030; const M1 = 1;
const DAYS_IN = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n) => String(n).padStart(2, '0');

export const results = [];
const env = { target: TARGET, api: API, commit: null };
function check(id, name, ok, detail = '') {
  results.push({ id, name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${id} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(token, method, p, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const r = await fetch(`${API}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let j = null; try { j = await r.json(); } catch { /* boş */ }
      return { status: r.status, body: j };
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000)); // uyuyan ücretsiz sunucu
    }
  }
}
async function login(email, password) {
  const r = await call(null, 'POST', '/api/auth/login', { identifier: email, email, password });
  const t = r.body?.token || r.body?.accessToken || r.body?.data?.token;
  if (!t) throw new Error(`sentetik giriş başarısız (${r.status})`);
  return t;
}

// ─────────── Sentetik kum ───────────
const SLUGS = ['e2e-sentetik-a', 'e2e-sentetik-b'];
const SANDBOX_COLLECTIONS = ['people', 'services', 'monthlyschedules', 'assignments', 'dutyrules', 'schedulechanges',
  'leavebalances', 'leave_types', 'requests', 'notifications', 'settings', 'auditlogs', 'undooperations'];

async function cleanup(db) {
  const hs = await db.collection('hospitals').find({ slug: { $in: SLUGS } }).project({ _id: 1 }).toArray();
  const ids = hs.map((h) => h._id);
  if (!ids.length) return 0;
  const idStr = ids.map(String);
  let n = 0;
  for (const c of SANDBOX_COLLECTIONS) {
    const r = await db.collection(c).deleteMany({ hospitalId: { $in: [...ids, ...idStr] } }).catch(() => ({ deletedCount: 0 }));
    n += r.deletedCount || 0;
  }
  n += (await db.collection('users').deleteMany({ hospitalId: { $in: ids }, email: /\.sentetik\.test$/ })).deletedCount;
  n += (await db.collection('hospitals').deleteMany({ _id: { $in: ids }, slug: { $in: SLUGS } })).deletedCount;
  return n;
}

async function seed(conn) {
  const db = conn.db;
  const User = conn.model('User', require('./models/User').schema);
  const mkHospital = async (slug, name) => (await db.collection('hospitals').findOneAndUpdate(
    { slug }, { $setOnInsert: { name, slug, contactEmail: `iletisim@${slug}.sentetik.test`, active: true, createdAt: new Date() } },
    { upsert: true, returnDocument: 'after' })).value ?? db.collection('hospitals').findOne({ slug });
  const hA = await mkHospital(SLUGS[0], 'E2E Sentetik Hastane A');
  const hB = await mkHospital(SLUGS[1], 'E2E Sentetik Hastane B');
  const hospitalA = hA._id || hA; const hospitalB = hB._id || hB;

  const svc = await db.collection('services').insertOne({ hospitalId: hospitalA, code: 'E2E', name: 'E2E Sentetik Servis', active: true, createdAt: new Date() });
  const serviceId = String(svc.insertedId);
  const people = Array.from({ length: 10 }, (_, i) => ({
    hospitalId: hospitalA, serviceId, name: `SENTETİK HEMŞİRE ${pad(i + 1)}`, active: true,
    meta: { role: ROLE, title: 'HEMŞİRE', areas: ['KIRMIZI', 'TRİAJ'], shiftCodes: ['N', 'M'] }, createdAt: new Date(),
  }));
  const pIns = await db.collection('people').insertMany(people);
  const personIds = Object.values(pIns.insertedIds);

  const pw = () => crypto.randomBytes(12).toString('base64url');
  const creds = {};
  async function mkUser(key, email, fields) {
    const password = pw();
    const u = new User({ email, ...fields, active: true, mustChangePassword: false });
    await u.setPassword(password);
    await u.save();
    creds[key] = { email, password, id: String(u._id) };
    return u;
  }
  await mkUser('adminA', 'yonetici-a@e2e.sentetik.test', { name: 'Sentetik Yönetici A', role: 'admin', hospitalId: hospitalA, serviceIds: [serviceId] });
  await mkUser('plannerA', 'planlayici-a@e2e.sentetik.test', { name: 'Sentetik Planlayıcı A', role: 'staff', hospitalId: hospitalA, serviceIds: [serviceId] });
  const n1 = await mkUser('nurse1', 'hemsire1@e2e.sentetik.test', { name: people[0].name, role: 'user', hospitalId: hospitalA, serviceIds: [serviceId], personId: personIds[0] });
  const n2 = await mkUser('nurse2', 'hemsire2@e2e.sentetik.test', { name: people[1].name, role: 'user', hospitalId: hospitalA, serviceIds: [serviceId], personId: personIds[1] });
  await mkUser('adminB', 'yonetici-b@e2e.sentetik.test', { name: 'Sentetik Yönetici B', role: 'admin', hospitalId: hospitalB, serviceIds: [] });
  await db.collection('people').updateOne({ _id: personIds[0] }, { $set: { userId: n1._id } });
  await db.collection('people').updateOne({ _id: personIds[1] }, { $set: { userId: n2._id } });

  await db.collection('leave_types').insertMany([
    { hospitalId: hospitalA, name: 'YILLIK İZİN', code: 'Y', category: 'annual', isDeductible: true, maxDaysPerYear: 20, active: true },
    { hospitalId: hospitalA, name: 'RAPOR', code: 'R', category: 'sick', isDeductible: false, active: true },
  ]);

  fs.writeFileSync(CRED_OUT, [
    `Sentetik E2E hesapları — ${TARGET} (gerçek kişi değil; kum silinince geçersiz)`,
    ...Object.entries(creds).map(([k, c]) => `${k}: ${c.email} / ${c.password}`), '',
  ].join('\n'), { mode: 0o600 });
  return { hospitalA: String(hospitalA), hospitalB: String(hospitalB), serviceId, personIds: personIds.map(String), people: people.map((p) => p.name), creds };
}

const DEFS = [
  { id: 'r-kirmizi', label: 'KIRMIZI', shiftCode: 'N', pattern: [1, 1, 1, 1, 1, 1, 1], defaultCount: 1 },
  { id: 'r-triaj', label: 'TRİAJ', shiftCode: 'M', pattern: [1, 1, 1, 1, 1, 1, 1], defaultCount: 1 },
];
const RULES = { ONE_SHIFT_PER_DAY: true, LEAVE_BLOCK: true, NIGHT_NEXT_DAY_OFF: true, MIN_REST_HOURS: 11, MAX_CONSECUTIVE_DAYS: 6 };

// ─────────── Senaryolar ───────────
async function scenarios(sb, db) {
  const S = { sectionId: SECTION, serviceId: sb.serviceId, role: ROLE };
  const qs = (y, m) => new URLSearchParams({ ...S, year: String(y), month: String(m) }).toString();
  const A = await login(sb.creds.adminA.email, sb.creds.adminA.password);
  const P = await login(sb.creds.plannerA.email, sb.creds.plannerA.password);
  const N1 = await login(sb.creds.nurse1.email, sb.creds.nurse1.password);
  const N2 = await login(sb.creds.nurse2.email, sb.creds.nurse2.password);
  const B = await login(sb.creds.adminB.email, sb.creds.adminB.password);
  const { ObjectId } = require('mongoose').Types;
  const HA = new ObjectId(sb.hospitalA);

  // K0 sürüm / ortam / hazırlık
  const v = await call(null, 'GET', '/api/version');
  env.commit = v.body?.commit || null;
  check('K0', 'Sunucu sürümü, ortam işareti ve güvence dizinleri', v.status === 200 && !!v.body?.commit && v.body?.db?.environment === TARGET && v.body?.ready?.ok === true,
    `commit ${v.body?.commit}, ortam ${v.body?.db?.environment}, hazır ${v.body?.ready?.ok}${v.body?.ready?.missing?.length ? ' eksik: ' + v.body.ready.missing.map((m) => m.label || m).join('; ') : ''}`);

  // Kurallar (yönetici) + planlar
  const pol = await call(A, 'PUT', '/api/duty-rules/policy', { sectionId: SECTION, values: RULES, sources: { MIN_REST_HOURS: 'kurum' } });
  if (pol.status !== 200) throw new Error(`kural kaydı başarısız (${pol.status} ${pol.body?.message || ''})`);
  for (const [y, m] of [[Y0, M0], [Y1, M1]]) {
    const r = await call(A, 'PUT', '/api/schedules/monthly', { ...S, year: y, month: m, data: { defs: DEFS } });
    if (r.status !== 200) throw new Error(`plan oluşturulamadı ${y}-${m} (${r.status} ${r.body?.message || r.body?.code || ''})`);
  }

  // K1 aynı form kimliği, eş zamanlı 5 gönderim → tek kayıt
  const cid = `kritik-${crypto.randomBytes(6).toString('hex')}`;
  const body = { type: 'izin', leaveTypeCode: 'R', targetDate: `${Y1}-01-14`, targetDateEnd: `${Y1}-01-15`, message: 'E2E sentetik rapor', clientRequestId: cid };
  const many = await Promise.all(Array.from({ length: 5 }, () => call(N1, 'POST', '/api/requests', body)));
  const cnt = await db.collection('requests').countDocuments({ hospitalId: HA, clientRequestId: cid });
  const ids = new Set(many.map((r) => String(r.body?.request?._id || '')));
  check('K1', 'Aynı işlem kimliğiyle eş zamanlı 5 gönderim → tek talep', many.every((r) => r.status === 200) && cnt === 1 && ids.size === 1,
    `yanıtlar ${many.map((r) => r.status).join(',')}, veritabanında ${cnt} kayıt, ${many.filter((r) => r.body?.replayed).length} tekrar yanıtı`);
  const rReq = many[0].body?.request;

  // K2 aynı kimlik farklı içerik → 409
  const diff = await call(N1, 'POST', '/api/requests', { ...body, targetDateEnd: `${Y1}-01-16` });
  check('K2', 'Aynı işlem kimliği farklı içerikle → açıklamalı ret', diff.status === 409 && diff.body?.code === 'IDEMPOTENCY_KEY_REUSED',
    `HTTP ${diff.status} ${diff.body?.code || ''}`);

  // K3 rapor onayı yıllık izni etkilemez; K4 yıllık izin eş zamanlı iki onay → bir kez düşüm
  const a1 = await call(A, 'PUT', `/api/requests/${rReq._id}`, { status: 'approved' });
  const yr = await call(N1, 'POST', '/api/requests', { type: 'izin', leaveTypeCode: 'Y', targetDate: `${Y1}-01-21`, targetDateEnd: `${Y1}-01-23`, message: 'E2E sentetik yıllık', clientRequestId: `${cid}-y` });
  const [x1, x2] = await Promise.all([
    call(A, 'PUT', `/api/requests/${yr.body?.request?._id}`, { status: 'approved' }),
    call(P, 'PUT', `/api/requests/${yr.body?.request?._id}`, { status: 'approved' }),
  ]);
  const yType = await db.collection('leave_types').findOne({ hospitalId: HA, code: 'Y' });
  const bals = await db.collection('leavebalances').find({ hospitalId: { $in: [HA, sb.hospitalA] } }).toArray();
  const yBal = bals.find((b) => String(b.leaveTypeId) === String(yType._id));
  check('K3', 'Rapor (2 gün) onayı yıllık izin bakiyesini etkilemez', a1.status === 200 && !bals.some((b) => String(b.leaveTypeId) !== String(yType._id)),
    `bakiye kayıtları: ${bals.map((b) => `${b.leaveTypeName || b.leaveTypeId}:${b.used}`).join(', ') || 'yok'}`);
  check('K4', '3 günlük yıllık izin, eş zamanlı iki onay → bir kez düşüm (20 → 17)', yBal?.used === 3 && yBal?.remaining === 17 && [x1, x2].every((r) => r.status === 200) && [x1, x2].some((r) => r.body?.alreadyApplied),
    `onaylar ${x1.status}/${x2.status}${[x1, x2].some((r) => r.body?.alreadyApplied) ? ' (biri "zaten uygulandı")' : ''}; hak ${yBal?.allocated}, kullanılan ${yBal?.used}, kalan ${yBal?.remaining}`);

  // K5 iki planlayıcı aynı sürüm → eski sürümle kaydeden çakışma yanıtı alır
  const g = await call(A, 'POST', '/api/scheduler/generate', { ...S, year: Y1, month: M1, sync: true });
  const base = (await call(A, 'GET', `/api/schedules/monthly?${qs(Y1, M1)}`)).body?.schedule;
  const baseP = (await call(P, 'GET', `/api/schedules/monthly?${qs(Y1, M1)}`)).body?.schedule;
  const sA = await call(A, 'PUT', '/api/schedules/monthly', { ...S, year: Y1, month: M1, data: { ...base.data, meta_note: 'A' }, baseRevision: base.revision, opId: `op-a-${cid}` });
  const sP = await call(P, 'PUT', '/api/schedules/monthly', { ...S, year: Y1, month: M1, data: { ...baseP.data, meta_note: 'P' }, baseRevision: baseP.revision, opId: `op-p-${cid}` });
  check('K5', 'İki planlayıcı aynı sürüm: eski sürümle kayıt → çakışma + kim değiştirdi', g.status === 200 && base.revision === baseP.revision && sA.status === 200 && sP.status === 409
    && sP.body?.code === 'SCHEDULE_REVISION_CONFLICT' && /Sentetik Yönetici A/.test(sP.body?.updatedByName || ''),
    `planlama ${g.status}; kayıt A ${sA.status}, P ${sP.status} (${sP.body?.updatedByName || ''}, güncel rev ${sP.body?.currentRevision})`);

  // K6 kayıt tamamlandı, yanıt kayboldu → aynı istekle tekrar aynı sonucu döndürür
  const cur = (await call(A, 'GET', `/api/schedules/monthly?${qs(Y1, M1)}`)).body?.schedule;
  const req6 = { ...S, year: Y1, month: M1, data: { ...cur.data, meta_note: 'K6' }, baseRevision: cur.revision, opId: `op-k6-${cid}` };
  const k6a = await call(A, 'PUT', '/api/schedules/monthly', req6);
  const k6b = await call(A, 'PUT', '/api/schedules/monthly', req6);
  const k6c = await call(A, 'PUT', '/api/schedules/monthly', { ...req6, data: { ...cur.data, meta_note: 'BAŞKA' } });
  check('K6', 'Yanıt kaybı sonrası aynı istek → aynı sonuç; aynı kimlik farklı içerik → ret', k6a.status === 200 && k6b.status === 200 && k6b.body?.replayed === true
    && k6b.body?.schedule?.revision === k6a.body?.schedule?.revision && k6c.status === 409 && k6c.body?.code === 'IDEMPOTENCY_KEY_REUSED',
    `rev ${k6a.body?.schedule?.revision} / tekrar ${k6b.body?.schedule?.revision} (replayed ${k6b.body?.replayed}); farklı içerik HTTP ${k6c.status}`);

  // K7 kural değişikliği → yayın engeli → güncel doğrulama → yayın
  const pol2 = await call(A, 'PUT', '/api/duty-rules/policy', { sectionId: SECTION, values: { ...RULES, MIN_REST_HOURS: 12 }, sources: { MIN_REST_HOURS: 'kurum' }, expectedRevision: pol.body?.policy?.revision ?? pol.body?.revision });
  const ackAll = async () => {
    const r = await call(A, 'GET', `/api/schedules/risks?${qs(Y1, M1)}`);
    const keys = (r.body?.risks || []).filter((x) => !x.acknowledged).map((x) => x.key);
    if (keys.length) await call(A, 'POST', '/api/schedules/risks/ack', { ...S, year: Y1, month: M1, keys, note: 'E2E sentetik' });
  };
  await ackAll();
  const blocked = await call(A, 'POST', '/api/schedules/publish', { ...S, year: Y1, month: M1 });
  const rv = await call(A, 'POST', '/api/schedules/monthly/revalidate', { ...S, year: Y1, month: M1 });
  await ackAll();
  const pub1 = await call(A, 'POST', '/api/schedules/publish', { ...S, year: Y1, month: M1 });
  check('K7', 'Kural değişti → yayın 409; güncel doğrulama → yayın sürüm 1', pol2.status === 200 && blocked.status === 409 && rv.status === 200 && pub1.status === 200 && pub1.body?.version === 1,
    `kural ${pol2.status}; eski kuralla yayın ${blocked.status} ${blocked.body?.code || ''}; doğrulama ${rv.status}; yayın ${pub1.status} sürüm ${pub1.body?.version} ${pub1.body?.message || ''}`);

  // K8 ay ve yıl sınırı: 31 Aralık 2029 gece (N) tutan kişi 1 Ocak 2030'a yazılmaz
  const dec = (await call(A, 'GET', `/api/schedules/monthly?${qs(Y0, M0)}`)).body?.schedule;
  const p3 = sb.people[2];
  const decData = { ...dec.data, assignments: [{ date: `${Y0}-12-31`, shiftId: 'r-kirmizi', rowId: 'r-kirmizi', shiftCode: 'N', personId: sb.personIds[2], personName: p3, hours: 24 }] };
  const ds = await call(A, 'PUT', '/api/schedules/monthly', { ...S, year: Y0, month: M0, data: decData, baseRevision: dec.revision });
  const jan = await call(A, 'POST', '/api/scheduler/generate', { ...S, year: Y1, month: M1, sync: true, dryRun: true });
  const jan1 = (jan.body?.data?.assignments || []).filter((a) => String(a.date).slice(0, 10) === `${Y1}-01-01` && (String(a.personId) === sb.personIds[2] || a.personName === p3));
  const boundary = jan.body?.data?.boundary || jan.body?.boundary || jan.body?.data?.ruleContext?.boundary;
  check('K8', '31 Ara 2029 gece nöbeti → 1 Oca 2030 atama yok (önceki dönem okunur)', ds.status === 200 && jan.status === 200 && jan1.length === 0 && (boundary?.status === 'found' || boundary?.priorCount > 0),
    `önceki dönem ${boundary?.status || '?'} (${boundary?.priorCount ?? boundary?.count ?? '?'} görev); 1 Ocak ${p3}: ${jan1.length} atama`);

  // K9 revizyon: bir görev hemşire 1'den hemşire 2'ye geçer → ikisi de etkilenen; K10 eş zamanlı iki yayın → bildirim çoğalmaz
  const pubDoc = (await call(A, 'GET', `/api/schedules/monthly?${qs(Y1, M1)}`)).body?.schedule;
  const asg = pubDoc.data.assignments || [];
  const pickDate = (pid) => new Set(asg.filter((a) => String(a.personId) === pid).map((a) => String(a.date).slice(0, 10)));
  const n1Dates = pickDate(sb.personIds[0]); const n2Dates = pickDate(sb.personIds[1]);
  // Alıcının o gün ve komşu günlerde görevi olmayan bir görev seç (çift görev / dinlenme ihlali olmasın).
  const shiftDay = (d, k) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
  const freeAround = (dates, d) => ![-1, 0, 1].some((k) => dates.has(shiftDay(d, k)));
  let target = null; let fromIdx = 0; let toIdx = 1;
  for (const [f, t, toDates] of [[0, 1, n2Dates], [1, 0, n1Dates]]) {
    target = asg.find((a) => String(a.personId) === sb.personIds[f] && freeAround(toDates, String(a.date).slice(0, 10)));
    if (target) { fromIdx = f; toIdx = t; break; }
  }
  const tDate = target ? String(target.date).slice(0, 10) : null;
  const toBusy = false;
  const newAsg = asg.map((a) => (a === target ? { ...a, personId: sb.personIds[toIdx], personName: sb.people[toIdx] } : a));
  const named = JSON.parse(JSON.stringify(pubDoc.data?.roster?.namedAssignments || {}));
  const dKey = tDate ? String(Number(tDate.slice(8, 10))) : null;
  const rowKey = target ? String(target.shiftId || target.rowId) : null;
  if (dKey && named[dKey]?.[rowKey]) named[dKey][rowKey] = named[dKey][rowKey].map((n) => (n === sb.people[fromIdx] ? sb.people[toIdx] : n));
  const sv = await call(A, 'PUT', '/api/schedules/monthly', { ...S, year: Y1, month: M1, data: { ...pubDoc.data, assignments: newAsg, roster: { ...(pubDoc.data.roster || {}), namedAssignments: named } }, baseRevision: pubDoc.revision, opId: `op-k9-${cid}` });
  await ackAll();
  const usersAB = [sb.creds.nurse1.id, sb.creds.nurse2.id].map((x) => new ObjectId(x));
  const before = await db.collection('notifications').countDocuments({ userId: { $in: usersAB }, title: /sürüm 2/ });
  const [pa, pb] = await Promise.all([
    call(A, 'POST', '/api/schedules/publish', { ...S, year: Y1, month: M1 }),
    call(P, 'POST', '/api/schedules/publish', { ...S, year: Y1, month: M1 }),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  const notifs = await db.collection('notifications').find({ userId: { $in: usersAB }, title: /sürüm 2/ }).toArray();
  const pubV2 = await db.collection('schedulechanges').countDocuments({ hospitalId: HA, kind: 'publish', publishVersion: 2 });
  const perUser = usersAB.map((u) => notifs.filter((n) => String(n.userId) === String(u)).length);
  const winner = [pa, pb].find((r) => r.body?.version === 2 && !r.body?.alreadyPublished) || pa;
  check('K9', 'Revizyonda eski ve yeni kişi doğru belirlenir (çıkarılan + eklenen)', !!target && !toBusy && sv.status === 200 && winner.body?.revision?.affected === 2 && perUser.every((c) => c >= 1),
    target ? `${tDate} ${sb.people[fromIdx]} → ${sb.people[toIdx]}; etkilenen ${winner.body?.revision?.affected}, bildirim (h1, h2) = ${perUser.join(', ')}` : 'hemşire 1/2 için görev bulunamadı');
  check('K10', 'Eş zamanlı iki yayın isteği → tek yayın kaydı, bildirim çoğalmaz', [pa, pb].every((r) => r.status === 200) && before === 0 && perUser.every((c) => c === 1)
    && pubV2 === 1 && [pa, pb].filter((r) => r.body?.alreadyPublished).length === 1,
    `yayın yanıtları ${pa.status}/${pb.status} (${[pa, pb].map((r) => r.body?.alreadyPublished ? 'zaten yayınlı' : `v${r.body?.version}`).join(' / ')}); geçmişte sürüm 2 kaydı ${pubV2}; kişi başı bildirim ${perUser.join(', ')}`);

  // K11 yetki ve kurum yalıtımı
  const reqId = String(rReq._id);
  const t1 = await call(B, 'GET', `/api/schedules/monthly?${qs(Y1, M1)}`);
  const t2 = await call(B, 'PUT', `/api/requests/${reqId}`, { status: 'rejected' });
  const t3 = await call(B, 'GET', `/api/schedules/changes?${qs(Y1, M1)}`);
  const u1 = await call(N2, 'PUT', '/api/duty-rules/policy', { sectionId: SECTION, values: { ...RULES, MIN_REST_HOURS: 1 } });
  const u2 = await call(N2, 'PUT', `/api/requests/${reqId}`, { status: 'rejected' });
  const u3 = await call(null, 'GET', `/api/schedules/monthly?${qs(Y1, M1)}`);
  const leakB = (t1.body?.schedule?.data?.assignments || []).length > 0 || (t3.body?.items || []).length > 0;
  const stillApproved = (await db.collection('requests').findOne({ _id: new ObjectId(reqId) }))?.status === 'approved';
  check('K11', 'Başka kurum ve yetkisiz kullanıcı veriye erişemez / değiştiremez', !leakB && [403, 404].includes(t2.status) && [403].includes(u1.status) && [403].includes(u2.status) && u3.status === 401 && stillApproved,
    `B plan okuma ${t1.status} (veri ${leakB ? 'SIZDI' : 'yok'}), B talep ${t2.status}, B geçmiş ${t3.status}; personel kural ${u1.status}, personel onay ${u2.status}; oturumsuz ${u3.status}`);
}

// ─────────── Ana akış ───────────
const { conn, db, target, host, marker } = await connectTarget({ argv: [`--target=${TARGET}`] });
console.log(`Hedef ${target}: API ${API}, veritabanı ${host} (işaret ${marker})`);
let code = 0;
try {
  const removed = await cleanup(db);
  if (removed) console.log(`Önceki sentetik kum temizlendi (${removed} kayıt)`);
  if (process.env.E2E_CLEANUP_ONLY === '1') process.exit(0);
  const sb = await seed(conn);
  console.log(`Sentetik kum: 2 kurum, 10 kişi, 5 hesap (giriş bilgileri dosyada, ekrana yazılmadı)`);
  await scenarios(sb, db);
} catch (e) {
  console.error('HATA:', e.message);
  code = 1;
} finally {
  if (process.env.E2E_KEEP !== '1') {
    const n = await cleanup(db);
    console.log(`Sentetik kum silindi (${n} kayıt)`);
    try { fs.rmSync(CRED_OUT, { force: true }); } catch { /* yok */ }
  } else {
    console.log('E2E_KEEP=1 → sentetik kum ve giriş dosyası bırakıldı');
  }
  await conn.close();
}
const ok = results.filter((r) => r.ok).length;
console.log(`\nSONUÇ (${TARGET}, commit ${env.commit || '?'}): ${ok}/${results.length} geçti`);
const outDir = path.join(here, '../../docs/e2e-sonuclari');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `kritik-${TARGET}.json`), JSON.stringify({ ...env, at: new Date().toISOString(), results }, null, 2));
process.exit(code || (ok === results.length ? 0 : 1));
