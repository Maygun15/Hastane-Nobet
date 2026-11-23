// Otomatik yedek iş akışının saf karar işlevleri (test: test/backupResult.test.js).
// Gizli değerler hiçbir çıktıya yazılmaz; yalnız var/yok ve biçim sonucu döner.
'use strict';

const MIN_PASSPHRASE = 32;

/**
 * Ön kontrol: her eksik ayrı, anlaşılır bir hata kodu ve mesajı üretir.
 * @param env  { STAGING_MONGODB_URI, BACKUP_PASSPHRASE, HAS_VAR_URI, HAS_VAR_PASSPHRASE }
 *             HAS_VAR_* : aynı adla "Variable" tanımlı mı ("true"/"false") — Secrets/Variables karışıklığı için.
 */
function checkSecrets(env = {}) {
  const errors = [];
  const uri = String(env.STAGING_MONGODB_URI || '');
  const pass = String(env.BACKUP_PASSPHRASE || '');
  const hint = (isVar) => (isVar === 'true'
    ? ' Aynı adla bir Variable (değişken) var; değer Secrets sekmesine "Repository secret" olarak girilmeli.'
    : ' Settings → Secrets and variables → Actions → "Repository secrets" altında tanımlanmalı (environment secret bu işe bağlı değildir).');
  if (!uri.trim()) errors.push({ code: 'MONGO_SECRET_MISSING', message: `MongoDB secret eksik: STAGING_MONGODB_URI boş.${hint(env.HAS_VAR_URI)}` });
  else if (!/^mongodb(\+srv)?:\/\//.test(uri.trim())) errors.push({ code: 'MONGO_SECRET_INVALID', message: 'MongoDB secret biçimi geçersiz: STAGING_MONGODB_URI "mongodb://" ya da "mongodb+srv://" ile başlamalı.' });
  if (!pass) errors.push({ code: 'PASSPHRASE_MISSING', message: `Yedek parolası eksik: BACKUP_PASSPHRASE boş.${hint(env.HAS_VAR_PASSPHRASE)}` });
  else if (pass.length < MIN_PASSPHRASE) errors.push({ code: 'PASSPHRASE_TOO_SHORT', message: `Yedek parolası ${MIN_PASSPHRASE} karakterden kısa: BACKUP_PASSPHRASE.` });
  return { ok: errors.length === 0, errors };
}

const STEP_LABELS = {
  secrets: 'gizli değer ön kontrolü', tools: 'veritabanı araçları', dump: 'yedek alma', enc: 'şifreleme',
  restore: 'ayrı veritabanına geri yükleme ve veri/dizin doğrulaması', smoke: 'uygulamanın geri yüklenen veriyi okuması',
  artifact: 'şifreli yedeğin artifact olarak yüklenmesi', download: 'artifact geri indirme', artifactCheck: 'indirilen dosyanın SHA-256 karşılaştırması',
};

/** "secrets:success,dump:failure,…" → { ok, failedStep, failedLabel, steps } — ilk başarısız/atlanan adım. */
function summarizeSteps(spec) {
  const steps = String(spec || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, outcome = ''] = s.split(':');
    return { name, outcome: outcome || 'unknown' };
  });
  const bad = steps.find((s) => s.outcome !== 'success');
  return { ok: steps.length > 0 && !bad, failedStep: bad ? bad.name : null, failedLabel: bad ? (STEP_LABELS[bad.name] || bad.name) : null, steps };
}

/**
 * ops_meta.backupStatus için $set. Son deneme her zaman yazılır; son başarılı yedek yalnız
 * tüm adımlar (artifact dahil) geçtiyse güncellenir — başarısız deneme eski başarıyı silmez.
 */
function buildStatusUpdate({ summary, runner, runUrl = null, now = new Date(), info = {} }) {
  const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const set = {
    lastAttempt: { at: now, ok: summary.ok, runner, runUrl, failedStep: summary.failedStep, failedLabel: summary.failedLabel },
  };
  if (summary.ok) {
    set.lastSuccess = {
      backupAt: info.backupAt ? new Date(info.backupAt) : now, verifiedAt: now, runner, runUrl,
      docs: num(info.backupDocs), restoredDocs: num(info.restoredDocs), restoredCollections: num(info.restoredCollections),
      restoredIndexes: num(info.restoredIndexes), artifactId: info.artifactId || null,
    };
  }
  return set;
}

/** /api/version gösterimi. Eski düz alanlar (elle yapılan çalıştırmalar) yalnız lastSuccess yoksa kullanılır. */
function presentStatus(d, now = Date.now()) {
  if (!d) return { configured: false };
  const legacy = !d.lastSuccess && d.lastBackupAt && d.lastRestoreOk
    ? { backupAt: d.lastBackupAt, verifiedAt: d.lastRestoreCheckAt || null, runner: d.lastBackupRunner || 'elle', docs: d.lastBackupDocs ?? null, restoredDocs: d.lastRestoreDocs ?? null, artifactId: null, legacy: true }
    : null;
  const s = d.lastSuccess || legacy;
  const ageH = s?.backupAt ? Math.round((now - new Date(s.backupAt).getTime()) / 36e5) : null;
  return {
    configured: true,
    lastSuccess: s ? {
      backupAt: s.backupAt, verifiedAt: s.verifiedAt || null, ageHours: ageH, runner: s.runner || null, runUrl: s.runUrl || null,
      docs: s.docs ?? null, restoredDocs: s.restoredDocs ?? null, restoredCollections: s.restoredCollections ?? null,
      restoredIndexes: s.restoredIndexes ?? null, artifactId: s.artifactId ?? null, ...(s.legacy ? { legacy: true } : {}),
    } : null,
    lastAttempt: d.lastAttempt ? {
      at: d.lastAttempt.at, ok: d.lastAttempt.ok, runner: d.lastAttempt.runner || null, runUrl: d.lastAttempt.runUrl || null,
      failedStep: d.lastAttempt.failedStep || null, failedLabel: d.lastAttempt.failedLabel || null,
    } : null,
    stale: ageH == null || ageH > 36, // günlük yedekte son başarılı doğrulanmış yedek 36 saatten eski → uyarı
  };
}

module.exports = { MIN_PASSPHRASE, checkSecrets, summarizeSteps, buildStatusUpdate, presentStatus, STEP_LABELS };
