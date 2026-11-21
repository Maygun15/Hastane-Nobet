// Senaryo E — yayın, tekrar yayın, yayından sonra değişiklik, revizyon yayını ve işlem geçmişi.
import { req, check, db } from './lib.mjs';
import { SCOPE } from './kurallar.mjs';

const qs = (y, m) => new URLSearchParams({ ...SCOPE, year: String(y), month: String(m) }).toString();

export async function run({ A, B }) {
  console.log('\n── E. Yayın, revizyon ve işlem geçmişi ──');
  const d = await db();
  // Temiz başlangıç (yalnız yerel): bu kapsamın geçmişini ve yayın kaydını sıfırla.
  await d.collection('schedulechanges').deleteMany({ year: 2026, month: 12 });
  await d.collection('monthlyschedules').updateOne({ year: 2026, month: 12, serviceId: SCOPE.serviceId }, { $unset: { 'publication.contentRevision': '', 'publication.version': '', riskAcks: '' } });
  await req(A, 'POST', '/api/schedules/monthly/revalidate', { ...SCOPE, year: 2026, month: 12 });
  const risks = await req(A, 'GET', `/api/schedules/risks?${qs(2026, 12)}`);
  const pend = (risks.body?.risks || []).filter((r) => !r.acknowledged).map((r) => r.key);
  if (pend.length) await req(A, 'POST', '/api/schedules/risks/ack', { ...SCOPE, year: 2026, month: 12, keys: pend, note: 'E2E' });

  const p1 = await req(A, 'POST', '/api/schedules/publish', { ...SCOPE, year: 2026, month: 12 });
  check('E1 Yayın → sürüm 1', p1.status === 200 && p1.body?.version === 1, `durum ${p1.status} ${p1.body?.message || ''} bildirim ${p1.body?.notified}`);

  const p2 = await req(A, 'POST', '/api/schedules/publish', { ...SCOPE, year: 2026, month: 12 });
  check('E2 Tekrar yayın: değişiklik yok, bildirim yok', p2.status === 200 && p2.body?.alreadyPublished === true && p2.body?.notified === 0);

  // Planlayıcı 2 yayından sonra bir nöbeti boşaltır — düzenleyici gibi isim tablosu (roster)
  // ve atama listesi birlikte güncellenir.
  const cur = (await req(B, 'GET', `/api/schedules/monthly?${qs(2026, 12)}`)).body.schedule;
  const named = JSON.parse(JSON.stringify(cur.data?.roster?.namedAssignments || {}));
  // Bildirim yolunu da kanıtlamak için mümkünse kullanıcı hesabı olan bir kişinin nöbetini seç.
  const withUser = new Set((await d.collection('people').find({ userId: { $ne: null } }).project({ name: 1 }).toArray()).map((p) => p.name));
  let day = '10'; let rowId = Object.keys(named[day] || {}).find((r) => (named[day][r] || []).length); let name = named[day][rowId][0];
  outer: for (const [dd, rows] of Object.entries(named)) for (const [rr, names] of Object.entries(rows)) for (const nn of names || []) {
    if (withUser.has(nn)) { day = dd; rowId = rr; name = nn; break outer; }
  }
  named[day][rowId] = named[day][rowId].filter((n) => n !== name);
  const dateStr = `2026-12-${String(day).padStart(2, '0')}`;
  const norm = (v) => String(v || '').trim().toLocaleUpperCase('tr-TR');
  const data = {
    ...cur.data,
    roster: { ...cur.data.roster, namedAssignments: named },
    assignments: cur.data.assignments.filter((a) => !(String(a.date).startsWith(dateStr) && String(a.shiftId || a.rowId) === rowId && norm(a.personName) === norm(name))),
  };
  const ed = await req(B, 'PUT', '/api/schedules/monthly', { ...SCOPE, year: 2026, month: 12, data, baseRevision: cur.revision, opId: `op-e2e-edit-${Date.now()}` });
  const after = (await req(A, 'GET', `/api/schedules/monthly?${qs(2026, 12)}`)).body.schedule;
  check('E3 Yayından sonra değişiklik → "yayınlanmamış değişiklik var"', ed.status === 200 && after.hasUnpublishedChanges === true);

  const ch = await req(A, 'GET', `/api/schedules/changes?${qs(2026, 12)}`);
  const edit = (ch.body?.items || []).find((i) => i.kind === 'edit');
  check('E4 İşlem geçmişi kim / hangi nöbet / ne zaman', !!edit && edit.removedCount >= 1 && !!edit.byName && !!edit.at && edit.removed?.[0]?.date === dateStr,
    edit ? `${edit.byName} · −${edit.removedCount} (${edit.removed?.[0]?.date} ${edit.removed?.[0]?.shiftCode} ${edit.removed?.[0]?.personName})` : 'kayıt yok');

  // Çıkarılan nöbet yeni bir boş görev riski doğurur: yayın önce yönetici kararını ister.
  const r2 = await req(A, 'GET', `/api/schedules/risks?${qs(2026, 12)}`);
  const pend2 = (r2.body?.risks || []).filter((r) => !r.acknowledged).map((r) => r.key);
  const blocked = await req(A, 'POST', '/api/schedules/publish', { ...SCOPE, year: 2026, month: 12 });
  check('E5a Kararsız risk varken revizyon yayını engellenir', pend2.length > 0 && blocked.status === 409 && blocked.body?.code === 'RISKS_PENDING', `${pend2.length} yeni risk`);
  if (pend2.length) await req(A, 'POST', '/api/schedules/risks/ack', { ...SCOPE, year: 2026, month: 12, keys: pend2, note: 'E2E: bilinçli boş bırakıldı' });

  const before = await d.collection('notifications').countDocuments();
  const p3 = await req(A, 'POST', '/api/schedules/publish', { ...SCOPE, year: 2026, month: 12 });
  await new Promise((r) => setTimeout(r, 500));
  const notifDelta = (await d.collection('notifications').countDocuments()) - before;
  const person = await d.collection('people').findOne({ name: name });
  const expected = person?.userId ? 1 : 0;
  check('E5 Değişiklikleri yayınla → sürüm 2, yalnız etkilenene bildirim', p3.status === 200 && p3.body?.version === 2 && p3.body?.revision?.removed >= 1
    && p3.body?.notified === expected && notifDelta === expected,
    `etkilenen ${p3.body?.revision?.affected} (${name}, hesabı ${expected ? 'var' : 'yok'}) → bildirim ${p3.body?.notified}, yeni bildirim kaydı ${notifDelta}`);
  const final = (await req(A, 'GET', `/api/schedules/monthly?${qs(2026, 12)}`)).body.schedule;
  const ch2 = await req(A, 'GET', `/api/schedules/changes?${qs(2026, 12)}`);
  const pubs = (ch2.body?.items || []).filter((i) => i.kind === 'publish').map((i) => i.publishVersion);
  check('E6 Kayıt, yayın ve geçmiş tutarlı (sürüm 1, 2; bekleyen değişiklik yok)', final.hasUnpublishedChanges === false && final.publication?.version === 2 && pubs.includes(1) && pubs.includes(2),
    `yayın sürümleri ${pubs.join(',')}; içerik rev ${final.revision} = yayın rev ${final.publication?.contentRevision}`);

  // Personel kendi nöbetini değiştiremez (sunucu yetkisi).
}
