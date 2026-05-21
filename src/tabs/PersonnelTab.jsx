// src/tabs/PersonnelTab.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Building2, ShieldCheck, Stethoscope, UserRound, Users } from "lucide-react";
import PeopleTab from "./PeopleTab.jsx";
import { ROLE } from "../constants/enums.js";
import { LS } from "../utils/storage.js";
import useServicesModel from "../hooks/useServicesModel.js";
import useServiceScope from "../hooks/useServiceScope.js";
import { useAppStore } from "../state/appStore.js";
import {
  normalizeWorkAreaMasterList,
  resolvePersonWorkAreaIds,
  resolvePersonWorkAreaNames,
} from "../lib/workAreasModel.js";

/** LS anahtarları */
const LS_KEY = "personnelSections";
const LS_ACTIVE = "personnelActiveSectionId";

/** Varsayılan alt sekmeler */
const DEFAULT_SECTIONS = [
  { id: "hemsireler", name: "Hemşireler", role: "nurse" },
  { id: "doktorlar",  name: "Doktorlar",  role: "doctor" },
];

const SECTION_META = {
  nurse: {
    icon: Stethoscope,
    eyebrow: "Hemşire Grupları",
    description: "Hemşire gruplarını, çalışma alanlarını ve vardiya uygunluklarını yönetin.",
  },
  doctor: {
    icon: UserRound,
    eyebrow: "Doktor Grupları",
    description: "Doktor personelini, hizmet kapsamını ve çalışma bilgilerinin temel kaydını yönetin.",
  },
};

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
function normalizePerson(p = {}, masterAreas = []) {
  return {
    ...p,
    areas: resolvePersonWorkAreaNames(p, masterAreas),
    workAreaIds: resolvePersonWorkAreaIds(p, masterAreas),
    shiftCodes: normalizeShiftCodes(p.shiftCodes ?? p.codes ?? p.shifts ?? []),
  };
}
function normalizePeople(next, masterAreas = []) {
  return Array.isArray(next) ? next.map((item) => normalizePerson(item, masterAreas)) : [];
}
// setState proxy: hem fonksiyon hem dizi kabul eder, sonuçları normalize eder
function makeNormalizedSetter(originalSet, masterAreas = []) {
  return (updater) => {
    if (typeof updater === "function") {
      originalSet((prev) => normalizePeople(updater(prev), masterAreas));
    } else {
      originalSet(normalizePeople(updater, masterAreas));
    }
  };
}

export default function PersonnelTab({
  workAreas,
  workingHours,
  nurses, setNurses,
  doctors, setDoctors,
}) {
  const storeWorkAreas    = useAppStore((s) => s.workAreas);
  const storeWorkingHours = useAppStore((s) => s.workingHours);
  const storeNurses       = useAppStore((s) => s.nurses);
  const storeDoctors      = useAppStore((s) => s.doctors);
  const storeSetNurses    = useAppStore((s) => s.setNurses);
  const storeSetDoctors   = useAppStore((s) => s.setDoctors);

  const effectiveWorkAreas    = Array.isArray(workAreas)    ? workAreas    : storeWorkAreas;
  const effectiveWorkingHours = Array.isArray(workingHours) ? workingHours : storeWorkingHours;
  const effectiveNurses       = Array.isArray(nurses)       ? nurses       : storeNurses;
  const effectiveDoctors      = Array.isArray(doctors)      ? doctors      : storeDoctors;
  const effectiveSetNurses    = typeof setNurses === "function"  ? setNurses  : storeSetNurses;
  const effectiveSetDoctors   = typeof setDoctors === "function" ? setDoctors : storeSetDoctors;

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
  const masterWorkAreas = useMemo(
    () => normalizeWorkAreaMasterList(effectiveWorkAreas),
    [effectiveWorkAreas]
  );
  // WorkAreas opsiyonlarını PeopleTab'e temiz isim listesi olarak geç
  const workAreaOptions = useMemo(
    () => masterWorkAreas.map((item) => item.name),
    [masterWorkAreas]
  );

  const services = useMemo(() => {
    const list = servicesModel.list?.() || [];
    if (scope.isAdmin) return list;
    const allow = new Set((scope.allowedIds || []).map(String));
    return list.filter((s) => allow.has(String(s?.id ?? s?._id ?? s?.code ?? s?.name ?? "")));
  }, [servicesModel, scope.isAdmin, scope.allowedIds]);

  // setPeople proxy'leri (normalize ederek kaydeder)
  const setNursesNormalized = useMemo(
    () => makeNormalizedSetter(effectiveSetNurses, masterWorkAreas),
    [effectiveSetNurses, masterWorkAreas]
  );
  const setDoctorsNormalized = useMemo(
    () => makeNormalizedSetter(effectiveSetDoctors, masterWorkAreas),
    [effectiveSetDoctors, masterWorkAreas]
  );

  const activeMeta = SECTION_META[active?.role] || SECTION_META.nurse;
  const ActiveIcon = activeMeta.icon;
  const totalPersonnel = effectiveNurses.length + effectiveDoctors.length;
  const visibleServices = services.length;

  return (
    <div className="space-y-5">
      <section className="rounded-[30px] border border-slate-200 bg-white px-5 py-5 shadow-sm md:px-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_340px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                <ActiveIcon className="h-3.5 w-3.5 text-sky-700" />
                {activeMeta.eyebrow}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                Personel Yapılandırması
              </span>
            </div>
            <div className="mt-4 flex items-start gap-4">
              <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm md:flex">
                <ActiveIcon className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{active?.name || "Personel"}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{activeMeta.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                    <Users className="h-4 w-4 text-sky-700" />
                    Toplam {totalPersonnel} personel
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                    <Building2 className="h-4 w-4 text-emerald-700" />
                    {visibleServices} servis görünür
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Aktif Grup</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{active?.name || "Personel"}</div>
              <p className="mt-1 text-sm leading-5 text-slate-600">Çalışma alanı ve vardiya uygunluğu bu grup üstünden yönetilir.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Operasyon Etkisi</div>
              <div className="mt-2 text-sm font-medium text-slate-800">Planlama, çizelgeler ve kullanıcı bağlantıları bu kayıtları kullanır.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Aktif Personel Görünümü</div>
              <div className="mt-1 text-sm text-slate-600">Sadece grubu seçin; kayıt ve düzenleme alanı aşağıda aynı şekilde çalışmaya devam eder.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sections.map((sectionItem) => {
                const isActive = sectionItem.id === activeId;
                return (
                  <button
                    key={sectionItem.id}
                    type="button"
                    onClick={() => {
                      setActiveId(sectionItem.id);
                      setQueryParam("sec", sectionItem.id);
                    }}
                    className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? "border-slate-950 bg-slate-950 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {sectionItem.role === "doctor" ? (
                      <UserRound className={`h-4 w-4 ${isActive ? "text-white" : "text-slate-500"}`} />
                    ) : (
                      <Stethoscope className={`h-4 w-4 ${isActive ? "text-white" : "text-slate-500"}`} />
                    )}
                    {sectionItem.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <SectionContent
            section={active}
            workAreas={workAreaOptions}
            workingHours={effectiveWorkingHours}
            services={services}
            nurses={normalizePeople(effectiveNurses, masterWorkAreas)}
            setNurses={setNursesNormalized}
            doctors={normalizePeople(effectiveDoctors, masterWorkAreas)}
            setDoctors={setDoctorsNormalized}
          />
        </div>
      </section>
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
