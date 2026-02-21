const pad2 = (n) => String(n).padStart(2, '0');

function addDaysUTC(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Tabular Islamic calendar (civil) → Julian Day
function islamicToJD(y, m, d) {
  return (
    d +
    Math.ceil(29.5 * (m - 1)) +
    (y - 1) * 354 +
    Math.floor((3 + 11 * y) / 30) +
    1948440 - 1
  );
}

// Julian Day → Gregorian date (Fliegel–Van Flandern)
function jdToGregorian(jd) {
  let l = jd + 68569;
  const n = Math.floor((4 * l) / 146097);
  l = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l + 1)) / 1461001);
  l = l - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l) / 2447);
  const day = l - Math.floor((2447 * j) / 80);
  l = Math.floor(j / 11);
  const month = j + 2 - 12 * l;
  const year = 100 * (n - 49) + i + l;
  return { year, month, day };
}

function hijriToGregorianYmd(hDay, hMonth, hYear) {
  const jd = islamicToJD(hYear, hMonth, hDay);
  const g = jdToGregorian(jd);
  return `${g.year}-${pad2(g.month)}-${pad2(g.day)}`;
}

// Gregoryen yılı için hangi Hicri yılları kontrol etmeli
function getHijriYearsForGregorian(gregorianYear) {
  // Bir Gregoryen yılına 2 Hicri yıl denk gelebilir
  const approx = gregorianYear - 579;
  return [approx, approx + 1];
}

function getReligiousHolidays(gregorianYear) {
  const holidays = [];
  const hijriYears = getHijriYearsForGregorian(gregorianYear);

  for (const hijriYear of hijriYears) {
    // Ramazan Bayramı: 1 Şevval (10. ay)
    try {
      const ramazan = hijriToGregorianYmd(1, 10, hijriYear);
      if (ramazan.startsWith(String(gregorianYear))) {
        holidays.push({ date: addDaysUTC(ramazan, -1), kind: 'arife', name: 'Ramazan Bayramı Arifesi' });
        holidays.push({ date: ramazan, kind: 'full', name: 'Ramazan Bayramı 1. Gün' });
        holidays.push({ date: addDaysUTC(ramazan, 1), kind: 'full', name: 'Ramazan Bayramı 2. Gün' });
        holidays.push({ date: addDaysUTC(ramazan, 2), kind: 'full', name: 'Ramazan Bayramı 3. Gün' });
      }
    } catch (e) {}

    // Kurban Bayramı: 10 Zilhicce (12. ay)
    try {
      const kurban = hijriToGregorianYmd(10, 12, hijriYear);
      if (kurban.startsWith(String(gregorianYear))) {
        holidays.push({ date: addDaysUTC(kurban, -1), kind: 'arife', name: 'Kurban Bayramı Arifesi' });
        holidays.push({ date: kurban, kind: 'full', name: 'Kurban Bayramı 1. Gün' });
        holidays.push({ date: addDaysUTC(kurban, 1), kind: 'full', name: 'Kurban Bayramı 2. Gün' });
        holidays.push({ date: addDaysUTC(kurban, 2), kind: 'full', name: 'Kurban Bayramı 3. Gün' });
        holidays.push({ date: addDaysUTC(kurban, 3), kind: 'full', name: 'Kurban Bayramı 4. Gün' });
      }
    } catch (e) {}
  }

  return holidays;
}

module.exports = { getReligiousHolidays };
