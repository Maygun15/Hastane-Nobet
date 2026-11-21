// Senaryo B — aylar arası: Aralık 2026 sonundaki görevler Ocak 2027 başını etkiler (yıl değişimi).
import { req, check, db } from './lib.mjs';
import { SCOPE } from './kurallar.mjs';

const toMin = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export async function run({ A }) {
  console.log('\n── B. Aylar arası ──');
  const d = await db();
  const dec = await d.collection('monthlyschedules').findOne({ year: 2026, month: 12, serviceId: SCOPE.serviceId, role: SCOPE.role });
  const wh = Object.fromEntries((await d.collection('working_hours').find().toArray()).map((w) => [w.code, w]));
  const lastDay = await d.collection('assignments').find({ date: '2026-12-31', serviceId: SCOPE.serviceId }).toArray();
  const nightOnLast = new Set(lastDay.filter((a) => ['N', 'V2'].includes(a.shiftCode)).map((a) => String(a.personId)));
  const v1OnLast = new Set(lastDay.filter((a) => a.shiftCode === 'V1').map((a) => String(a.personId)));

  const g = await req(A, 'POST', '/api/scheduler/generate', {
    ...SCOPE, year: 2027, month: 1, sync: true, dryRun: true,
    defs: dec?.data?.defs || [], overrides: {},
  });
  const b = g.body?.boundary || {};
  check('B1 Ocak planı önceki dönem görevlerini okur (yıl değişimi)', g.status === 200 && b.status === 'found' && b.priorCount > 0,
    `${b.from} – ${b.to}, ${b.priorCount} görev, geriye ${b.lookbackDays} gün (${JSON.stringify(b.lookbackParts)})`);

  const jan1 = (g.body?.data?.assignments || []).filter((a) => String(a.date).startsWith('2027-01-01'));
  const afterNight = jan1.filter((a) => nightOnLast.has(String(a.personId)));
  check('B2 31 Aralık gece (N/V2) tutan kimse 1 Ocak\'ta yazılmadı', jan1.length > 0 && afterNight.length === 0,
    `31 Ara gece: ${nightOnLast.size} kişi; 1 Oca atama: ${jan1.length}; ihlal: ${afterNight.length}`);
  const restBreach = jan1.filter((a) => {
    if (!v1OnLast.has(String(a.personId))) return false;
    const start = toMin(a.start || a.startTime || wh[a.shiftCode]?.start);
    return start != null && (24 * 60 + start) - 24 * 60 < 11 * 60; // V1 24:00'te biter
  });
  check('B3 31 Aralık V1 (gece yarısı biter) sonrası 11 saatten az dinlenme yok', restBreach.length === 0, `31 Ara V1: ${v1OnLast.size} kişi; ihlal ${restBreach.length}`);

  const apr = await req(A, 'POST', '/api/scheduler/generate', { ...SCOPE, year: 2027, month: 4, sync: true, dryRun: true });
  check('B4 Önceki ay (Mart 2027) yokken durum "missing" ve açıklama', apr.status === 200 && apr.body?.boundary?.status === 'missing', apr.body?.boundary?.message?.slice(0, 70));

  const risks = await req(A, 'GET', `/api/schedules/risks?${new URLSearchParams({ ...SCOPE, year: '2026', month: '12' })}`);
  check('B5 Risk paneli (yayın kontrolü) aynı aylar arası durumu döndürür', risks.status === 200 && !!risks.body?.boundary?.status, risks.body?.boundary?.status);
}
