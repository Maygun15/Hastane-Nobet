'use strict';
const { preflight, maskedHost, parseTarget } = require('../scripts/lib/dbTarget');

describe('veritabanı hedef doğrulaması (bağlantı öncesi)', () => {
  test('hedef açıkça verilmeli', () => {
    expect(() => parseTarget(['node', 'x'])).toThrow(/hedef belirtilmeli/);
    expect(parseTarget(['node', 'x', '--target=staging'])).toBe('staging');
  });
  test('deneme hedefi üretim kümesini ya da yereli gösteremez', () => {
    expect(() => preflight('staging', 'mongodb+srv://u:p@hastane.gqsquu8.mongodb.net/x')).toThrow(/üretim/);
    expect(() => preflight('staging', 'mongodb://127.0.0.1:27018')).toThrow(/yerel/);
    expect(preflight('staging', 'mongodb+srv://u:p@deneme.abc12.mongodb.net').host).toBe('<küme>.abc12.mongodb.net');
  });
  test('yerel hedef yalnız localhost; üretim açık izin ister', () => {
    expect(() => preflight('local', 'mongodb+srv://u:p@deneme.abc12.mongodb.net')).toThrow(/localhost/);
    delete process.env.ALLOW_PRODUCTION;
    expect(() => preflight('production', 'mongodb+srv://u:p@hastane.gqsquu8.mongodb.net')).toThrow(/ALLOW_PRODUCTION/);
  });
  test('maskeleme kullanıcı adı, şifre ve küme adını göstermez', () => {
    const m = maskedHost('mongodb+srv://kullanici:sifre@gizlikume.abc12.mongodb.net/db');
    expect(m).not.toMatch(/kullanici|sifre|gizlikume/);
  });
});
