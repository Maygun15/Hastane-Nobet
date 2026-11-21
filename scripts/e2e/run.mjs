// Yerel deneme ortamında uçtan uca senaryolar. Ön koşul: yerel MongoDB (27018) + API (3100).
// node scripts/e2e/run.mjs [A,B,C,...]
import { credentials, login, results, closeDb } from './lib.mjs';

const only = (process.argv[2] || '').split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);

const A = await login(credentials('Yönetici')); // oturum 1
const B = await login(credentials('Yönetici')); // oturum 2 (ikinci cihaz)
const S = await login(credentials('Personel')); // personel
const ctx = { A, B, S };

const suites = [
  ['A', './kurallar.mjs'],
  ['B', './aylar-arasi.mjs'],
  ['C', './eszamanli.mjs'],
  ['E', './yayin-revizyon.mjs'],
  ['F', './izin.mjs'],
];
for (const [key, file] of suites) {
  if (!want(key)) continue;
  let mod;
  try { mod = await import(file); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') continue; throw e; }
  await mod.run(ctx);
}
await closeDb();
const ok = results.filter((r) => r.ok).length;
console.log(`\nSONUÇ: ${ok}/${results.length} geçti`);
process.exit(ok === results.length ? 0 : 1);
