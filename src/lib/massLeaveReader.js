// src/lib/massLeaveReader.js
const U = (s) => (s ?? "").toString().trim();

function lsGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}

// Çeşitli şemaları tek biçime çevir: { personId, personName, y, m1, d }
function normalizeAny(raw) {
  const out = [];
  if (!raw) return out;

  // DİZİ biçimleri
  if (Array.isArray(raw)) {
    for (const x of raw) {
      // 1) { personId, date }
      if (x?.personId && x?.date) {
        const dt = new Date(x.date);
        if (!isNaN(dt)) out.push({ personId: String(x.personId), personName: x.personName || x.name || "", y: dt.getFullYear(), m1: dt.getMonth()+1, d: dt.getDate() });
        continue;
      }
      // 2) { personId, year, month, day }
      if (x?.personId && (x.year || x.month || x.day)) {
        out.push({ personId: String(x.personId), personName: x.personName || x.name || "", y: +x.year, m1: +x.month, d: +x.day });
        continue;
      }
      // 3) { name, year, month, days:[...] } toplu kayıt
      if ((x?.name || x?.personName) && x?.year && x?.month && Array.isArray(x.days)) {
        const pid = String(x.personId ?? x.id ?? U(x.name||x.personName));
        for (const dd of x.days) out.push({ personId: pid, personName: x.personName || x.name, y: +x.year, m1: +x.month, d: +dd });
        continue;
      }
    }
    return out;
  }

  // SÖZLÜK biçimleri: { "YYYY-MM": { "personId": [days...] } } veya benzeri
  if (typeof raw === "object") {
    for (const key of Object.keys(raw)) {
      const ym = key.match(/^(\d{4})[-/.](\d{1,2})$/);
      if (!ym) continue;
      const y = +ym[1], m1 = +ym[2];
      const bucket = raw[key];
      if (typeof bucket !== "object") continue;
      for (const pid of Object.keys(bucket)) {
        const days = Array.isArray(bucket[pid]) ? bucket[pid] : Object.keys(bucket[pid]||{}).map(n=>+n);
        for (const d of days) out.push({ personId: String(pid), personName: "", y, m1, d: +d });
      }
    }
  }
  return out;
}

export function readLeavesForMonth(year, month0) {
  const m1 = month0 + 1;
  const keys = ["leavesV2","leaves","massLeavesV2","massLeaves","izinler","topluIzin","leaveCalendar"];
  let all = [];
  for (const k of keys) {
    const raw = lsGet(k);
    const norm = normalizeAny(raw);
    if (norm.length) all = all.concat(norm.map(o => ({...o, _src:k})));
  }
  // Filtre: seçili yıl/ay
  return all.filter(x => x.y === year && x.m1 === m1);
}
