// src/tabs/PersonnelTab.jsx
import React, { useEffect, useMemo, useState } from "react";
import TopTabsBar from "../components/TopTabsBar.jsx";
import PeopleTab from "./PeopleTab.jsx";
import { ROLE } from "../constants/enums.js";
import { LS } from "../utils/storage.js";
import useServicesModel from "../hooks/useServicesModel.js";
import useServiceScope from "../hooks/useServiceScope.js";
import { useAppData } from "../context/AppDataContext.jsx";

/** LS anahtarları */
const LS_KEY = "personnelSections";
const LS_ACTIVE = "personnelActiveSectionId";

/** Varsayılan alt sekmeler */
const DEFAULT_SECTIONS = [
  { id: "hemsireler", name: "Hemşireler", role: "nurse" },
  { id: "doktorlar",  name: "Doktorlar",  role: "doctor" },
];

/** URL yardımcıları */
const getQueryParam = (k) => new URLSearchParams(window.location.search).get(k);
const setQueryParam = (k, v) => {
  const sp = new URLSearchParams(window.location.search);
  if (v) sp.set(k, v); else sp.delete(k);
  const href = `${window.location.pathname}?${sp.toString()}${window.location.hash || ""}`;
  window.history.pushState({}, "", href);
  window.dispatchEvent(new Event("urlchange"));
};

