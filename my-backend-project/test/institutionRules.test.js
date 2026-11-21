'use strict';

/**
 * Kurum kuralları (İP-1): sunucudaki kayıt yetkili kaynaktır.
 * Kapsanan senaryolar:
 *  - aynı kapsamı okuyan iki oturum aynı etkin sürümü görür; değişiklikten sonra yeni sürüm
 *  - katmanlama (genel → servis), kaynak ("belirsiz" görünür), doğrulama
 *  - yetki: personel / başka servisin yetkilisi / genel katmanda yetkili → 403; hastane süzgeci
 *  - revizyon çakışması (409)
 *  - tarayıcıdan geçiş: tekrar çalıştırmada aynı sonuç, mevcut kayıt üzerine yazılmaz
 *  - planlama: istemci kuralları yok sayılır, sunucu değerleri motora gider; eksik zorunlu → 422
 *  - kaydetme: kural sürümü değiştiyse 409
 */

// ── Basit bellek içi DutyRule (findOne + findOneAndUpdate; Mongo nokta yolu $set) ──
const mockStore = [];
function mockMatches(doc, filter) {
  for (const [k, v] of Object.entries(filter)) {
    if (k === '$or') {
      if (!v.some((f) => mockMatches(doc, f))) return false;
      continue;
    }
    const actual = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), doc);
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('$gte' in v && !(Number(actual) >= v.$gte)) return false;
      if ('$lt' in v && !(Number(actual) < v.$lt)) return false;
      if ('$exists' in v && (actual !== undefined) !== v.$exists) return false;
      continue;
    }
    if (String(actual ?? '') !== String(v ?? '')) return false;
  }
  return true;
}
function mockSetPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === 'object' ? o[parts[i]] : {};
    o = o[parts[i]];
  }
  o[parts.at(-1)] = value;
}
const mockClone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const mockLean = (value) => ({ lean: () => Promise.resolve(mockClone(value)) });

jest.mock('../models/DutyRule', () => ({
  findOne: jest.fn((filter) => mockLean(mockStore.find((d) => mockMatches(d, filter)) || null)),
  findOneAndUpdate: jest.fn((filter, update, opts = {}) => {
    let doc = mockStore.find((d) => mockMatches(d, filter));
    if (!doc) {
      if (!opts.upsert) return mockLean(null);
      doc = { _id: `rule-${mockStore.length + 1}` };
      for (const [k, v] of Object.entries(filter)) if (!k.startsWith('$') && !k.includes('.')) doc[k] = v;
      for (const [k, v] of Object.entries(update.$setOnInsert || {})) mockSetPath(doc, k, v);
      mockStore.push(doc);
    }
    for (const [k, v] of Object.entries(update.$set || {})) mockSetPath(doc, k, v);
    return mockLean(doc);
  }),
}));

const institutionRules = require('../services/institutionRules');
const dutyRulesRouter = require('../routes/dutyRules.routes');

const H1 = 'hospital-1';
const H2 = 'hospital-2';
const ADMIN = { uid: 'u-admin', name: 'Sorumlu Admin', role: 'admin', serviceIds: [] };
const STAFF_A = { uid: 'u-staff', name: 'Servis Yetkilisi', role: 'staff', serviceIds: ['svc-a'] };
const NURSE = { uid: 'u-nurse', name: 'Hemşire', role: 'user', serviceIds: ['svc-a'] };
const FULL = { ONE_SHIFT_PER_DAY: true, LEAVE_BLOCK: true, NIGHT_NEXT_DAY_OFF: true, MIN_REST_HOURS: 11, MAX_CONSECUTIVE_DAYS: 6 };
// Testlerde kullanılan değerler, deneme ortamındaki mevcut kurum ayarı ve kural ekranındaki
// "11 saat dinlenme / 6 ardışık gün" tanımlarıdır (docs/KURAL_ENVANTERI.md). Yeni sayı eklenmedi.

function route(method, path) {
  const layer = dutyRulesRouter.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack.map((x) => x.handle);
}
function call(method, path, { user = ADMIN, hospitalId = H1, body = {}, query = {} } = {}) {
  const handlers = route(method, path);
  const req = { method: method.toUpperCase(), body, query, params: {}, user, hospitalId };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    let i = 0;
    const next = (err) => {
      if (err) return reject(err);
      const h = handlers[i++];
      if (!h) return resolve({ status: res.statusCode, body: null });
      return Promise.resolve(h(req, res, next)).catch(reject);
    };
    next();
  });
}

beforeEach(() => {
  mockStore.length = 0;
  jest.clearAllMocks();
});

