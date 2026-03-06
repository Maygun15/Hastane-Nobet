// src/lib/dataResolver.js
// V1/V2 anahtarlarını tek yerde toplayıp normalize eden hafif adaptör.
// Herkes BURADAN okusun. (role filtreli, kanban/listeler destekli)

const KEYS = {
  people: ["peopleV2", "people", "personel", "staff", "nurses", "nurseList"],
  areas: ["workAreasV2", "workAreas"],
  shifts: ["workingHoursV2", "workingHours"],
  leaves: ["leavesV2", "leaves"],
  groupedPeople: ["peopleByRole", "staffByRole"], // { Nurse:[...], Doctor:[...] } yapıları
};

export function LSget(key, def = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : def;
  } catch {
    return def;
  }
}

function pickFirst(keys, def = []) {
  for (const k of keys) {
    const v = LSget(k, null);
    if (Array.isArray(v) && v.length) return v;
    if (v && typeof v === "object" && Object.keys(v).length) return v;
  }
  return def;
}

const U = (s) => (s ?? "").toString().trim().toLocaleUpperCase("tr-TR");

// 🔹 Grup/bölüm etiketlerini asla kişi sayma
export const isGroupLabel = (name = "") => {
  const s = String(name).trim().toLocaleLowerCase("tr-TR");
  return ["hemşireler", "hemsireler", "doktorlar", "doctors", "personel", "ekip"].includes(s);
};

function normRole(raw, hint) {
  const s = U(raw || "");
  if (/DOKTOR|DOCTOR|PHYS/.test(s)) return "Doctor";
  if (/HEMŞ|HEMS|NURS/.test(s)) return "Nurse";
  return hint || (s ? raw : null);
}

function normPerson(p, roleHint = null, idx = 0) {
  if (!p) return null;

  // Bölüm nesneleri kart değil
  if (p.cards || p.items || p.lists || p.columns || p.sections) return null;

  const fullName =
    p.fullName || p.name || p.displayName || p.personName || p.title || p.code;

  if (!fullName) return null;
  if (isGroupLabel(fullName)) return null; // ⛔ grup etiketi

  const id =
    p.id ??
    p.personId ??
    p.tc ??
    p.tcNo ??
    p.email ??
    p.code ??
    `P_${Date.now()}_${idx}`;

  const tckn =
    p.tckn ??
    p.tc ??
    p.tcNo ??
    p.TCKN ??
    p.tcKimlik ??
    p.nationalId ??
    p.meta?.tckn ??
    p.meta?.tc ??
    p.meta?.tcNo ??
    p.meta?.TCKN ??
    "";

  return {
    id,
    fullName,
    name: fullName,
    role: normRole(p.role || p.departmentRole || p.title, roleHint) || roleHint,
    unit: p.unit || p.area || p.service || p.department || null,
    tc: tckn,
    tckn,
    skills: p.skills || p.tags || [],
    meta: p,
  };
}

