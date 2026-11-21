// Senaryo F — izin: rapor yıllık izin bakiyesini etkilemez; 3 günlük yıllık izin düşer;
// tekrar gönderim ve çift onay çoğaltmaz; izinli kişi planlamada atanmaz.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { req, check, db, MONGO } from './lib.mjs';
import { SCOPE } from './kurallar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(here, '../../my-backend-project');

export async function run({ A, S }) {
  console.log('\n── F. İzin, bakiye ve tekrar güvenliği ──');
  const d = await db();
  const hospital = await d.collection('hospitals').findOne();
  await d.collection('leave_types').deleteMany({ code: { $in: ['Y', 'R'] } });
  await d.collection('leavebalances').deleteMany({});
  await d.collection('requests').deleteMany({ message: /^E2E/ });

  // Yönetici izin türlerini API ile tanımlar (kısaltma artık kaydediliyor).
  const y = await req(A, 'POST', '/api/parameters/leave-types', { name: 'YILLIK İZİN', code: 'Y', category: 'annual' });
  const r = await req(A, 'POST', '/api/parameters/leave-types', { name: 'RAPOR', code: 'R', category: 'sick' });
  check('F1 İzin türü kısaltmasıyla kaydedilir; varsayılan "düşülmez"', y.status === 201 && y.body?.data?.code === 'Y' && y.body?.data?.isDeductible === false && r.body?.data?.code === 'R');

  // Kurum izin kuralı taşıması (yerelde): yalnız Y düşülür, 20 gün hak. İki kez çalıştır → aynı sonuç.
  const env = { ...process.env, MONGODB_URI: MONGO };
  const run1 = execFileSync('node', ['scripts/fixLeaveTypes.js', '--apply'], { cwd: backend, env }).toString();
  const run2 = execFileSync('node', ['scripts/fixLeaveTypes.js'], { cwd: backend, env }).toString();
  check('F2 İzin türü taşıması tekrarlanabilir (ikinci kuru çalıştırma: değişiklik yok)', /güncellendi: \d+ izin türü/.test(run1) && /güncellenecek: 0 izin türü, 0 bakiye hakkı, 0 bakiye kimliği/.test(run2),
    run2.trim().split('\n').pop());

  // Personel rapor (2 gün) ve yıllık izin (3 gün) talebi açar; rapor talebini bağlantı kopmuş gibi iki kez gönderir.
  const cid = `req-e2e-${Date.now().toString(36)}`;
  const body = { type: 'izin', leaveTypeCode: 'R', targetDate: '2026-12-14', targetDateEnd: '2026-12-15', message: 'E2E rapor', clientRequestId: cid };
  const r1 = await req(S, 'POST', '/api/requests', body);
  const r2 = await req(S, 'POST', '/api/requests', body);
  const count = await d.collection('requests').countDocuments({ clientRequestId: cid });
  check('F3 Aynı form kimliğiyle tekrar gönderim talebi çoğaltmaz', r1.status === 200 && r2.body?.replayed === true && count === 1, `kayıt sayısı ${count}`);
  const yr = await req(S, 'POST', '/api/requests', { type: 'izin', leaveTypeCode: 'Y', targetDate: '2026-12-21', targetDateEnd: '2026-12-23', message: 'E2E yıllık', clientRequestId: `${cid}-y` });

  // Yönetici onaylar; yıllık izni çift tıklama gibi iki kez onaylar.
  const a1 = await req(A, 'PUT', `/api/requests/${r1.body.request._id}`, { status: 'approved' });
  const a2 = await req(A, 'PUT', `/api/requests/${yr.body.request._id}`, { status: 'approved' });
  const a3 = await req(A, 'PUT', `/api/requests/${yr.body.request._id}`, { status: 'approved' });
  const bal = await d.collection('leavebalances').find({}).toArray();
  const yType = await d.collection('leave_types').findOne({ code: 'Y' });
  const yBal = bal.find((b) => String(b.leaveTypeId) === String(yType._id));
  check('F4 Rapor onayı yıllık izin bakiyesini etkilemez', a1.status === 200 && bal.every((b) => String(b.leaveTypeId) !== 'R'), `bakiye kayıtları: ${bal.map((b) => `${b.leaveTypeName}:${b.used}`).join(', ')}`);
  check('F5 3 günlük yıllık izin düşer (20 → kalan 17); çift onay iki kez düşmez', a2.status === 200 && yBal?.allocated === 20 && yBal?.used === 3 && yBal?.remaining === 17,
    `hak ${yBal?.allocated}, kullanılan ${yBal?.used}, kalan ${yBal?.remaining}; ikinci onay HTTP ${a3.status}`);

  // İzin günleri çizelge verisine işlenir ve planlama izinli kişiyi o günlere yazmaz.
  const leaves = await d.collection('settings').findOne({ key: 'leavesV2', hospitalId: hospital._id });
  const pid = String(r1.body.request.fromPersonId);
  const dec = leaves?.value?.[pid]?.['2026-12'] || {};
  check('F6 Onaylı izin günleri kişi takvimine işlenir (R: 14–15, Y: 21–23)', dec['14']?.code === 'R' && dec['15']?.code === 'R' && dec['21']?.code === 'Y' && dec['23']?.code === 'Y');
  const decDoc = await d.collection('monthlyschedules').findOne({ year: 2026, month: 12, serviceId: SCOPE.serviceId });
  const g = await req(A, 'POST', '/api/scheduler/generate', { ...SCOPE, year: 2026, month: 12, sync: true, dryRun: true, defs: decDoc?.data?.defs || [] });
  const onLeave = (g.body?.data?.assignments || []).filter((a) => String(a.personId) === pid && ['2026-12-14', '2026-12-15', '2026-12-21', '2026-12-22', '2026-12-23'].includes(String(a.date).slice(0, 10)));
  check('F7 Planlama izinli kişiyi izin günlerine atamaz', g.status === 200 && onLeave.length === 0, `izin günlerinde atama: ${onLeave.length}`);
}
