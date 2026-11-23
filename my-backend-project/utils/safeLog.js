'use strict';
// Günlük (log) hijyeni: hata nesnesi ve metinlerden kişisel veri / sır ayıklanır.
// Mongo E11000 hataları `keyValue` (e-posta, TC) taşır; ham `err` yazdırılmaz.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TC_OR_PHONE = /(?<!\d)(?:\+?90)?0?\d{10,11}(?!\d)/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const MONGO_URI = /mongodb(?:\+srv)?:\/\/[^\s"']+/gi;
const ATLAS_HOST = /\b[a-z0-9-]+(?:-shard-\d+-\d+)?\.([a-z0-9]+)\.mongodb\.net\b/gi;
const SECRET_KEYS = /pass(word)?|şifre|token|secret|authorization|cookie|apikey|api_key|tc(no|kn)?$|phone|telefon|email/i;

function redactText(value) {
  return String(value ?? '')
    .replace(MONGO_URI, 'mongodb://<gizli>')
    .replace(ATLAS_HOST, '<küme>.$1.mongodb.net')
    .replace(BEARER, 'Bearer <gizli>')
    .replace(EMAIL, '<e-posta>')
    .replace(TC_OR_PHONE, '<numara>');
}

function redactObject(obj, depth = 0) {
  if (obj == null || typeof obj !== 'object' || depth > 3) return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.test(k)) out[k] = '<gizli>';
    else if (typeof v === 'string') out[k] = redactText(v);
    else out[k] = redactObject(v, depth + 1);
  }
  return out;
}

/** Hata nesnesini güvenli özet hâline getirir (ad, kod, maskelenmiş mesaj, alan adları). */
function safeError(err) {
  if (!err || typeof err !== 'object') return redactText(err);
  const out = { name: err.name, message: redactText(err.message) };
  if (err.code != null) out.code = err.code;
  if (err.keyValue) out.fields = Object.keys(err.keyValue); // değerler değil, yalnız alan adları
  if (err.errors && typeof err.errors === 'object') out.fields = Object.keys(err.errors);
  if (process.env.NODE_ENV !== 'production' && err.stack) out.stack = redactText(err.stack.split('\n').slice(0, 4).join('\n'));
  return out;
}

function logError(tag, err) {
  console.error(tag, safeError(err));
}

/** Sentry beforeSend: istek gövdesi, çerez ve yetki başlıkları gönderilmez. */
function scrubSentryEvent(event) {
  if (event?.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) event.request.headers = redactObject(event.request.headers);
    if (event.request.query_string) event.request.query_string = redactText(event.request.query_string);
  }
  if (event?.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  if (event?.message) event.message = redactText(event.message);
  for (const ex of event?.exception?.values || []) ex.value = redactText(ex.value);
  return event;
}

module.exports = { redactText, redactObject, safeError, logError, scrubSentryEvent };
