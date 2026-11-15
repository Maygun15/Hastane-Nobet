#!/usr/bin/env node
'use strict';

/**
 * Acil pilot provası — veritabanı GEREKTİRMEZ, canlı sisteme dokunmaz.
 *
 * Gerçek personel listesi + görev şablonundan, programın kendi motoruyla
 * (buildSchedulerInput → generateMonthlyPlan) bir aylık çizelge üretir ve
 * çizelgeyi motordan BAĞIMSIZ bir denetçiyle kurallara karşı kontrol eder.
 *
 * Kullanım:
 *   node scripts/acilProva.js --staff HEMŞIRELER.xlsx \
 *     --template nobet_cizelgesi_hemşireler_2026-03.xlsx \
 *     --year 2026 --month 12 [--runs 5] [--max-weekly-hours 72] [--json rapor.json]
 *
 * --staff     : ROL, SERVIS, UNVANI, AD SOYAD, ÇALIŞMA ALANLARI, VARDİYE KODLARI sütunları
 * --template  : "Cizelge-Sayı" sayfası (Görev, Vardiya, varsayılan, gün gün kişi sayısı).
 *               Şablon başka bir aya aitse, her görevin haftanın günlerine göre en sık
 *               görülen kişi sayısı hedef aya uygulanır.
 */

const path = require('path');
const ExcelJS = require('exceljs');
const { buildSchedulerInput } = require('../services/scheduler/inputBuilder');
const { applyHolidayPolicies } = require('../services/scheduler/holidayPolicyAdapter');
const { generateMonthlyPlan } = require('../services/scheduler');
const { DEFAULT_RULES, DEFAULT_WEIGHTS } = require('../services/scheduler/ruleResolver');
const { isNightLikeShift, isWeekendLikeDay } = require('../services/scheduler/fairnessCounters');
const { areaMatches, normalizeArea } = require('../services/scheduler/constraints');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    out[k.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
  }
  return String(v);
}

async function readSheet(file, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  if (!ws) throw new Error(`${path.basename(file)}: "${sheetName}" sayfası yok`);
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values.slice(1).map(cellText);
    rows.push(values);
  });
  return rows;
}

const splitList = (s) => String(s || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);

async function loadStaff(file) {
  const [header, ...rows] = await readSheet(file);
  const idx = (name) => header.findIndex((h) => normalizeArea(h) === normalizeArea(name));
  const col = {
    role: idx('ROL'), service: idx('SERVIS'), title: idx('UNVANI'), name: idx('AD SOYAD'),
    areas: idx('ÇALIŞMA ALANLARI'), codes: idx('VARDİYE KODLARI'),
  };
  return rows
    .filter((r) => String(r[col.name] || '').trim())
    .map((r, i) => ({
      id: `s${i + 1}`,
      name: String(r[col.name]).trim(),
      active: true,
      role: String(r[col.role] || '').trim(),
      title: String(r[col.title] || '').trim(),
      serviceId: String(r[col.service] || '').trim(),
      meta: { areas: splitList(r[col.areas]), shiftCodes: splitList(r[col.codes]).map((c) => c.toUpperCase()) },
    }));
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = 0;
  let bestN = -1;
  for (const [v, n] of counts) if (n > bestN || (n === bestN && v > best)) { best = v; bestN = n; }
  return best;
}

const TR_DAY = { paz: 0, pzt: 1, sal: 2, car: 3, 'çar': 3, per: 4, cum: 5, cmt: 6 };