function slugifyTR(s) {
  const tr = { ğ:"g", ü:"u", ş:"s", ı:"i", ö:"o", ç:"c", Ğ:"g", Ü:"u", Ş:"s", İ:"i", I:"i", Ö:"o", Ç:"c" };
  return (s||"")
    .trim()
    .replace(/[ĞÜŞİIÖÇğüşıiöç]/g, m => tr[m] || m)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 60);
}
function uniqueId(base, exists) {
  if (!exists.has(base)) return base;
  let i = 2;
  while (exists.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/* =========================
   Normalizasyon yardımcıları
========================= */
const clean = (s) => (s ?? "").toString().trim();

function normalizeAreas(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const names = arr
    .map((a) =>
      typeof a === "string" ? clean(a) : clean(a?.name || a?.label || a?.title || a?.id)
    )
    .filter(Boolean);
  // case-insensitive uniq (TR)
  const seen = new Set();
  const out = [];
  for (const x of names) {
    const k = x.toLocaleLowerCase("tr-TR");
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}
function normalizeShiftCodes(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const codes = arr
    .map((c) => (typeof c === "string" ? clean(c) : clean(c?.code || c?.id)))
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const x of codes) {
    const k = x.toLocaleLowerCase("tr-TR");
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}
function normalizePerson(p = {}) {
  return {
    ...p,
    areas: normalizeAreas(p.areas ?? p.workAreas ?? p.services ?? p.workAreaIds ?? []),
    shiftCodes: normalizeShiftCodes(p.shiftCodes ?? p.codes ?? p.shifts ?? []),
  };
}
function normalizePeople(next) {
  return Array.isArray(next) ? next.map(normalizePerson) : [];
}
// setState proxy: hem fonksiyon hem dizi kabul eder, sonuçları normalize eder
function makeNormalizedSetter(originalSet) {
  return (updater) => {
    if (typeof updater === "function") {
      originalSet((prev) => normalizePeople(updater(prev)));
    } else {
      originalSet(normalizePeople(updater));
    }
  };
}

export default function PersonnelTab({
  workAreas,
  workingHours,
  nurses, setNurses,
  doctors, setDoctors,
}) {
  const appData = useAppData();
  const effectiveWorkAreas = Array.isArray(workAreas)
    ? workAreas
    : (Array.isArray(appData.workAreas) ? appData.workAreas : []);
  const effectiveWorkingHours = Array.isArray(workingHours)
    ? workingHours
    : (Array.isArray(appData.workingHours) ? appData.workingHours : []);
  const effectiveNurses = Array.isArray(nurses)
    ? nurses
    : (Array.isArray(appData.nurses) ? appData.nurses : []);
  const effectiveDoctors = Array.isArray(doctors)
    ? doctors
    : (Array.isArray(appData.doctors) ? appData.doctors : []);
  const effectiveSetNurses =
    typeof setNurses === "function"
      ? setNurses
      : (typeof appData.setNurses === "function" ? appData.setNurses : () => {});
  const effectiveSetDoctors =
    typeof setDoctors === "function"
      ? setDoctors
      : (typeof appData.setDoctors === "function" ? appData.setDoctors : () => {});

  const servicesModel = useServicesModel();
  const scope = useServiceScope();
  const [sections, setSections] = useState(() => LS.get(LS_KEY, DEFAULT_SECTIONS));
  // Başlangıç: URL (?sec) > LS > ilk
  const initial = getQueryParam("sec") || LS.get(LS_ACTIVE, sections?.[0]?.id || "");
  const [activeId, setActiveId] = useState(sections.find(s => s.id === initial)?.id || sections[0]?.id || "");

  const active = useMemo(() => sections.find(s => s.id === activeId) || sections[0], [sections, activeId]);

  /* ===== Persist & Menü senkron ===== */
  useEffect(() => {
    LS.set(LS_KEY, sections);
    try { window.dispatchEvent(new Event("personnelSectionsChanged")); } catch {}
  }, [sections]);

  useEffect(() => {
    try { window.dispatchEvent(new Event("personnelSectionsChanged")); } catch {}
  }, []);

  useEffect(() => {
    if (!active) return;
    LS.set(LS_ACTIVE, active.id);
    setQueryParam("sec", active.id);
  }, [active]);

  useEffect(() => {
    const sync = () => {
      const sec = getQueryParam("sec");
      if (sec && sec !== activeId && sections.find(s => s.id === sec)) {
        setActiveId(sec);
      }
    };
    window.addEventListener("urlchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("urlchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [activeId, sections]);

  const persist = (nextSections, nextActiveId = activeId) => {
    setSections(nextSections);
    const exists = nextSections.find(s => s.id === nextActiveId);
    setActiveId(exists ? nextActiveId : nextSections?.[0]?.id || "");
  };

  /* ===== CRUD ===== */
  const renameSection = (id, name) => {
    const nm = (name || "").trim();
    if (!nm) return;
    persist(sections.map(s => s.id === id ? { ...s, name: nm } : s), id);
  };
  const removeSection = (id) => {
    const idx = sections.findIndex(s => s.id === id);
    if (idx < 0) return;
    const next = sections.filter(s => s.id !== id);
    if (next.length === 0) return; // son sekmeyi silme
    const neighbor = next[Math.max(0, idx - 1)]?.id || next[0]?.id || "";
    persist(next, neighbor);
  };
  const move = (id, dir) => {
    const idx = sections.findIndex(s => s.id === id); if (idx < 0) return;
    const j = dir === "left" ? idx - 1 : idx + 1; if (j < 0 || j >= sections.length) return;
    const next = [...sections]; const [it] = next.splice(idx, 1); next.splice(j, 0, it);
    persist(next, id);
  };

  /* ===== TopTabsBar ===== */
  const tabs = sections.map(s => ({ id: s.id, title: s.name }));
  const getHref = (t) => `/personel?sec=${encodeURIComponent(t.id)}`;

  // WorkAreas opsiyonlarını PeopleTab'e temiz isim listesi olarak geç (nesne/karışık olabilir)
  const workAreaOptions = useMemo(() => {
    const raw = Array.isArray(effectiveWorkAreas) ? effectiveWorkAreas : [];
    const names = raw
      .map((a) => (typeof a === "string" ? clean(a) : clean(a?.name || a?.label || a?.title || a?.id)))
      .filter(Boolean);
    // uniq
    const seen = new Set();
    const out = [];
    for (const n of names) {
      const k = n.toLocaleLowerCase("tr-TR");
      if (!seen.has(k)) { seen.add(k); out.push(n); }
    }
    return out;
  }, [effectiveWorkAreas]);

  const services = useMemo(() => {
    const list = servicesModel.list?.() || [];
    if (scope.isAdmin) return list;
    const allow = new Set((scope.allowedIds || []).map(String));
    return list.filter((s) => allow.has(String(s?.id ?? s?._id ?? s?.code ?? s?.name ?? "")));
  }, [servicesModel, scope.isAdmin, scope.allowedIds]);

  // setPeople proxy'leri (normalize ederek kaydeder)
  const setNursesNormalized  = useMemo(() => makeNormalizedSetter(effectiveSetNurses), [effectiveSetNurses]);
  const setDoctorsNormalized = useMemo(() => makeNormalizedSetter(effectiveSetDoctors), [effectiveSetDoctors]);

  return (
    <div className="space-y-4">
      <TopTabsBar
        tabs={tabs}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setQueryParam("sec", id); // anında URL senkronu
        }}
        onMove={move}
        onAdd={(name) => {
          // 👇 Rolü isme göre tahmin et: "doktor" geçiyorsa doctor, aksi halde nurse
          const role = /doktor|doctor/i.test(name) ? "doctor" : "nurse";
          const base = slugifyTR(name) || (role === "doctor" ? "doktor-grubu" : "hemsire-grubu");
          const id = uniqueId(base, new Set(sections.map(s => s.id)));
          persist([...sections, { id, name, role }], id);
        }}
        onRename={renameSection}
        onRemove={removeSection}
        getHref={getHref}
        storageKey="TopTabsBar:Personnel"
      />

      {/* İçerik */}
      <div className="rounded-lg border bg-white p-4">
        <SectionContent
          section={active}
          workAreas={workAreaOptions}
          workingHours={effectiveWorkingHours}
          services={services}
          nurses={normalizePeople(effectiveNurses)}
          setNurses={setNursesNormalized}
          doctors={normalizePeople(effectiveDoctors)}
          setDoctors={setDoctorsNormalized}
        />
      </div>
    </div>
  );
}

function SectionContent({
  section,
  workAreas,
  workingHours,
  services,
  nurses, setNurses,
  doctors, setDoctors,
}) {
  if (!section) return null;

  if (section.role === "doctor") {
    return (
      <PeopleTab
        label={section.name}
        role={ROLE.Doctor}
        people={doctors}
        setPeople={setDoctors}
        workAreas={workAreas}
        workingHours={workingHours}
        services={services}
      />
    );
  }
  return (
    <PeopleTab
      label={section.name}
      role={ROLE.Nurse}
      people={nurses}
      setPeople={setNurses}
      workAreas={workAreas}
      workingHours={workingHours}
      services={services}
    />
  );
}
