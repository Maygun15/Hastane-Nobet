// src/app/HospitalRosterApp.jsx
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Calendar as CalendarIcon, LogOut } from "lucide-react";

import ErrorBoundary from "../ErrorBoundary.jsx";
import Modal from "../components/common/Modal.jsx";

import PlanTab from "../tabs/PlanTab.jsx";
import SchedulesTab from "../tabs/SchedulesTab.jsx";
import ParametersTab from "../tabs/ParametersTab.jsx";
import PersonnelTab from "../tabs/PersonnelTab.jsx";
import { LS } from "../utils/storage.js";

// Auth
import { useAuth } from "../auth/AuthContext.jsx";
// import AuthCard from "../ui/AuthCard.jsx"; // ❌ eski mini form
import AuthDemo from "../pages/AuthDemo.jsx";      // ✅ yeni login/register sayfası

// RBAC
import { can } from "../utils/acl.js";
import { PERMISSIONS } from "../constants/roles.js";

// Sayfalar
import ServicesTab from "../tabs/ServicesTab.jsx";
import UsersTab from "../tabs/UsersTab.jsx";

// Normal kullanıcı takvimi
import PersonCalendar from "../tabs/PersonCalendar.jsx";
import { getActiveYM, setActiveYM } from "../utils/activeYM.js";
import { apiChangePassword, API, getToken } from "../lib/api.js";
import { ROLE } from "../constants/enums.js";

// Yedekleme butonları (yeni)
import BackupButtons from "../components/BackupButtons.jsx";

/* ---------------- URL yardımcıları ---------------- */
function pushUrl(pathAndQuery) {
  try {
    window.history.pushState({}, "", pathAndQuery);
    window.dispatchEvent(new Event("urlchange"));
  } catch {}
}
let historyPatched = false;
function ensureHistoryPatched() {
  if (historyPatched) return;
  historyPatched = true;
  const wrap = (t) => {
    const o = window.history[t];
    return function (...args) {
      const r = o.apply(this, args);
      try { window.dispatchEvent(new Event("urlchange")); } catch {}
      return r;
    };
  };
  try {
    window.history.pushState = wrap("pushState");
    window.history.replaceState = wrap("replaceState");
  } catch {}
}

/* ---------------- Varsayılanlar & stiller ---------------- */
const DEFAULT_PERSONNEL_SECTIONS = [
  { id: "hemsireler", name: "Hemşireler" },
  { id: "doktorlar",  name: "Doktorlar"  },
];

const NAV_H = "h-9"; // 36px
const navBase =
  `list-none inline-flex items-center ${NAV_H} rounded-lg px-3 text-[14px] font-medium cursor-pointer border select-none transition-colors`;
const navActive = "bg-sky-600 text-white border-sky-600";
const navIdle   = "bg-slate-100 hover:bg-slate-200 text-slate-800";

const LEAVE_TYPES_LS_KEYS = ["leaveTypesV2", "leaveTypes", "izinTurleri"];
function readLeaveTypesFromLS() {
  if (typeof localStorage === "undefined") return [];
  try {
    for (const k of LEAVE_TYPES_LS_KEYS) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const val = JSON.parse(raw);
      if (Array.isArray(val)) return val;
      if (val && typeof val === "object") {
        if (Array.isArray(val.leaveTypes)) return val.leaveTypes;
        if (Array.isArray(val.izinTurleri)) return val.izinTurleri;
      }
    }
  } catch {}
  return [];
}
function sameLeaveTypes(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] || {};
    const y = b[i] || {};
    if (
      x.id !== y.id ||
      x.code !== y.code ||
      x.name !== y.name ||
      !!x.countsAsWorked !== !!y.countsAsWorked ||
      Number(x.hoursPerDay) !== Number(y.hoursPerDay)
    ) {
      return false;
    }
  }
  return true;
}

