// Kural kapsamı tablosu: "Nöbet Kuralları" kataloğundaki her kural için motor / elle atama /
// risk paneli / yayın aşamasında nasıl uygulandığı ve kanıtı. Katalog koddan okunur.
//   node scripts/kural-kapsami.mjs > docs/KURAL_KAPSAMI.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const catSrc = fs.readFileSync(path.join(root, 'src/tabs/DutyRulesTab.Explained.jsx'), 'utf8');
const enfSrc = fs.readFileSync(path.join(root, 'src/rules/ruleEnforcement.js'), 'utf8');

const LEVEL = { 1: 'Katı', 2: 'Yüksek', 3: 'Orta', 4: 'Düşük' };
const catalog = [];
const re = /^\s+([A-Z][A-Z0-9_]+):\s*\{\s*cat:\s*"([a-z_]+)",\s*level:\s*LEVEL\.(HARD|HIGH|MED|LOW),\s*desc:\s*"([^"]+)"/gm;
const lv = { HARD: 1, HIGH: 2, MED: 3, LOW: 4 };
for (let m; (m = re.exec(catSrc));) catalog.push({ id: m[1], cat: m[2], level: LEVEL[lv[m[3]]], desc: m[4] });

const listOf = (name) => {
  const m = enfSrc.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  return new Set((m ? m[1] : '').match(/"([A-Z0-9_]+)"/g)?.map((x) => x.slice(1, -1)) || []);
};
const ENGINE = listOf('ENGINE_RULES'); const TEMPLATE = listOf('TEMPLATE_RULES'); const BALANCE = listOf('BALANCE_RULES');
const status = (id) => (ENGINE.has(id) ? 'Motor uygular' : TEMPLATE.has(id) ? 'Şablon/alan ile' : BALANCE.has(id) ? 'Yaklaşık (denge)' : 'Bilgi — motor kontrol etmez');

// Aşama kapsamı (kod incelemesi, 22 Kas 2026). Elle atama = POST /api/schedules/assign (kurum kuralı denetçisi);
// plan kaydı (PUT /monthly) kural denetlemez, ihlal risk paneline düşer; yayın, kararsız risk varken 409.
const RISK = 'scheduleRiskService.auditAssignments';
const HARD = {
  ONE_SHIFT_PER_DAY: ['ONE_SHIFT_PER_DAY', 'oneShiftPerDay.rule.js, constraints.js', 'GUNDE_IKI_VARDIYA, CAKISMA + aynı gün çakışma kontrolü', 'GUNDE_IKI_VARDIYA, CAKISMA', 'mandatoryRules.test.js (15 tekrar)'],
  NIGHT_NEXT_DAY_OFF: ['NIGHT_NEXT_DAY_OFF', 'restAfterNight.rule.js, constraints.js', 'GECE_SONRASI_GUN', 'GECE_SONRASI_GUN', 'scheduler.restAfterNight, monthBoundary, E2E K8, K13'],
  MIN_REST: ['MIN_REST_HOURS', 'constraints.js (gece yarısını aşan vardiya dahil)', 'DINLENME_12S', 'DINLENME_12S', 'monthBoundary.test.js, E2E K13'],
  MAX_CONSECUTIVE: ['MAX_CONSECUTIVE_DAYS', 'maxConsecutiveDays.rule.js', 'ART_ARDA_GUN', 'ART_ARDA_GUN', 'monthBoundary.test.js (26–31 Ara → 1 Oca)'],
  WEEKLY_SHIFTS: ['MAX_SHIFTS_PER_WEEK', 'maxWeeklyShifts.rule.js, constraints.js', 'HAFTALIK_VARDIYA (yeni)', 'HAFTALIK_VARDIYA (yeni)', 'riskAuditExtra.test.js, scheduler.constraints'],
  TASK: ['MAX_TASK_PER_PERSON', 'constraints.js', 'GOREV_SAYISI (yeni)', 'GOREV_SAYISI (yeni)', 'riskAuditExtra.test.js, scheduler.constraints'],
  LEAVE: ['LEAVE_BLOCK', 'leaveBlock.rule.js', 'IZIN_GUNU (yeni) + izin çakışması', 'IZIN_GUNU (yeni)', 'mandatoryRules, riskAuditExtra, E2E F7, K12'],
  WEEKLY_HOURS: ['MAX_WEEKLY_HOURS', 'constraints.js', 'HAFTALIK_SAAT', 'HAFTALIK_SAAT', 'mandatoryRules.test.js (değer kurum kararı)'],
};
const MAP = {
  ONE_SHIFT_PER_DAY: HARD.ONE_SHIFT_PER_DAY, NO_MULTIPLE_ASSIGNMENTS_PER_DAY: HARD.ONE_SHIFT_PER_DAY, NO_DOUBLE_BOOKING: HARD.ONE_SHIFT_PER_DAY,
  NIGHT_NEXT_DAY_OFF: HARD.NIGHT_NEXT_DAY_OFF, NO_IMMEDIATE_NEXT_NIGHT_AFTER_NIGHT: HARD.NIGHT_NEXT_DAY_OFF,
  MIN_REST_11H: HARD.MIN_REST, MIN_GAP_12H: HARD.MIN_REST,
  MAX_CONSECUTIVE_6D: HARD.MAX_CONSECUTIVE,
  WEEKLY_MIN_1_OFF: ['MAX_CONSECUTIVE_DAYS ≤ 6', 'maxConsecutiveDays.rule.js — kayan 7 günde en az 1 boş gün, en fazla 6 gün art arda ile aynıdır', 'ART_ARDA_GUN', 'ART_ARDA_GUN', 'monthBoundary.test.js'],
  WEEKLY_MAX_SHIFTS: HARD.WEEKLY_SHIFTS, MAX_TASK_PER_PERSON: HARD.TASK, LEAVE_BLOCK_GENERIC: HARD.LEAVE, WEEKLY_MAX_80H: HARD.WEEKLY_HOURS,
  DAILY_MAX_24H: ['ONE_SHIFT_PER_DAY + MIN_REST_HOURS', 'dolaylı: günde tek vardiya ve en uzun vardiya 24 s', 'GUNDE_IKI_VARDIYA, CAKISMA', 'GUNDE_IKI_VARDIYA, CAKISMA', 'mandatoryRules'],
};
const TEMPLATE_STAGE = ['görev satırı kişi sayısı + personel alan/vardiya kodu', 'aday listesi alan ve koda göre süzülür', 'ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT', 'mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486'];
const BALANCE_STAGE = ['adalet sayaçları / tercih cezası', '—', 'TERCIH (tercih kuralları için)', 'Adillik raporu; fairness testleri'];

