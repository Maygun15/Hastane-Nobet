const { checkSecrets, summarizeSteps, buildStatusUpdate, presentStatus } = require('../scripts/lib/backupResult');

const URI = 'mongodb+srv://kullanici:gizli-parola@ornek.mongodb.net/hastane';
const PASS = 'x'.repeat(32);

describe('yedek ön kontrolü — ayrı hata mesajları, değer yazılmaz', () => {
  test('ikisi de tanımlı → geçer', () => {
    expect(checkSecrets({ STAGING_MONGODB_URI: URI, BACKUP_PASSPHRASE: PASS })).toEqual({ ok: true, errors: [] });
  });
  test('MongoDB secret eksik', () => {
    const r = checkSecrets({ BACKUP_PASSPHRASE: PASS });
    expect(r.errors.map((e) => e.code)).toEqual(['MONGO_SECRET_MISSING']);
    expect(r.errors[0].message).toMatch(/MongoDB secret eksik/);
  });
  test('yedek parolası eksik', () => {
    const r = checkSecrets({ STAGING_MONGODB_URI: URI });
    expect(r.errors.map((e) => e.code)).toEqual(['PASSPHRASE_MISSING']);
    expect(r.errors[0].message).toMatch(/Yedek parolası eksik/);
  });
  test('parola 32 karakterden kısa', () => {
    const r = checkSecrets({ STAGING_MONGODB_URI: URI, BACKUP_PASSPHRASE: 'kisa-parola-123' });
    expect(r.errors.map((e) => e.code)).toEqual(['PASSPHRASE_TOO_SHORT']);
    expect(r.errors[0].message).toMatch(/32 karakterden kısa/);
  });
  test('ikisi de eksik → iki ayrı hata', () => {
    expect(checkSecrets({}).errors.map((e) => e.code)).toEqual(['MONGO_SECRET_MISSING', 'PASSPHRASE_MISSING']);
  });
  test('geçersiz adres biçimi', () => {
    expect(checkSecrets({ STAGING_MONGODB_URI: 'https://x', BACKUP_PASSPHRASE: PASS }).errors[0].code).toBe('MONGO_SECRET_INVALID');
  });
  test('aynı adla Variable varsa Secrets/Variables uyarısı', () => {
    const r = checkSecrets({ HAS_VAR_URI: 'true', BACKUP_PASSPHRASE: PASS });
    expect(r.errors[0].message).toMatch(/Variable/);
  });
  test('hiçbir mesaj değeri içermez', () => {
    const all = [
      checkSecrets({ STAGING_MONGODB_URI: URI, BACKUP_PASSPHRASE: 'kisa-parola-123' }),
      checkSecrets({ STAGING_MONGODB_URI: 'http://kullanici:gizli-parola@x', BACKUP_PASSPHRASE: PASS }),
    ].flatMap((r) => r.errors.map((e) => e.message)).join(' ');
    expect(all).not.toMatch(/gizli-parola|kisa-parola|ornek\.mongodb/);
  });
});

describe('adım özeti', () => {
  test('tümü başarılı', () => {
    expect(summarizeSteps('secrets:success,dump:success,artifact:success')).toMatchObject({ ok: true, failedStep: null });
  });
  test('ilk geçmeyen adım bildirilir; atlanan da geçmemiş sayılır', () => {
    expect(summarizeSteps('secrets:success,dump:success,enc:failure,restore:skipped')).toMatchObject({ ok: false, failedStep: 'enc', failedLabel: 'şifreleme' });
    expect(summarizeSteps('secrets:success,artifact:skipped')).toMatchObject({ ok: false, failedStep: 'artifact' });
  });
  test('boş adım listesi başarı sayılmaz', () => {
    expect(summarizeSteps('').ok).toBe(false);
  });
});

describe('durum kaydı — son deneme ile son başarılı yedek ayrı', () => {
  const now = new Date('2026-11-24T02:40:00Z');
  test('başarılı deneme ikisini de yazar', () => {
    const set = buildStatusUpdate({ summary: summarizeSteps('dump:success,artifact:success'), runner: 'github:1/1', now,
      info: { backupAt: '2026-11-24T02:31:00Z', backupDocs: '3465', restoredDocs: '3465', restoredIndexes: '190', artifactId: '42' } });
    expect(set.lastAttempt).toMatchObject({ ok: true, runner: 'github:1/1', failedStep: null });
    expect(set.lastSuccess).toMatchObject({ runner: 'github:1/1', docs: 3465, restoredDocs: 3465, restoredIndexes: 190, artifactId: '42' });
  });
  test('başarısız deneme son başarılı yedeğe dokunmaz', () => {
    const set = buildStatusUpdate({ summary: summarizeSteps('secrets:failure,dump:skipped'), runner: 'github:2/1', now });
    expect(set.lastAttempt).toMatchObject({ ok: false, failedStep: 'secrets' });
    expect(set).not.toHaveProperty('lastSuccess');
  });
  test('gösterim: yaş ve bayat uyarısı son başarılı yedeğe göre', () => {
    const d = { lastSuccess: { backupAt: new Date('2026-11-22T02:00:00Z'), runner: 'github:1/1' }, lastAttempt: { at: now, ok: false, failedStep: 'dump' } };
    const v = presentStatus(d, now.getTime());
    expect(v.lastSuccess.ageHours).toBe(49);
    expect(v.stale).toBe(true);
    expect(v.lastAttempt).toMatchObject({ ok: false, failedStep: 'dump' });
  });
  test('eski düz alanlar yalnız lastSuccess yoksa, "legacy" işaretiyle', () => {
    const v = presentStatus({ lastBackupAt: new Date('2026-11-23T08:32:00Z'), lastBackupOk: true, lastRestoreOk: true, lastBackupRunner: 'elle' }, new Date('2026-11-23T10:32:00Z').getTime());
    expect(v.lastSuccess).toMatchObject({ runner: 'elle', legacy: true, ageHours: 2 });
    expect(v.lastAttempt).toBeNull();
    expect(presentStatus(null)).toEqual({ configured: false });
  });
});
