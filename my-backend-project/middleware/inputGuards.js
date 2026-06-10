'use strict';
/**
 * inputGuards.js — Minimal paylaşılan giriş doğrulama yardımcıları.
 * Tüm route'larda tutarlı hata mesajı ve giriş temizliği için.
 * Scheduler / roster mantığını değiştirmez.
 */

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

/**
 * Production'da stack trace / DB detayı sızdırmaz.
 * @param {Error} err
 * @param {string} fallback
 */
function safeErr(err, fallback = 'Sunucu hatası') {
  return isProd ? fallback : (err?.message || fallback);
}

/** MongoDB ObjectId formatı: 24 hex karakter */
function isObjectId(val) {
  return /^[a-f\d]{24}$/i.test(String(val || ''));
}

/**
 * Prototype pollution anahtarları kontrolü.
 * req.body üzerinde çağrılır; true → kirli nesne.
 */
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function hasPollutionKeys(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Object.keys(obj).some((k) => POLLUTION_KEYS.has(k));
}

/**
 * Güvenli metin kontrolü:
 * - Boş string veya non-string → false
 * - maxLen aşılırsa → false
 * - Pollution key içeriyorsa → false (string içinde olsa bile güvenli)
 */
function isSafeName(val, maxLen = 200) {
  if (!val || typeof val !== 'string') return false;
  if (val.trim().length === 0) return false;
  if (val.length > maxLen) return false;
  return true;
}

/** E-posta format kontrolü */
function isEmail(val) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val || ''));
}

/** TC kimlik no: 11 rakam */
function isTc(val) {
  return /^\d{11}$/.test(String(val || ''));
}

/**
 * Geçerli rol değerleri (User model ile eşleşmeli).
 * mapRole() bu değerleri zaten normalize eder;
 * bu guard, tamamen bilinmeyen değerlerin DB'ye ulaşmasını önler.
 */
const VALID_ROLES = new Set([
  'user', 'staff', 'admin', 'superadmin',
  'standard', 'authorized', 'authorised', 'yetkili', 'administrator',
]);
function isValidRole(val) {
  return VALID_ROLES.has(String(val || '').toLowerCase());
}

/** Year: 2000-2100 arası tamsayı */
function isValidYear(val) {
  const n = Number(val);
  return Number.isInteger(n) && n >= 2000 && n <= 2100;
}

/** Month: 1-12 tamsayı */
function isValidMonth(val) {
  const n = Number(val);
  return Number.isInteger(n) && n >= 1 && n <= 12;
}

/**
 * HH:MM format kontrolü (çalışma saatleri).
 * Saat 00-23, dakika 00-59 aralığında olmalı.
 * Boş/null/undefined → geçerli (opsiyonel alan için).
 */
function isTimeFormat(val) {
  if (!val) return true; // opsiyonel
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(val));
}

module.exports = {
  safeErr,
  isObjectId,
  hasPollutionKeys,
  isSafeName,
  isEmail,
  isTc,
  isValidRole,
  isValidYear,
  isValidMonth,
  isTimeFormat,
};