async function loadTemplateDefs(file) {
  const [header, ...rows] = await readSheet(file, 'Cizelge-Sayı');
  // "01 (Paz)" → hafta günü
  const dayCols = header
    .map((h, i) => {
      const m = String(h).match(/^\s*(\d{1,2})\s*\(([^)]+)\)/);
      if (!m) return null;
      const wd = TR_DAY[normalizeArea(m[2]).slice(0, 3)] ?? TR_DAY[String(m[2]).toLowerCase().slice(0, 3)];
      return wd == null ? null : { i, wd };
    })
    .filter(Boolean);

  return rows
    .filter((r) => String(r[0] || '').trim())
    .map((r, n) => {
      const label = String(r[0]).trim();
      const code = String(r[1] || '').trim().split(/\s+/)[0].toUpperCase();
      const byWd = Array.from({ length: 7 }, () => []);
      for (const c of dayCols) byWd[c.wd].push(Number(r[c.i] || 0) || 0);
      // Pazartesi ilk (inputBuilder.monIndex)
      const pattern = [1, 2, 3, 4, 5, 6, 0].map((wd) => (byWd[wd].length ? mode(byWd[wd]) : 0));
      return { id: `r${n + 1}`, label, shiftCode: code, pattern, defaultCount: Number(r[2] || 0) || 0 };
    });
}

/* ─── Bağımsız denetçi ─── */

const toMin = (hhmm) => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function absInterval(date, start, end, hours) {
  const base = Date.parse(`${date}T00:00:00Z`) / 60000;
  const s = toMin(start);
  let e = toMin(end);
  if (s == null) return null;
  if (e == null) e = s + Number(hours || 0) * 60;
  if (e <= s) e += 1440; // gece yarısını geçen / 24 saat
  return { from: base + s, to: base + e };
}

function isoWeek(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function audit({ assignments, days, staff, rules, maxWeeklyHours }) {
  const shiftById = new Map();
  for (const d of days) for (const s of d.shifts || []) shiftById.set(`${d.date}|${s.id}`, { day: d, shift: s });
  const personById = new Map(staff.map((p) => [String(p.id), p]));
  const v = [];
  const add = (type, a, detail = '') => v.push({ type, date: a.date, person: a.personName || a.personId, shift: a.shiftCode, detail });

  const byPerson = new Map();
  for (const a of assignments) {
    const k = String(a.personId);
    if (!byPerson.has(k)) byPerson.set(k, []);
    byPerson.get(k).push(a);

    const ref = shiftById.get(`${a.date}|${a.shiftId}`);
    const p = personById.get(k);
    if (!p) { add('BILINMEYEN_KISI', a); continue; }
    if (ref) {
      const area = normalizeArea(ref.shift.area || '');
      const personAreas = (p.meta?.areas || []).map(normalizeArea);
      if (area && !areaMatches(personAreas, area)) add('ALAN_UYGUN_DEGIL', a, ref.shift.area);
      if (ref.day && isWeekendLikeDay(ref.day) && String(a.shiftCode).toUpperCase() === 'M4') add('HAFTA_SONU_M4', a);
    }
    const codes = p.meta?.shiftCodes || [];
    if (codes.length && !codes.includes(String(a.shiftCode).toUpperCase())) add('VARDIYA_KODU_UYGUN_DEGIL', a);
  }

  const minRest = Number(rules.MIN_REST_HOURS || 0) * 60;
  const maxCons = Number(rules.MAX_CONSECUTIVE_DAYS || 0);
  for (const list of byPerson.values()) {
    list.sort((x, y) => (x.date === y.date ? toMin(x.start) - toMin(y.start) : x.date < y.date ? -1 : 1));
    const perDay = new Map();
    const weekly = new Map();
    let cons = 0;
    let prevDate = null;
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      perDay.set(a.date, (perDay.get(a.date) || 0) + 1);
      if (perDay.get(a.date) === 2) add('GUNDE_IKI_VARDIYA', a);
      const wk = isoWeek(a.date);
      weekly.set(wk, (weekly.get(wk) || 0) + Number(a.hours || 0));

      if (prevDate !== a.date) {
        const diff = prevDate ? (Date.parse(a.date) - Date.parse(prevDate)) / 86400000 : null;
        cons = diff === 1 ? cons + 1 : 1;
        if (maxCons && cons > maxCons) add('ART_ARDA_GUN', a, `${cons} gün`);
        prevDate = a.date;
      }

      const prev = list[i - 1];
      if (prev) {
        const p = absInterval(prev.date, prev.start, prev.end, prev.hours);
        const c = absInterval(a.date, a.start, a.end, a.hours);
        if (p && c) {
          const gap = c.from - p.to;
          if (gap < 0) add('CAKISMA', a, `${prev.date} ${prev.shiftCode}`);
          else if (minRest && gap < minRest) add('DINLENME_12S', a, `${(gap / 60).toFixed(1)} saat`);
        }
        const prevNight = isNightLikeShift({ code: prev.shiftCode, isNight: false })
          || Number(prev.hours || 0) >= 24;
        const dayGap = (Date.parse(a.date) - Date.parse(prev.date)) / 86400000;
        if (rules.NIGHT_NEXT_DAY_OFF && prevNight && dayGap === 1) add('GECE_SONRASI_GUN', a, `${prev.date} ${prev.shiftCode}`);
      }
    }
    if (maxWeeklyHours) {
      for (const [wk, h] of weekly) if (h > maxWeeklyHours) v.push({ type: 'HAFTALIK_SAAT', date: wk, person: list[0].personName, detail: `${h} saat` });
    }
  }
  return v;
}