const PILOT_PENDING = {
  PREGNANT_NO_NIGHTS: 'KARAR: personel kartında sağlık/gebelik bilgisi tutulacak mı, kim görür (KVKK m.6 özel nitelikli veri). Teknik hazırlık: "gece yok" kısıtı alanı.',
  HEALTH_LIMITED_SHIFTS: 'KARAR: aynı (KVKK m.6). Önerilen alanlar: nightAllowed, onlyDayShifts, maxShiftsPerMonth.',
  TRY_RESPECT_OFF_REQUESTS: 'KARAR: onaylı boşluk isteği (B) izin gibi kesin engel mi, tercih mi? Şu an tercih cezası + risk panelinde TERCIH.',
  HOLIDAY_EQUAL: 'KARAR: bayram eşitliği yıllık mı, aylık mı sayılır; adalet puanına ağırlığı.',
  HOLIDAY_SIMILAR_COUNT_YEAR: 'KARAR: aynı.',
  WEEKLY_MAX_80H: 'KARAR: değer ve dayanağı (önceki 72 s kaynaksızdı). Mekanizma hazır.',
  MONTHLY_TARGET_CALC: 'KARAR: aylık norm ve eksik saat devri.',
  OVERTIME_MINIMIZE: 'KARAR: aylık norm.',
};

const rows = catalog.map((r) => {
  const st = status(r.id);
  const m = MAP[r.id];
  let key = '—'; let motor = '—'; let manual = '—'; let risk = '—'; let publish = '—'; let test = '—';
  if (m) { [key, motor, manual, risk, test] = m; publish = 'kararsız risk varken 409 RISKS_PENDING'; }
  else if (st === 'Şablon/alan ile') { [motor, manual, risk, test] = TEMPLATE_STAGE; publish = 'BOS_SLOT kararı ister'; }
  else if (st === 'Yaklaşık (denge)') { [motor, manual, risk, test] = BALANCE_STAGE; publish = r.id === 'CONSIDER_PREFERRED_SHIFTS' || r.id === 'AVOID_MAZERET_DAYS' ? 'onaylı tercih ihlali kararı ister' : '—'; }
  return { ...r, st, key, motor, manual, risk, publish, test, pending: PILOT_PENDING[r.id] || '' };
});

