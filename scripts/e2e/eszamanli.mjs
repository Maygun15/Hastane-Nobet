// Senaryo C — iki planlayıcı aynı planı düzenler; tekrarlanan istek; aynı anda iki kayıt.
import { req, check } from './lib.mjs';
import { SCOPE } from './kurallar.mjs';

const qs = (y, m) => new URLSearchParams({ ...SCOPE, year: String(y), month: String(m) }).toString();
const opId = (s) => `op-e2e-${s}-${Date.now().toString(36)}`;

export async function run({ A, B }) {
  console.log('\n── C. Eş zamanlı düzenleme ──');
  const ra = await req(A, 'GET', `/api/schedules/monthly?${qs(2026, 12)}`);
  const rb = await req(B, 'GET', `/api/schedules/monthly?${qs(2026, 12)}`);
  const base = ra.body?.schedule?.revision;
  check('C0 İki oturum aynı plan revizyonunu okur', Number.isFinite(base) && base === rb.body?.schedule?.revision, `revizyon ${base}`);
  const data = ra.body.schedule.data;

  const idA = opId('a');
  const sa = await req(A, 'PUT', '/api/schedules/monthly', { ...SCOPE, year: 2026, month: 12, data, baseRevision: base, opId: idA });
  check('C1 Planlayıcı 1 kaydeder → revizyon artar', sa.status === 200 && sa.body?.schedule?.revision === base + 1, `${base} → ${sa.body?.schedule?.revision}`);

  const sb = await req(B, 'PUT', '/api/schedules/monthly', { ...SCOPE, year: 2026, month: 12, data, baseRevision: base, opId: opId('b') });
  check('C2 Planlayıcı 2 eski revizyonla kaydeder → 409 + kim değiştirdi', sb.status === 409 && sb.body?.code === 'SCHEDULE_REVISION_CONFLICT' && !!sb.body?.updatedByName,
    sb.body?.message?.slice(0, 80));

  const replay = await req(A, 'PUT', '/api/schedules/monthly', { ...SCOPE, year: 2026, month: 12, data, baseRevision: base, opId: idA });
  check('C3 Aynı işlem kimliğiyle tekrar → çoğaltma yok, aynı sonuç', replay.status === 200 && replay.body?.replayed === true && replay.body?.schedule?.revision === base + 1);

  const now = (await req(A, 'GET', `/api/schedules/monthly?${qs(2026, 12)}`)).body.schedule.revision;
  const [x, y] = await Promise.all([
    req(A, 'PUT', '/api/schedules/monthly', { ...SCOPE, year: 2026, month: 12, data, baseRevision: now, opId: opId('x') }),
    req(B, 'PUT', '/api/schedules/monthly', { ...SCOPE, year: 2026, month: 12, data, baseRevision: now, opId: opId('y') }),
  ]);
  const statuses = [x.status, y.status].sort();
  check('C4 Aynı anda iki kayıt: biri başarılı, diğeri 409 (sessiz kayıp yok)', statuses[0] === 200 && statuses[1] === 409, statuses.join(' / '));
}