function spreadStats(values) {
  const arr = [...values];
  if (!arr.length) return { min: 0, max: 0, avg: 0, fark: 0 };
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const avg = arr.reduce((s, x) => s + x, 0) / arr.length;
  return { min, max, avg: Math.round(avg * 10) / 10, fark: max - min };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.staff || !args.template) {
    console.error('Kullanım: node scripts/acilProva.js --staff <xlsx> --template <xlsx> --year 2026 --month 12');
    process.exit(1);
  }
  const year = Number(args.year || 2026);
  const month = Number(args.month || 12);
  const runs = Math.max(1, Number(args.runs || 5));
  const maxWeeklyHours = Number(args['max-weekly-hours'] || 72);

  const staff = await loadStaff(args.staff);
  const defs = await loadTemplateDefs(args.template);
  const input = buildSchedulerInput({ scheduleDoc: null, payload: { defs }, year, month, holidays: [] });
  const days = applyHolidayPolicies({ days: input.days, holidayKindByDate: input.holidayKindByDate, shiftMetaByCode: input.shiftMetaByCode });

  const slots = days.reduce((s, d) => s + d.shifts.reduce((t, sh) => t + Math.max(1, Number(sh.requiredCount || 1)), 0), 0);
  const slotHours = days.reduce((s, d) => s + d.shifts.reduce((t, sh) => t + Math.max(1, Number(sh.requiredCount || 1)) * Number(sh.hours || 0), 0), 0);
  const rules = { ...DEFAULT_RULES };

  const results = [];
  for (let r = 0; r < runs; r += 1) {
    const t0 = Date.now();
    const ctx = await generateMonthlyPlan({
      year, month,
      getActiveStaff: async () => JSON.parse(JSON.stringify(staff)),
      getMonthlyShifts: async () => JSON.parse(JSON.stringify(days)),
      rules,
      weights: { ...DEFAULT_WEIGHTS },
      targetShifts: staff.length ? slots / staff.length : 0,
      targetHours: staff.length ? slotHours / staff.length : 0,
    });
    const ms = Date.now() - t0;
    const assignments = ctx.assignments || [];
    const unfilled = (ctx.issues || []).reduce((s, i) => s + Number(i.missing || 0), 0);
    const unfilledByArea = {};
    for (const i of ctx.issues || []) {
      const key = `${i.shiftId}`;
      unfilledByArea[key] = (unfilledByArea[key] || 0) + Number(i.missing || 0);
    }
    const violations = audit({ assignments, days, staff, rules, maxWeeklyHours });

    const hours = new Map(staff.map((p) => [p.id, 0]));
    const nights = new Map(staff.map((p) => [p.id, 0]));
    const weekends = new Map(staff.map((p) => [p.id, 0]));
    const dayByDate = new Map(days.map((d) => [d.date, d]));
    for (const a of assignments) {
      hours.set(a.personId, (hours.get(a.personId) || 0) + Number(a.hours || 0));
      if (isNightLikeShift({ code: a.shiftCode }) || Number(a.hours || 0) >= 24) nights.set(a.personId, (nights.get(a.personId) || 0) + 1);
      if (isWeekendLikeDay(dayByDate.get(a.date))) weekends.set(a.personId, (weekends.get(a.personId) || 0) + 1);
    }
    results.push({ ms, assignments: assignments.length, unfilled, unfilledByArea, violations, hours, nights, weekends });
  }

  const avg = (f) => Math.round((results.reduce((s, r) => s + f(r), 0) / runs) * 10) / 10;
  const first = results[0];
  const violationTypes = {};
  for (const r of results) for (const x of r.violations) violationTypes[x.type] = (violationTypes[x.type] || 0) + 1;
  const rowLabel = Object.fromEntries(defs.map((d) => [d.id, `${d.label} ${d.shiftCode}`]));

  const report = {
    kapsam: { yil: year, ay: month, personel: staff.length, gorevSatiri: defs.length, toplamSlot: slots, toplamSlotSaati: slotHours,
      kisiBasiOrtalamaSaat: staff.length ? Math.round((slotHours / staff.length) * 10) / 10 : 0 },
    calistirma: runs,
    ortalamaSureMs: avg((r) => r.ms),
    ortalamaAtama: avg((r) => r.assignments),
    ortalamaBosSlot: avg((r) => r.unfilled),
    enKotuCalistirmaBosSlot: (() => {
      const worst = results.reduce((w, r) => (r.unfilled > w.unfilled ? r : w), results[0]);
      return Object.entries(worst.unfilledByArea).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([id, n]) => ({ gorev: rowLabel[id] || id, bos: n }));
    })(),
    ihlalToplam: results.reduce((s, r) => s + r.violations.length, 0),
    ihlalTurleri: violationTypes,
    ihlalOrnekleri: first.violations.slice(0, 10),
    // Veri eksiği: çalışma alanı boş olan kişi hiçbir göreve yazılamaz (AREA_PROFILE_MISSING).
    veriEksikleri: staff
      .filter((p) => !(p.meta?.areas || []).length || !(p.meta?.shiftCodes || []).length)
      .map((p) => ({ kisi: p.id, satir: Number(p.id.slice(1)) + 1, eksik: !(p.meta?.areas || []).length ? 'ÇALIŞMA ALANLARI boş' : 'VARDİYE KODLARI boş' })),
    // Dağılım istatistikleri veri eksiği olanlar HARİÇ (adil karşılaştırma).
    ilkCalistirma: (() => {
      const ok = new Set(staff.filter((p) => (p.meta?.areas || []).length && (p.meta?.shiftCodes || []).length).map((p) => p.id));
      const pick = (m) => [...m.entries()].filter(([id]) => ok.has(id)).map(([, x]) => x);
      const nightCapable = new Set(staff
        .filter((p) => ok.has(p.id) && (p.meta?.shiftCodes || []).some((c) => ['N', 'V2', 'N24', 'SV'].includes(c)))
        .map((p) => p.id));
      return {
        kisiSayisi: ok.size,
        saat: spreadStats(pick(first.hours)),
        // Gece dengesi sadece 24 saat (N/V2) tutabilenler arasında anlamlı.
        gece24TutabilenSayisi: nightCapable.size,
        gece24: spreadStats([...first.nights.entries()].filter(([id]) => nightCapable.has(id)).map(([, x]) => x)),
        haftaSonu: spreadStats(pick(first.weekends)),
      };
    })(),
  };

  console.log(JSON.stringify(report, null, 2));
  if (args.json) {
    await require('fs').promises.writeFile(args.json, JSON.stringify(report, null, 2));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { audit, loadStaff, loadTemplateDefs };