function dedupePeople(arr) {
  const out = [];
  const seen = new Set();
  for (const p of arr) {
    const key = (p.id != null ? `ID:${String(p.id).toLowerCase()}` : `NM:${U(p.fullName)}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/* -------- alanlar & vardiyalar -------- */
export function getAreas() {
  const src = pickFirst(KEYS.areas, []);
  const out = [];
  (Array.isArray(src) ? src : []).forEach((a) => {
    const name = (typeof a === "string" ? a : a?.name || a?.title || a?.label)?.toString().trim();
    if (!name) return;
    out.push({
      name,
      required: Number(a?.required ?? a?.minStaff ?? a?.defaultCount ?? 1) || 1,
      defaultShift: a?.defaultShift || a?.shiftCode || null,
    });
  });
  return out;
}

export function getShifts() {
  const src = pickFirst(KEYS.shifts, []);
  const seen = new Set();
  const out = [];
  (Array.isArray(src) ? src : []).forEach((s, i) => {
    const code = (s?.code || s?.name || `S${i}`).toString().trim();
    if (!code || seen.has(code)) return;
    seen.add(code);
    out.push({
      id: s?.id ?? code,
      code,
      start: s?.start ?? s?.from ?? s?.begin ?? s?.startTime ?? "",
      end:   s?.end   ?? s?.to   ?? s?.finish   ?? s?.endTime   ?? "",
    });
  });
  return out;
}

/* -------- people: bilinen düz listeler ve grouped objeler -------- */
function readPeopleKnown() {
  // Genel listelerden birini al
  const flat = pickFirst(["peopleV2", "people", "personel", "staff"], []);
  const list1 = Array.isArray(flat) ? flat : [];

  // Spesifik rol listelerini de ekle (pickFirst sadece ilkini alıyordu, bu yüzden doctors kaybolabiliyordu)
  const nurses = LSget("nurses", []);
  if (Array.isArray(nurses)) list1.push(...nurses);

  const doctors = LSget("doctors", []);
  if (Array.isArray(doctors)) list1.push(...doctors);

  const grp = pickFirst(KEYS.groupedPeople, {});
  const list2 = [];
  if (grp && typeof grp === "object") {
    const pools = [].concat(grp.Nurse || [], grp.DOCTOR || [], grp.Doctor || [], grp.All || []);
    if (pools.length) list2.push(...pools);
  }
  return [...list1, ...list2];
}

/* -------- yardımcı: section/liste/column yapılarını kartlara indirgeme -------- */
function* iterSectionLike(root, roleHint) {
  if (!root) return;

  // Diziler → içinde section/card olabilir
  if (Array.isArray(root)) {
    for (const it of root) yield* iterSectionLike(it, roleHint);
    return;
  }

  if (typeof root !== "object") return;

  // Tipik yapılar
  if (Array.isArray(root.items)) {
    for (const it of root.items) yield* iterSectionLike(it, roleHint);
  }
  if (Array.isArray(root.cards)) {
    for (const it of root.cards) yield* iterSectionLike(it, roleHint);
  }
  if (Array.isArray(root.lists)) {
    for (const li of root.lists) yield* iterSectionLike(li, roleHint);
  }
  if (Array.isArray(root.columns)) {
    for (const col of root.columns) {
      const hint = /hemş|nurs/i.test(col?.title) ? "Nurse" : roleHint;
      if (Array.isArray(col.cards)) {
        for (const c of col.cards) yield c; // kartlar doğrudan
      }
      if (Array.isArray(col.items)) {
        for (const c of col.items) yield c;
      }
      // alt listeler vs. varsa:
      yield* iterSectionLike(col, hint);
    }
  }
  if (Array.isArray(root.sections)) {
    for (const sec of root.sections) yield* iterSectionLike(sec, roleHint);
  }

  // “personnelSections” gibi {id,name,items:[...]} objeleri:
  if (root.id && root.name && Array.isArray(root.items)) {
    for (const it of root.items) yield it;
  }

  // Kart gibi duran düz obje ise kendisi
  if (!root.items && !root.cards && !root.lists && !root.columns && !root.sections) {
    yield root;
  }
}

/* -------- people: kanban/kolon/listelerden kart toplama -------- */
function readPeopleFromBoards() {
  const keys = Object.keys(localStorage);
  const bag = [];
  for (const k of keys) {
    if (!/people|person|nurs|hems|staff|flow|board|column|list|section/i.test(k)) continue;
    // Çizelge/parametre sekme tanımlarını asla kişi sanma
    if (/schedule|cizelg|parametre|params|tab|section/i.test(k) && !/person|staff/i.test(k)) {
      continue;
    }
    let v;
    try { v = JSON.parse(localStorage.getItem(k)); } catch { continue; }
    if (!v) continue;
    // Sadece {id,name} gibi sekme listeleri → kişi değil
    if (Array.isArray(v) && v.length && v.every((x) => {
      if (!x || typeof x !== "object") return false;
      const keys = Object.keys(x);
      const hasLabel = "name" in x || "title" in x || "label" in x;
      const hasId = "id" in x || "key" in x;
      const hasStruct = "items" in x || "cards" in x || "lists" in x || "columns" in x || "sections" in x;
      if (!hasLabel || !hasId || hasStruct) return false;
      // Sadece küçük anahtar seti varsa sekme kabul et
      return keys.every((kk) => ["id", "key", "name", "title", "label", "role"].includes(kk));
    })) {
      continue;
    }

    for (const card of iterSectionLike(v)) {
      const p = normPerson(card, undefined);
      if (p) bag.push(p);
    }
  }
  return bag;
}

/* -------- people: izinlerden kişi çıkar -------- */
export function getLeavesRaw() {
  return pickFirst(KEYS.leaves, []);
}
function readPeopleFromLeaves() {
  const L = getLeavesRaw();
  const out = [];
  (Array.isArray(L) ? L : []).forEach((x, i) => {
    const p = normPerson(
      {
        id: x?.personId ?? x?.id ?? x?.pid,
        fullName: x?.personName || x?.name || x?.employeeName,
        role: x?.role,
      },
      undefined,
      i
    );
    if (p) out.push(p);
  });
  return out;
}

/* -------- public: insanlar -------- */
/** @param {"Nurse"|"Doctor"|undefined} roleFilter */
export function getPeople(roleFilter) {
  const all = [
    ...readPeopleKnown(),
    ...readPeopleFromBoards(),
    ...readPeopleFromLeaves(),
  ]
    .map((p, i) => normPerson(p, undefined, i))
    .filter(Boolean)
    .filter(p => !isGroupLabel(p.fullName)); // ⛔ çift emniyet

  const merged = dedupePeople(all);
  if (!roleFilter) return merged;
  const rf = U(roleFilter);
  return merged.filter((p) => (p.role ? U(p.role) === rf : rf === "NURSE"));
}

/** İzinlerden kişi listesi türet (fallback) */
export function buildPeopleFromLeaves(roleHint = "Nurse") {
  const arr = readPeopleFromLeaves().map((p) =>
    p.role ? p : { ...p, role: roleHint }
  );
  return dedupePeople(arr);
}
