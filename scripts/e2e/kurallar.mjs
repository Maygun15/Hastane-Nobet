// Senaryo A — kurum kuralları sunucuda merkezi (iki oturum, geçiş, yetki, sürüm, kayıt/yayın).
import { req, check, short, db } from './lib.mjs';

export const SCOPE = { sectionId: 'calisma-cizelgesi', serviceId: '6afa1fff51bd7dbef0fdca37', role: 'Nurse' };
export const LEGACY = { ONE_SHIFT_PER_DAY: true, LEAVE_BLOCK: true, NIGHT_NEXT_DAY_OFF: true, MIN_REST_HOURS: 11, MAX_CONSECUTIVE_DAYS: 6 };
const monthQs = (y, m) => new URLSearchParams({ ...SCOPE, year: String(y), month: String(m) }).toString();

export async function resetRules() {
  const d = await db();
  // Yalnız yerel deneme verisi: kurum kuralı kaydını ve plan kural sürümünü sıfırla.
  await d.collection('dutyrules').deleteMany({ 'policy.revision': { $gte: 1 } });
  await d.collection('monthlyschedules').updateMany({}, { $unset: { ruleContext: '' } });
}

export async function run({ A, B, S }) {
  console.log('\n── A. Kurum kuralları ──');
  await resetRules();
  const q = new URLSearchParams(SCOPE).toString();

  const old = await req(A, 'GET', `/api/schedules/monthly?${monthQs(2026, 12)}`);
  check('A1 Eski plan açılıyor; "kural sürümü bilinmiyor"', old.status === 200 && old.body?.schedule?.rules?.status === 'unknown');

  const gen = { ...SCOPE, year: 2026, month: 12, sync: true, dryRun: true, rules: { MIN_REST_HOURS: 0, ONE_SHIFT_PER_DAY: false } };
  let g = await req(A, 'POST', '/api/scheduler/generate', gen);
  check('A2 Kural tanımsızken planlama 422 + açıklama', g.status === 422 && g.body?.code === 'RULES_NOT_CONFIGURED', g.body?.message?.slice(0, 60));

  const mig = { sectionId: 'calisma-cizelgesi', serviceId: '', role: '', values: LEGACY, migrationKey: 'tarayici-e2e00001' };
  const m1 = await req(A, 'POST', '/api/duty-rules/policy/migrate', mig);
  const m2 = await req(A, 'POST', '/api/duty-rules/policy/migrate', mig);
  check('A3 Tarayıcıdan geçiş kaydı oluşturur (rev 1)', m1.status === 200 && m1.body?.revision === 1, `sürüm ${short(m1.body?.version)}`);
  check('A4 Aynı geçiş tekrarında çoğaltma yok, aynı sürüm', m2.status === 200 && m2.body?.alreadyApplied && m2.body?.version === m1.body?.version);
  const m3 = await req(B, 'POST', '/api/duty-rules/policy/migrate', { ...mig, values: { ...LEGACY, MIN_REST_HOURS: 8 }, migrationKey: 'baska-tarayici-02' });
  check('A5 Farklı tarayıcı değeri sunucunun üzerine yazılmaz; fark görünür', m3.status === 409 && m3.body?.differences?.[0]?.key === 'MIN_REST_HOURS');

  let ea = await req(A, 'GET', `/api/duty-rules/effective?${q}`);
  const eb = await req(B, 'GET', `/api/duty-rules/effective?${q}`);
  check('A6 İki oturum aynı etkin kural sürümünü okur', ea.body?.version && ea.body.version === eb.body?.version, short(ea.body?.version));
  const v1 = ea.body.version;

  const st = await req(S, 'PUT', '/api/duty-rules/policy', { sectionId: 'calisma-cizelgesi', values: { ...LEGACY, MIN_REST_HOURS: 4 } });
  check('A7 Personel (user) kural değiştiremez', st.status === 403);

  g = await req(A, 'POST', '/api/scheduler/generate', gen);
  check('A8 Planlama sunucu kurallarıyla çalışır, sürüm sabitlenir', g.status === 200 && g.body?.ruleContext?.version === v1, `durum ${g.status} ${g.body?.message || ''}`);
  check('A9 Tarayıcı kuralları yok sayılır ve raporlanır',
    g.body?.rules?.MIN_REST_HOURS === 11 && (g.body?.ignoredClientRules || []).some((x) => x.key === 'MIN_REST_HOURS' && x.client === 0));

  const chg = await req(B, 'PUT', '/api/duty-rules/policy', { sectionId: 'calisma-cizelgesi', values: { ...LEGACY, MIN_REST_HOURS: 12 }, sources: { MIN_REST_HOURS: 'kurum' }, expectedRevision: 1 });
  ea = await req(A, 'GET', `/api/duty-rules/effective?${q}`);
  check('A10 Oturum 2 değiştirdi → oturum 1 yeni sürümü görür', chg.status === 200 && ea.body?.version !== v1 && ea.body?.values?.MIN_REST_HOURS === 12, `${short(v1)} → ${short(ea.body?.version)}`);
  const stale = await req(A, 'PUT', '/api/duty-rules/policy', { sectionId: 'calisma-cizelgesi', values: LEGACY, expectedRevision: 1 });
  check('A11 Eski revizyonla kural kaydı 409', stale.status === 409 && stale.body?.code === 'RULES_REVISION_CONFLICT');

  const save = await req(A, 'PUT', '/api/schedules/monthly', { ...SCOPE, year: 2026, month: 12, data: {}, ruleVersion: v1 });
  check('A12 Kurallar planlama sırasında değişti → plan kaydı 409', save.status === 409 && save.body?.code === 'RULE_VERSION_CONFLICT');

  const rv = await req(A, 'POST', '/api/schedules/monthly/revalidate', { ...SCOPE, year: 2026, month: 12 });
  const after = await req(B, 'GET', `/api/schedules/monthly?${monthQs(2026, 12)}`);
  check('A13 Güncel kurallarla doğrulama → plan güncel sürüme bağlı', rv.status === 200 && after.body?.schedule?.rules?.status === 'current', `kural ihlali ${rv.body?.ruleViolations}`);

  // Kurumu sonraki senaryolar için 11 saatlik değere geri al (deneme ortamındaki kurum ayarı).
  const rev = ea.body.layers.find((l) => l.level === 'genel').revision;
  await req(A, 'PUT', '/api/duty-rules/policy', { sectionId: 'calisma-cizelgesi', values: LEGACY, sources: { MIN_REST_HOURS: 'kurum' }, expectedRevision: rev });
}