const esc = (s) => String(s).replace(/\|/g, '\\|');
const out = [];
out.push('# Kural Kapsamı (koddan üretildi)');
out.push('');
out.push(`Kaynak: \`src/tabs/DutyRulesTab.Explained.jsx\` kataloğu (${catalog.length} kural), \`src/rules/ruleEnforcement.js\`, sunucu motoru ve risk denetçisi. Üretim: \`node scripts/kural-kapsami.mjs > docs/KURAL_KAPSAMI.md\`.`);
out.push('');
out.push('**Aşamalar:**');
out.push('- **Motor:** otomatik planlama (`services/scheduler`).');
out.push('- **Elle atama:** `POST /api/schedules/assign`. Kurum kuralı denetçisi bu atamanın **yeni** doğurduğu ihlali 409 ile durdurur; `force` ile devam edilirse ihlal risk panelinde kalır.');
out.push('- **Plan kaydı:** `PUT /monthly`. Kural denetlemez; ihlal risk paneline düşer.');
out.push('- **Risk paneli:** `' + RISK + '`, motorla aynı kurum değerleri.');
out.push('- **Yayın:** kararsız risk varken 409.');
out.push('');
out.push('**Etkinlik:** "Kurum anahtarı" olan kurallar, **Parametreler → Nöbet Kuralları → Kurum kuralları** panelinde değer verildiğinde etkindir. Değer yoksa uygulanmaz ve yayın 422 ile durur (zorunlu set eksik).');
out.push('');
out.push('**Kaynak:** kurum değerlerinin dayanağı (mevzuat / kurum kararı) kurum tarafından girilmeli. Deneme ortamında doğrulanmış bir mevzuat dayanağı **yok**.');
out.push('');
const counts = rows.reduce((a, r) => ((a[r.st] = (a[r.st] || 0) + 1), a), {});
out.push('| Durum | Adet |'); out.push('|---|---|');
for (const [k, v] of Object.entries(counts)) out.push(`| ${k} | ${v} |`);
out.push('');
out.push('## Pilotu etkileyen zorunlu kurallar');
out.push('');
out.push('| Kural | Durum | Kanıt | Bekleyen |'); out.push('|---|---|---|---|');
const pilot = ['ONE_SHIFT_PER_DAY', 'LEAVE_BLOCK_GENERIC', 'NIGHT_NEXT_DAY_OFF', 'MIN_REST_11H', 'MAX_CONSECUTIVE_6D', 'WEEKLY_MIN_1_OFF', 'QUAL_ONLY_IN_SPECIALTY', 'WEEKLY_MAX_80H', 'PREGNANT_NO_NIGHTS', 'HEALTH_LIMITED_SHIFTS', 'TRY_RESPECT_OFF_REQUESTS'];
for (const id of pilot) {
  const r = rows.find((x) => x.id === id);
  if (!r) continue;
  const verified = id === 'TRY_RESPECT_OFF_REQUESTS' ? '🟡 tercih olarak (motor cezası + risk panelinde TERCIH)'
    : r.pending ? (r.key !== '—' ? '🟡 mekanizma hazır, değer bekliyor' : '❌ uygulanmıyor')
    : '✅ motor, elle atama, risk paneli ve yayında uygulanıyor';
  out.push(`| \`${id}\` — ${esc(r.desc)} | ${verified} | ${esc(r.test)} | ${esc(r.pending || 'kurum değerinin dayanağı')} |`);
}
out.push('');
out.push('## Tüm kurallar');
out.push('');
out.push('| Kural | Tanım | Seviye | Durum | Kurum anahtarı | Motor | Elle atama | Risk paneli | Yayın | Test | Karar bekleyen |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) out.push(`| \`${r.id}\` | ${esc(r.desc)} | ${r.level} | ${r.st} | ${esc(r.key)} | ${esc(r.motor)} | ${esc(r.manual)} | ${esc(r.risk)} | ${esc(r.publish)} | ${esc(r.test)} | ${esc(r.pending)} |`);
console.log(out.join('\n'));
