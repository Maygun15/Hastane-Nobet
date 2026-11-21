'use strict';
const { redactText, safeError, scrubSentryEvent } = require('../utils/safeLog');

describe('günlük hijyeni', () => {
  test('e-posta, TC / telefon, bağlantı adresi ve jeton maskelenir', () => {
    const s = redactText('kisi@ornek.com 12345678901 05551112233 mongodb+srv://u:p@host/db Bearer abc.def');
    expect(s).not.toMatch(/ornek\.com|12345678901|5551112233|u:p@|abc\.def/);
  });
  test('Mongo çift kayıt hatasında değer değil alan adı yazılır', () => {
    const err = Object.assign(new Error('E11000 duplicate key error dup key: { email: "kisi@ornek.com" }'), { code: 11000, keyValue: { email: 'kisi@ornek.com' } });
    const out = safeError(err);
    expect(JSON.stringify(out)).not.toMatch(/kisi@ornek\.com/);
    expect(out).toMatchObject({ code: 11000, fields: ['email'] });
  });
  test('Sentry olayından gövde, çerez ve yetki başlığı çıkarılır', () => {
    const ev = scrubSentryEvent({ request: { data: { password: 'x' }, cookies: { t: 'y' }, headers: { authorization: 'Bearer z', 'user-agent': 'ua' } }, user: { id: 'u1', email: 'a@b.co' } });
    expect(ev.request.data).toBeUndefined();
    expect(ev.request.cookies).toBeUndefined();
    expect(ev.request.headers.authorization).toBe('<gizli>');
    expect(ev.user).toEqual({ id: 'u1' });
  });
});