describe('doğrulama', () => {
  test('tip, aralık ve bilinmeyen anahtar reddedilir; kaynağı verilmeyen "belirsiz" olur', () => {
    const bad = institutionRules.validatePolicyInput({ values: { MIN_REST_HOURS: 99, ONE_SHIFT_PER_DAY: 'evet', FOO: 1 } });
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.key).sort()).toEqual(['FOO', 'MIN_REST_HOURS', 'ONE_SHIFT_PER_DAY']);
    const good = institutionRules.validatePolicyInput({ values: { MIN_REST_HOURS: '11', LEAVE_BLOCK: true }, sources: { LEAVE_BLOCK: 'kurum' } });
    expect(good.ok).toBe(true);
    expect(good.values).toEqual({ MIN_REST_HOURS: 11, LEAVE_BLOCK: true });
    expect(good.sources).toEqual({ MIN_REST_HOURS: 'belirsiz', LEAVE_BLOCK: 'kurum' });
  });
});

describe('etkin kurallar ve sürüm', () => {
  test('iki oturum aynı kapsam için aynı sürümü okur; yetkili değişiklikten sonra ikisi de yeni sürümü görür', async () => {
    const save = await call('put', '/policy', { body: { sectionId: 'calisma-cizelgesi', values: FULL, sources: { MIN_REST_HOURS: 'kurum' } } });
    expect(save.status).toBe(200);
    const q = { sectionId: 'calisma-cizelgesi', serviceId: 'svc-a', role: 'Nurse' };
    const s1 = await call('get', '/effective', { user: ADMIN, query: q });
    const s2 = await call('get', '/effective', { user: STAFF_A, query: q });
    expect(s1.body.version).toBeTruthy();
    expect(s1.body.version).toBe(s2.body.version);
    expect(s1.body.complete).toBe(true);

    const change = await call('put', '/policy', { body: { sectionId: 'calisma-cizelgesi', values: { ...FULL, MIN_REST_HOURS: 12 }, expectedRevision: 1 } });
    expect(change.status).toBe(200);
    const s2b = await call('get', '/effective', { user: STAFF_A, query: q });
    expect(s2b.body.version).not.toBe(s1.body.version);
    expect(s2b.body.values.MIN_REST_HOURS).toBe(12);
    expect(s2b.body.layers[0]).toMatchObject({ level: 'genel', revision: 2, updatedByName: 'Sorumlu Admin' });
  });

  test('servis katmanı genel değeri kural bazında ezer; kaynak ve köken görünür', async () => {
    await call('put', '/policy', { body: { values: FULL, sources: { MIN_REST_HOURS: 'kurum' } } });
    await call('put', '/policy', { user: STAFF_A, body: { serviceId: 'svc-a', values: { MAX_CONSECUTIVE_DAYS: 5 } } });
    const r = await institutionRules.resolveInstitutionRules({ hospitalId: H1, sectionId: 'calisma-cizelgesi', serviceId: 'svc-a', role: 'Nurse' });
    expect(r.values.MAX_CONSECUTIVE_DAYS).toBe(5);
    expect(r.origin).toMatchObject({ MAX_CONSECUTIVE_DAYS: 'servis', MIN_REST_HOURS: 'genel' });
    expect(r.sources).toMatchObject({ MIN_REST_HOURS: 'kurum', MAX_CONSECUTIVE_DAYS: 'belirsiz' });
    // başka servis yalnız genel katmanı görür
    const other = await institutionRules.resolveInstitutionRules({ hospitalId: H1, sectionId: 'calisma-cizelgesi', serviceId: 'svc-b', role: 'Nurse' });
    expect(other.values.MAX_CONSECUTIVE_DAYS).toBe(6);
    expect(other.version).not.toBe(r.version);
  });

  test('kayıt yoksa / zorunlu eksikse açıklayıcı hata', async () => {
    const none = await institutionRules.resolveInstitutionRules({ hospitalId: H1, sectionId: 'calisma-cizelgesi' });
    expect(() => institutionRules.assertRulesReady(none)).toThrow(expect.objectContaining({ code: 'RULES_NOT_CONFIGURED', status: 422 }));
    await call('put', '/policy', { body: { values: { LEAVE_BLOCK: true } } });
    const partial = await institutionRules.resolveInstitutionRules({ hospitalId: H1, sectionId: 'calisma-cizelgesi' });
    let err;
    try { institutionRules.assertRulesReady(partial); } catch (e) { err = e; }
    expect(err.code).toBe('RULES_INCOMPLETE');
    expect(err.missingRequired).toEqual(expect.arrayContaining(['MIN_REST_HOURS', 'MAX_CONSECUTIVE_DAYS']));
    expect(err.message).toMatch(/İki vardiya arası en az dinlenme/);
  });
});

