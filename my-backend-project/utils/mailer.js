// utils/mailer.js
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch {}

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE = ['1','true','yes'].includes(String(process.env.SMTP_SECURE || '').toLowerCase()) || SMTP_PORT === 465;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

let transporter = null;

function getTransport() {
  if (transporter) return transporter;
  if (!nodemailer) return null;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

function isConfigured() {
  return !!getTransport();
}

async function sendMail({ to, subject, text, html }) {
  if (!nodemailer) return { ok: false, skipped: true, reason: 'nodemailer missing' };
  const t = getTransport();
  if (!t) return { ok: false, skipped: true, reason: 'SMTP not configured' };
  await t.sendMail({ from: SMTP_FROM, to, subject, text, html });
  return { ok: true };
}

module.exports = { sendMail, isConfigured };