/* ======================= APP ======================= */
export default function HospitalRosterApp() {
  ensureHistoryPatched();

  const { user, logout, refresh } = useAuth();

  /* Giriş yapılmamışsa yeni AuthDemo sayfasını göster */
  if (!user) return <AuthDemo />;

  /* ---- RBAC bayrakları ---- */
  const roleOf = (u) => String(u?.role || u?.roleKey || u?.type || "").toUpperCase();
  const has = (perm) => { try { return !!can(user, perm); } catch { return false; } };

  // Admin tanımı
  const isAdmin =
    roleOf(user) === "ADMIN" ||
    has(PERMISSIONS.USERS_WRITE) ||
    has(PERMISSIONS.PARAMETERS_WRITE) ||
    has(PERMISSIONS.SERVICES_WRITE);

  // Yetkili tanımı (STAFF eklendi)
  const isAuthorized =
    !isAdmin && (
      roleOf(user) === "AUTHORIZED" ||
      roleOf(user) === "MANAGER"   ||
      roleOf(user) === "STAFF"     ||
      has(PERMISSIONS.SCHEDULE_WRITE) ||
      has(PERMISSIONS.LEAVES_WRITE) ||
      (Array.isArray(user?.serviceIds) && user.serviceIds.length > 0)
    );

  const isBasicUser  = !!user && !isAdmin && !isAuthorized;

  const canSeePersonnel   = isAdmin || isAuthorized;   // Personel
  const canSeeSchedules   = isAdmin || isAuthorized;   // Çizelgeler
  const canSeeParameters  = isAdmin;                   // Parametreler (yalnız Admin)
  const canSeeServicesTab = isAdmin || isAuthorized;   // Servisler: Admin + Yetkili
  const canSeeUsersTab    = isAdmin;                   // Kullanıcılar: yalnız Admin

  const [activeTab, setActiveTab] = useState("plan");

  /* ---- LS state’leri ---- */
  const [workAreas, setWorkAreas] = useState(LS.get("workAreas", []));
  const [nurses, setNurses] = useState(LS.get("nurses", []));
  const [doctors, setDoctors] = useState(LS.get("doctors", []));
  const [workingHours, setWorkingHours] = useState(LS.get("workingHours", []));
  const [leaveTypes, setLeaveTypes] = useState(() => readLeaveTypesFromLS());
  const [personLeaves, setPersonLeaves] = useState(LS.get("personLeaves", {}));
  const [requestBox, setRequestBox] = useState(LS.get("requestBoxV1", []));

  useEffect(() => {
    LS.set("workAreas", workAreas);
    try {
      window.dispatchEvent(new Event("workAreas:changed"));
      window.dispatchEvent(new Event("settings:changed"));
    } catch {}
  }, [workAreas]);
  useEffect(() => {
    LS.set("nurses", nurses);
    try { window.dispatchEvent(new Event("people:changed")); } catch {}
  }, [nurses]);
  useEffect(() => {
    LS.set("doctors", doctors);
    try { window.dispatchEvent(new Event("people:changed")); } catch {}
  }, [doctors]);
  useEffect(() => {
    LS.set("workingHours", workingHours);
    try {
      window.dispatchEvent(new Event("workingHours:changed"));
      window.dispatchEvent(new Event("settings:changed"));
    } catch {}
  }, [workingHours]);
  useEffect(() => {
    LS.set("leaveTypes", leaveTypes);
    LS.set("leaveTypesV2", leaveTypes);
    LS.set("izinTurleri", leaveTypes);
    try { window.dispatchEvent(new Event("leaveTypes:changed")); } catch {}
  }, [leaveTypes]);
  useEffect(() => { LS.set("personLeaves", personLeaves); }, [personLeaves]);
  useEffect(() => { LS.set("requestBoxV1", requestBox); }, [requestBox]);

  useEffect(() => {
    const syncLeaveTypes = () => {
      const next = readLeaveTypesFromLS();
      setLeaveTypes((prev) => (sameLeaveTypes(prev, next) ? prev : next));
    };
    const onStorage = (e) => {
      if (!e || !LEAVE_TYPES_LS_KEYS.includes(e.key)) return;
      syncLeaveTypes();
    };
    window.addEventListener("leaveTypes:changed", syncLeaveTypes);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("leaveTypes:changed", syncLeaveTypes);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /* ---- Backend parametre sync (online-only) ---- */
  const settingsLoadedRef = useRef(false);
  const saveTimersRef = useRef({ wa: null, wh: null, lt: null, rq: null });

  useEffect(() => {
    let alive = true;
    const token = getToken();
    if (!token) return undefined;
    (async () => {
      try {
        const wa = await API.http.get(`/api/settings/workAreas?serviceId=`);
        const wh = await API.http.get(`/api/settings/workingHours?serviceId=`);
        const lt = await API.http.get(`/api/settings/leaveTypes?serviceId=`);
        const rq = await API.http.get(`/api/settings/requestBoxV1?serviceId=`);
        if (!alive) return;
        if (Array.isArray(wa?.value)) setWorkAreas(wa.value);
        if (Array.isArray(wh?.value)) setWorkingHours(wh.value);
        if (Array.isArray(lt?.value)) setLeaveTypes(lt.value);
        if (Array.isArray(rq?.value)) setRequestBox(rq.value);
      } catch (err) {
        console.warn("Settings fetch failed:", err?.message || err);
      } finally {
        settingsLoadedRef.current = true;
      }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const saveSetting = useCallback(async (key, value) => {
    await API.http.req(`/api/settings/${key}`, {
      method: "PUT",
      body: { value, serviceId: "" },
    });
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (!isAdmin) return;
    if (saveTimersRef.current.wa) clearTimeout(saveTimersRef.current.wa);
    saveTimersRef.current.wa = setTimeout(() => {
      saveSetting("workAreas", workAreas).catch((err) =>
        console.warn("workAreas save failed:", err?.message || err)
      );
    }, 600);
    return () => {
      if (saveTimersRef.current.wa) clearTimeout(saveTimersRef.current.wa);
    };
  }, [workAreas, isAdmin, saveSetting]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (!isAdmin) return;
    if (saveTimersRef.current.wh) clearTimeout(saveTimersRef.current.wh);
    saveTimersRef.current.wh = setTimeout(() => {
      saveSetting("workingHours", workingHours).catch((err) =>
        console.warn("workingHours save failed:", err?.message || err)
      );
    }, 600);
    return () => {
      if (saveTimersRef.current.wh) clearTimeout(saveTimersRef.current.wh);
    };
  }, [workingHours, isAdmin, saveSetting]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (!isAdmin) return;
    if (saveTimersRef.current.lt) clearTimeout(saveTimersRef.current.lt);
    saveTimersRef.current.lt = setTimeout(() => {
      saveSetting("leaveTypes", leaveTypes).catch((err) =>
        console.warn("leaveTypes save failed:", err?.message || err)
      );
    }, 600);
    return () => {
      if (saveTimersRef.current.lt) clearTimeout(saveTimersRef.current.lt);
    };
  }, [leaveTypes, isAdmin, saveSetting]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (!isAdmin) return;
    if (saveTimersRef.current.rq) clearTimeout(saveTimersRef.current.rq);
    saveTimersRef.current.rq = setTimeout(() => {
      saveSetting("requestBoxV1", requestBox).catch((err) =>
        console.warn("requestBox save failed:", err?.message || err)
      );
    }, 600);
    return () => {
      if (saveTimersRef.current.rq) clearTimeout(saveTimersRef.current.rq);
    };
  }, [requestBox, isAdmin, saveSetting]);

  const peopleAll = useMemo(() => [...(doctors || []), ...(nurses || [])], [doctors, nurses]);

  /* ---- Backend’den personel çek ---- */
  const reloadPersonnel = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const data = await API.http.get(`/api/personnel?page=1&size=2000`);
      const items = Array.isArray(data?.items) ? data.items : [];

      const mapped = items.map((p) => {
        const meta = p?.meta || {};
        const roleHint = String(meta.role || p.title || "").toLowerCase();
        const isDoctor = /doktor|doctor|hekim|tabip/.test(roleHint);
        const fullName =
          p.fullName ||
          [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
        const service =
          (p.serviceId || p.service || meta.service || "acil")
            .toString()
            .trim()
            .toLowerCase();
        return {
          id: p.id,
          role: isDoctor ? ROLE.Doctor : ROLE.Nurse,
          service,
          title: meta.title || p.title || "",
          tc: p.tc || "",
          name: fullName || "",
          phone: p.phone || "",
          mail: p.email || "",
          areas: Array.isArray(p.areas) ? p.areas : Array.isArray(meta.areas) ? meta.areas : [],
          shiftCodes: Array.isArray(meta.shiftCodes) ? meta.shiftCodes : [],
        };
      });

      setNurses(mapped.filter((p) => p.role === ROLE.Nurse));
      setDoctors(mapped.filter((p) => p.role === ROLE.Doctor));
    } catch (e) {
      console.warn("Personnel load error:", e?.message || e);
    }
  }, [setNurses, setDoctors]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await reloadPersonnel();
    })();
    return () => { alive = false; };
  }, [user, reloadPersonnel]);

  useEffect(() => {
    const onPersonnelChanged = () => {
      reloadPersonnel();
    };
    window.addEventListener("personnel:changed", onPersonnelChanged);
    return () => window.removeEventListener("personnel:changed", onPersonnelChanged);
  }, [reloadPersonnel]);

  const visibleWorkAreas = useMemo(() => {
    if (!user) return [];
    const arr = Array.isArray(workAreas) ? workAreas : [];
    if (isAdmin) return arr;
    const allowed = new Set(user?.serviceIds || []);
    if (allowed.size === 0) return arr;
    return arr.filter((w) => {
      if (!w || typeof w !== "object") return true; // string list ise filtreleme
      const sid = w.serviceId || w.service || "";
      if (!sid) return true; // servis bağı yoksa göster
      return allowed.has(sid);
    });
  }, [user, workAreas, isAdmin]);

  /* ---- dropdown helpers ---- */
  const personnelDdRef = useRef(null);
  const schedulesDdRef = useRef(null);
  const paramsDdRef = useRef(null);
  const hoverTimers = useRef({ personnel: null, schedules: null, params: null });

  const openDetails = (ref) => { if (ref.current && !ref.current.open) ref.current.setAttribute("open", ""); };
  const closeDetails = (ref) => { if (ref.current && ref.current.open) ref.current.removeAttribute("open"); };
  const closePersonnelDd = useCallback(() => closeDetails(personnelDdRef), []);
  const closeSchedulesDd = useCallback(() => closeDetails(schedulesDdRef), []);
  const closeParamsDd = useCallback(() => closeDetails(paramsDdRef), []);

  /* ---- Navbar Personel dropdown (LS) ---- */
  const [personnelSections, setPersonnelSections] = useState(
    () => LS.get("personnelSections", DEFAULT_PERSONNEL_SECTIONS)
  );
  useEffect(() => {
    const refreshPersonnelMenu = () => {
      setPersonnelSections(LS.get("personnelSections", DEFAULT_PERSONNEL_SECTIONS));
    };
    window.addEventListener("personnelSectionsChanged", refreshPersonnelMenu);
    window.addEventListener("storage", refreshPersonnelMenu);
    return () => {
      window.removeEventListener("personnelSectionsChanged", refreshPersonnelMenu);
      window.removeEventListener("storage", refreshPersonnelMenu);
    };
  }, []);

  /* ---- URL -> aktif tab senkronu ---- */
  useEffect(() => {
    const syncFromLocation = () => {
      const { pathname, hash } = window.location;

      if (hash.startsWith("#/parametreler") || pathname.startsWith("/parametreler")) {
        if (!canSeeParameters) return setActiveTab("plan");
        if (activeTab !== "parameters") setActiveTab("parameters");
        return;
      }
      if (hash.startsWith("#/cizelgeler") || pathname.startsWith("/cizelgeler")) {
        if (!canSeeSchedules) return setActiveTab("plan");
        if (activeTab !== "schedules") setActiveTab("schedules");
        return;
      }
      if (pathname.startsWith("/personel")) {
        if (!canSeePersonnel) return setActiveTab("plan");
        if (activeTab !== "personnel") setActiveTab("personnel");
        return;
      }
      if (pathname.startsWith("/kullanicilar") || hash.startsWith("#/kullanicilar")) {
        if (!canSeeUsersTab) return setActiveTab("plan");
        if (activeTab !== "users") setActiveTab("users");
        return;
      }
      if (pathname.startsWith("/servisler") || hash.startsWith("#/servisler")) {
        if (!canSeeServicesTab) return setActiveTab("plan");
        if (activeTab !== "services") setActiveTab("services");
        return;
      }
      if (activeTab !== "plan") setActiveTab("plan");
    };
    syncFromLocation();
    window.addEventListener("urlchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("hashchange", syncFromLocation);
    return () => {
      window.removeEventListener("urlchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("hashchange", syncFromLocation);
    };
  }, [activeTab, canSeePersonnel, canSeeSchedules, canSeeParameters, canSeeServicesTab, canSeeUsersTab]);

  /* ---- Nav helpers ---- */
  const goSchedules = useCallback((secId) => {
    setActiveTab("schedules");
    if (typeof location !== "undefined") {
      location.hash = secId ? `/cizelgeler/${encodeURIComponent(secId)}` : `/cizelgeler`;
    }
    closeSchedulesDd();
  }, [closeSchedulesDd]);

  const goPersonnel = useCallback((secId) => {
    setActiveTab("personnel");
    pushUrl(secId ? `/personel?sec=${encodeURIComponent(secId)}` : `/personel`);
    closePersonnelDd();
  }, [closePersonnelDd]);

  const goParams = useCallback((subId) => {
    setActiveTab("parameters");
    if (typeof location !== "undefined") {
      location.hash = `/parametreler/${subId}`;
    }
    closeParamsDd();
  }, [closeParamsDd]);

  const goServices = useCallback(() => {
    setActiveTab("services");
    pushUrl("/servisler");
    closePersonnelDd();
    closeSchedulesDd();
    closeParamsDd();
  }, [closePersonnelDd, closeSchedulesDd, closeParamsDd]);

  /* ======================= RENDER ======================= */
  return (
    <ErrorBoundary>
      <div className="w-screen h-screen bg-slate-50 text-slate-800 flex flex-col">
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b shadow-sm">
          {/* Satır 1: Logo + (sağda) yedek & kullanıcı */}
          <div className="max-w-[1400px] mx-auto w-full px-4 py-2 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-sky-600" />
              <div className="font-semibold text-[14px] leading-none">Hastane Nöbet Sistemi v1.0.1</div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* Yedekleme butonları (yeni) */}
              <BackupButtons />

              <UserBadge
                user={user}
                onLogout={async () => {
                  try { await logout?.(); } catch {}
                }}
                onChanged={refresh}
              />
            </div>
          </div>

          {/* Satır 2: Sekmeler */}
          <div className="max-w-[1400px] mx-auto w-full px-4 pb-3">
            <nav className="flex flex-wrap gap-2">
              <NavBtn
                active={activeTab === "plan"}
                onClick={() => {
                  setActiveTab("plan");
                  if (typeof location !== "undefined") location.hash = "";
                  pushUrl("/");
                  closePersonnelDd();
                  closeSchedulesDd();
                  closeParamsDd();
                }}
              >
                {isBasicUser ? "Takvimim" : "Planlama"}
              </NavBtn>

              {/* PERSONEL — admin & yetkili */}
              {canSeePersonnel && (
                <div
                  className="relative z-20"
                  onMouseEnter={() => {
                    clearTimeout(hoverTimers.current.personnel);
                    openDetails(personnelDdRef);
                    closeSchedulesDd();
                    closeParamsDd();
                  }}
                  onMouseLeave={() => {
                    hoverTimers.current.personnel = setTimeout(() => { closePersonnelDd(); }, 120);
                  }}
                >
                  <details
                    className="group"
                    ref={personnelDdRef}
                    onToggle={(e) => { if (e.currentTarget.open) { closeSchedulesDd(); closeParamsDd(); } }}
                  >
                    <summary
                      className={`${navBase} ${activeTab === "personnel" ? navActive : navIdle}`}
                      aria-haspopup="menu"
                      aria-expanded={activeTab === "personnel" ? "true" : "false"}
                      onClick={(e) => {
                        setActiveTab("personnel");
                        const open = personnelDdRef.current?.hasAttribute("open");
                        e.currentTarget.setAttribute("aria-expanded", String(!open));
                      }}
                    >
                      Personel
                      <svg className="ml-1 h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                        <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.4a.75.75 0 0 1-1.08 0l-4.25-4.4a.75.75 0 0 1 .02-1.06z" />
                      </svg>
                    </summary>

                    <div role="menu" className="absolute top-full left-0 mt-2 w-72 rounded-xl border bg-white shadow-lg overflow-hidden z-20">
                      {personnelSections.map((s) => (
                        <DropdownItem key={s.id} onSelect={() => goPersonnel(s.id)}>
                          {s.name}
                        </DropdownItem>
                      ))}
                      <div className="border-t my-1" />
                      <DropdownItem onSelect={() => goPersonnel()}>
                        Personel sayfasını aç
                      </DropdownItem>
                      <div className="px-3 py-2 text-xs text-gray-500">
                        Alt sekmeleri <b>Personel</b> içinde <i>Ekle / Düzenle / Sil</i> ile yönetebilirsiniz.
                      </div>
                    </div>
                  </details>
                </div>
              )}

              {/* ÇİZELGELER — admin & yetkili */}
              {canSeeSchedules && (
                <div
                  className="relative z-20"
                  onMouseEnter={() => {
                    clearTimeout(hoverTimers.current.schedules);
                    openDetails(schedulesDdRef);
                    closePersonnelDd();
                    closeParamsDd();
                  }}
                  onMouseLeave={() => {
                    hoverTimers.current.schedules = setTimeout(() => { closeSchedulesDd(); }, 120);
                  }}
                >
                  <details className="group" ref={schedulesDdRef} onToggle={(e) => { if (e.currentTarget.open) { closePersonnelDd(); closeParamsDd(); } }}>
                    <summary
                      className={`${navBase} ${activeTab === "schedules" ? navActive : navIdle}`}
                      aria-haspopup="menu"
                      aria-expanded={activeTab === "schedules" ? "true" : "false"}
                    >
                      Çizelgeler
                      <svg className="ml-1 h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                        <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.4a.75.75 0 0 1-1.08 0l-4.25-4.4a.75.75 0 0 1 .02-1.06z" />
                      </svg>
                    </summary>
                    <div role="menu" className="absolute top-full left-0 mt-2 w-96 rounded-xl border bg-white shadow-lg overflow-hidden z-20">
                      <DropdownItem onSelect={() => goSchedules("calisma-cizelgesi")}>Çalışma Çizelgesi</DropdownItem>
                      <DropdownItem onSelect={() => goSchedules("aylik-calisma-ve-mesai-saatleri-cizelgesi")}>Aylık Çalışma ve Mesai Saatleri Çizelgesi</DropdownItem>
                      <DropdownItem onSelect={() => goSchedules("fazla-mesai-takip")}>Fazla Mesai Takip Formu</DropdownItem>
                      <DropdownItem onSelect={() => goSchedules("toplu-izin-listesi")}>Toplu İzin Listesi</DropdownItem>
                      <div className="border-t my-1" />
                      <div className="px-3 py-2 text-xs text-gray-500">
                        Sekmeleri <b>Çizelgeler</b> sayfasında <i>Ekle / Düzenle / Sil</i> ile yönetebilirsiniz.
                      </div>
                    </div>
                  </details>
                </div>
              )}

              {/* PARAMETRELER — yalnız admin */}
              {canSeeParameters && (
                <div
                  className="relative z-30"
                  onMouseEnter={() => {
                    clearTimeout(hoverTimers.current.params);
                    openDetails(paramsDdRef);
                    closePersonnelDd();
                    closeSchedulesDd();
                  }}
                  onMouseLeave={() => {
                    hoverTimers.current.params = setTimeout(() => { closeParamsDd(); }, 120);
                  }}
                >
                  <details className="group" ref={paramsDdRef} onToggle={(e) => { if (e.currentTarget.open) { closePersonnelDd(); closeSchedulesDd(); } }}>
                    <summary
                      className={`${navBase} ${activeTab === "parameters" ? navActive : navIdle}`}
                      aria-haspopup="menu"
                      aria-expanded={activeTab === "parameters" ? "true" : "false"}
                    >
                      Parametreler
                      <svg className="ml-1 h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                        <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.4a.75.75 0 0 1-1.08 0l-4.25-4.4a.75.75 0 0 1 .02-1.06z" />
                      </svg>
                    </summary>
                    <div role="menu" className="absolute top-full left-0 mt-2 w-80 rounded-xl border bg-white shadow-lg overflow-hidden z-30">
                      <DropdownItem onSelect={() => goParams("calisma-alanlari")}>Çalışma Alanları</DropdownItem>
                      <DropdownItem onSelect={() => goParams("calisma-saatleri")}>Çalışma Saatleri</DropdownItem>
                      <DropdownItem onSelect={() => goParams("izin-turleri")}>İzin Türleri</DropdownItem>
                      <DropdownItem onSelect={() => goParams("tatil-takvimi")}>Tatil Takvimi</DropdownItem>
                      <DropdownItem onSelect={() => goParams("nobet-kurallari")}>Nöbet Kuralları</DropdownItem>
                      <DropdownItem onSelect={() => goParams("istek")}>İstek</DropdownItem>
                      <div className="border-t my-1" />
                      <div className="px-3 py-2 text-xs text-gray-500">Alt sayfalar <b>Parametreler</b> içinde sekmeli olarak açılır.</div>
                    </div>
                  </details>
                </div>
              )}

              {/* SERVİSLER — Admin + Yetkili  |  KULLANICILAR — yalnız Admin */}
              {canSeeServicesTab && (
                <NavBtn active={activeTab === "services"} onClick={goServices}>Servisler</NavBtn>
              )}
              {canSeeUsersTab && (
                <NavBtn
                  active={activeTab === "users"}
                  onClick={() => { setActiveTab("users"); pushUrl("/kullanicilar"); }}
                >
                  Kullanıcılar
                </NavBtn>
              )}
            </nav>
          </div>
        </header>

        <main className="flex-1 w-full px-6 py-6 space-y-6 overflow-auto max-w-[1400px] mx-auto">
          {activeTab === "plan" && (
            isBasicUser ? (
              <MyCalendarBox me={user} leaveTypes={leaveTypes} />
            ) : (
              <PlanTab
                workAreas={workAreas}
                nurses={nurses}
                doctors={doctors}
                peopleAll={peopleAll}
                leaveTypes={leaveTypes}
                personLeaves={personLeaves}
                setPersonLeaves={setPersonLeaves}
                workingHours={workingHours}
              />
            )
          )}

          {activeTab === "personnel" && (
            canSeePersonnel ? (
              <PersonnelTab
                workAreas={workAreas}
                workingHours={workingHours}
                nurses={nurses}
                setNurses={setNurses}
                doctors={doctors}
                setDoctors={setDoctors}
              />
            ) : <NeedAuth />
          )}

          {activeTab === "schedules" && (
            canSeeSchedules ? <SchedulesTab workAreas={visibleWorkAreas} /> : <NeedAuth />
          )}

          {activeTab === "parameters" && (
            canSeeParameters ? (
              <ParametersTab
                workAreas={workAreas}
                setWorkAreas={setWorkAreas}
                workingHours={workingHours}
                setWorkingHours={setWorkingHours}
                leaveTypes={leaveTypes}
                setLeaveTypes={setLeaveTypes}
                requestBox={requestBox}
                setRequestBox={setRequestBox}
                people={peopleAll}
              />
            ) : <NeedAdmin />
          )}

          {activeTab === "services" && (
            canSeeServicesTab ? <ServicesTab /> : <NeedAdminOrAuthorized />
          )}

          {activeTab === "users" && (
            canSeeUsersTab ? <UsersTab /> : <NeedAdmin />
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}

/* ---------------- Sağ üst kullanıcı etiketi ---------------- */
function UserBadge({ user, onLogout, onChanged }) {
  const [busy, setBusy] = React.useState(false);
  const [changeOpen, setChangeOpen] = React.useState(false);
  const forceChange = !!user?.mustChangePassword;

  React.useEffect(() => {
    if (forceChange) setChangeOpen(true);
  }, [forceChange]);

  if (!user) return null;
  const email = user.email || user.username || user.name || "Kullanıcı";
  const role = (user.role || user.roleKey || "").toString().toLowerCase();

  const roleLabel =
    role === "admin" ? "admin" :
    role === "authorized" || role === "manager" || role === "staff" ? "yetkili" : "user";

  return (
    <div className="flex items-center gap-2 pl-2 ml-2 border-l">
      <div className="text-[13px] text-slate-600 truncate max-w-[220px]">
        <span className="font-medium text-slate-800 truncate inline-block max-w-full">{email}</span>{" "}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] ml-1
          ${roleLabel === "admin" ? "bg-rose-100 text-rose-700"
            : roleLabel === "yetkili" ? "bg-amber-100 text-amber-700"
            : "bg-slate-100 text-slate-700"}`}>
          {roleLabel}
        </span>
      </div>

      <button
        className="inline-flex items-center gap-1.5 text-[13px] px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200"
        onClick={() => setChangeOpen(true)}
        title="Şifre değiştir"
      >
        Şifre Değiştir
      </button>

      <button
        className="inline-flex items-center gap-1.5 text-[13px] px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-60"
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await onLogout?.();
          } finally {
            setBusy(false);
            try { window.history.pushState({}, "", "/"); window.dispatchEvent(new Event("urlchange")); } catch {}
          }
        }}
        disabled={busy}
        title="Çıkış yap"
      >
        <LogOut className="w-4 h-4" />
        {busy ? "Çıkış yapılıyor…" : "Logout"}
      </button>

      <ChangePasswordModal open={changeOpen} onClose={() => setChangeOpen(false)} force={forceChange} onChanged={onChanged} />
    </div>
  );
}

function ChangePasswordModal({ open, onClose, force = false, onChanged }) {
  const [oldPass, setOldPass] = React.useState("");
  const [newPass, setNewPass] = React.useState("");
  const [newPass2, setNewPass2] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setOldPass("");
      setNewPass("");
      setNewPass2("");
      setMsg("");
      setSaving(false);
    }
  }, [open]);

  const disabled =
    saving ||
    !oldPass ||
    (newPass || "").length < 6 ||
    newPass !== newPass2;

  async function handleSubmit(e) {
    e.preventDefault();
    if (disabled) return;
    setMsg("");
    setSaving(true);
    try {
      await apiChangePassword(oldPass, newPass);
      await onChanged?.();
      setMsg("Şifre güncellendi.");
      setTimeout(() => onClose?.(), 600);
    } catch (err) {
      setMsg(err.message || "Şifre değiştirilemedi");
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-sky-400";
  const modalOnClose = force ? undefined : onClose;

  return (
    <Modal open={open} onClose={modalOnClose} title="Şifre Değiştir" maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          className={input}
          type="password"
          placeholder="Mevcut şifre"
          value={oldPass}
          onChange={(e) => setOldPass(e.target.value)}
          autoComplete="current-password"
        />
        <input
          className={input}
          type="password"
          placeholder="Yeni şifre (min 6)"
          value={newPass}
          onChange={(e) => setNewPass(e.target.value)}
          autoComplete="new-password"
        />
        <input
          className={input}
          type="password"
          placeholder="Yeni şifre (tekrar)"
          value={newPass2}
          onChange={(e) => setNewPass2(e.target.value)}
          autoComplete="new-password"
        />

        {force && (
          <div className="text-xs text-amber-700">İlk girişte şifreyi değiştirmeniz gerekiyor.</div>
        )}

        {!!msg && (
          <div className="text-sm text-slate-700">{msg}</div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {!force && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50"
            >
              Vazgeç
            </button>
          )}
          <button
            type="submit"
            disabled={disabled}
            className="px-3 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </form>
    </Modal>
  );
}


/* ---------------- Normal kullanıcı: “Takvimim” ---------------- */
function MyCalendarBox({ me, leaveTypes }) {
  const [ym, setYm] = useState(() => getActiveYM());
  const year = ym.year;
  const monthIndex = ym.month - 1;

  const goto = (delta) => {
    const dt = new Date(year, monthIndex, 1);
    dt.setMonth(dt.getMonth() + delta);
    const next = { year: dt.getFullYear(), month: dt.getMonth() + 1 };
    setYm(next);
    setActiveYM(next);
  };

  const person = useMemo(() => ({
    id: String(me?.id ?? me?.userId ?? me?.email ?? "me"),
    name: me?.name || me?.fullName || me?.email || "Ben",
    role: me?.role || "USER",
  }), [me]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
        <div className="font-semibold">Takvimim</div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => goto(-1)} className="px-2 py-1 rounded bg-slate-100">Önceki Ay</button>
          <div className="text-slate-500">{(monthIndex + 1)}.{year}</div>
          <button onClick={() => goto(1)} className="px-2 py-1 rounded bg-slate-100">Sonraki Ay</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4">
        <PersonCalendar person={person} year={year} month={monthIndex} leaveTypes={leaveTypes} />
      </div>
    </div>
  );
}

/* ---------------- Küçük uyarı bileşenleri ---------------- */
function NeedAuth() {
  return (
    <div className="p-4 rounded-md bg-yellow-50 border text-yellow-900">
      Bu sayfayı görmek için giriş yapmalısınız.
    </div>
  );
}
function NeedAdmin() {
  return (
    <div className="p-4 rounded-md bg-red-50 border text-red-900">
      Bu sayfayı yalnızca <b>admin</b> kullanıcılar görebilir.
    </div>
  );
}
function NeedAdminOrAuthorized() {
  return (
    <div className="p-4 rounded-md bg-amber-50 border text-amber-900">
      Bu sayfayı yalnızca <b>admin</b> veya <b>yetkili</b> kullanıcılar görebilir.
    </div>
  );
}

/* ---------------- Küçük yardımcılar ---------------- */
function NavBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`${navBase} ${active ? navActive : navIdle}`}>
      {children}
    </button>
  );
}
function DropdownItem({ onSelect, children }) {
  return (
    <button
      role="menuitem"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(); }
      }}
      onClick={onSelect}
      className="w-full text-left px-4 py-2.5 text-[14px] hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
    >
      {children}
    </button>
  );
}