describe('yetki ve hastane ayrımı', () => {
  test('personel (user) hiçbir kuralı değiştiremez', async () => {
    const r = await call('put', '/policy', { user: NURSE, body: { serviceId: 'svc-a', values: FULL } });
    expect(r.status).toBe(403);
  });
  test('yetkili genel katmanı ve başka servisi değiştiremez, kendi servisini değiştirebilir', async () => {
    expect((await call('put', '/policy', { user: STAFF_A, body: { values: FULL } })).status).toBe(403);
    expect((await call('put', '/policy', { user: STAFF_A, body: { serviceId: 'svc-b', values: FULL } })).status).toBe(403);
    expect((await call('put', '/policy', { user: STAFF_A, body: { serviceId: 'svc-a', values: FULL } })).status).toBe(200);
  });
  test('başka hastanenin kullanıcısı bu hastanenin kaydını görmez ve değiştiremez', async () => {
    await call('put', '/policy', { hospitalId: H1, body: { values: FULL } });
    const other = await call('get', '/effective', { hospitalId: H2, query: {} });
    expect(other.body.configured).toBe(false);
    // H2 yöneticisinin yazdığı kayıt ayrı belge olur; H1 değişmez
    await call('put', '/policy', { hospitalId: H2, body: { values: { ...FULL, MIN_REST_HOURS: 8 } } });
    const h1 = await institutionRules.resolveInstitutionRules({ hospitalId: H1, sectionId: 'calisma-cizelgesi' });
    expect(h1.values.MIN_REST_HOURS).toBe(11);
    expect(mockStore.filter((d) => d.sectionId === 'calisma-cizelgesi')).toHaveLength(2);
  });
  test('eski revizyonla kaydetme 409 döner, güncel değerler yanıtta', async () => {
    await call('put', '/policy', { body: { values: FULL } });
    await call('put', '/policy', { body: { values: { ...FULL, MIN_REST_HOURS: 12 }, expectedRevision: 1 } });
    const stale = await call('put', '/policy', { body: { values: { ...FULL, MIN_REST_HOURS: 10 }, expectedRevision: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('RULES_REVISION_CONFLICT');
    expect(stale.body.current.values.MIN_REST_HOURS).toBe(12);
  });
  test('geçersiz değer 400 + alan bazlı hata', async () => {
    const r = await call('put', '/policy', { body: { values: { MIN_REST_HOURS: -1 } } });
    expect(r.status).toBe(400);
    expect(r.body.errors[0].key).toBe('MIN_REST_HOURS');
  });
});

describe('tarayıcıdan geçiş', () => {
  const body = { sectionId: 'calisma-cizelgesi', values: FULL, migrationKey: 'tarayici-abc12345' };
  test('ilk aktarım kaydı oluşturur; aynı anahtarla tekrar çağrı çoğaltmaz', async () => {
    const first = await call('post', '/policy/migrate', { body });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ migrated: true, revision: 1 });
    const again = await call('post', '/policy/migrate', { body });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ alreadyApplied: true, revision: 1 });
    expect(again.body.version).toBe(first.body.version);
    expect(mockStore).toHaveLength(1);
  });
  test('sunucuda kayıt varken başka tarayıcı değerleri üzerine yazılmaz; farklar döner', async () => {
    await call('put', '/policy', { body: { values: FULL } });
    const r = await call('post', '/policy/migrate', { body: { ...body, values: { ...FULL, MIN_REST_HOURS: 8 }, migrationKey: 'baska-tarayici-999' } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('RULES_ALREADY_EXIST');
    expect(r.body.differences).toEqual([{ key: 'MIN_REST_HOURS', browser: 8, server: 11 }]);
    const after = await institutionRules.resolveInstitutionRules({ hospitalId: H1, sectionId: 'calisma-cizelgesi' });
    expect(after.values.MIN_REST_HOURS).toBe(11);
  });
});

describe('istemci değerleri sunucuyu aşamaz', () => {
  test('diffClientRules farkı raporlar; toSchedulerRules yalnız sunucu değerlerini verir', async () => {
    await call('put', '/policy', { body: { values: FULL } });
    const resolved = await institutionRules.resolveInstitutionRules({ hospitalId: H1, sectionId: 'calisma-cizelgesi' });
    const client = { MIN_REST_HOURS: 0, ONE_SHIFT_PER_DAY: false, NIGHT_NEXT_DAY_OFF: true };
    expect(institutionRules.diffClientRules(client, resolved)).toEqual([
      { key: 'ONE_SHIFT_PER_DAY', client: false, server: true },
      { key: 'MIN_REST_HOURS', client: 0, server: 11 },
    ]);
    expect(institutionRules.toSchedulerRules(resolved)).toEqual(FULL);
  });
});
