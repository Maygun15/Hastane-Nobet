// src/app/HospitalRosterApp.jsx
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Toaster } from "sonner";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldCheck,
  UserRound,
  Users2,
} from "lucide-react";

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
import UsersTab from "../tabs/UsersTab.jsx";
import MyRequestsTab from "../tabs/MyRequestsTab.jsx";
import RequestsManagementTab from "../tabs/RequestsManagementTab.jsx";
import UserProfile from "../components/UserProfile.jsx";
import AIChatPanel from "../components/AIChatPanel.jsx";
import FloatingAIChat from "../components/FloatingAIChat.jsx";
import DashboardPage from "../pages/DashboardPage.jsx";
import AISchedulerPage from "../pages/AISchedulerPage.jsx";

// Normal kullanıcı takvimi
import PersonScheduleCalendar from "../components/PersonScheduleCalendar.jsx";
import { getActiveYM, setActiveYM } from "../utils/activeYM.js";
import { apiChangePassword, API, getToken } from "../lib/api.js";
import { getAllLeaves } from "../lib/leaves.js";
import { ROLE } from "../constants/enums.js";
import { AppDataProvider } from "../context/AppDataContext.jsx";

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
  `list-none inline-flex items-center gap-2 ${NAV_H} rounded-xl px-3.5 text-[14px] font-medium cursor-pointer border select-none transition-all duration-150`;
const navActive = "bg-slate-900 text-white border-slate-900 shadow-[0_10px_24px_-16px_rgba(15,23,42,0.85)]";
const navIdle   = "bg-white hover:bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300";

// Leave types artık yalnızca backend üzerinden gelir.

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
  const isStaff = roleOf(user) === "STAFF";
  const isAuthorized =
    !isAdmin && (
      isStaff ||
      roleOf(user) === "AUTHORIZED" ||
      roleOf(user) === "MANAGER"   ||
      has(PERMISSIONS.SCHEDULE_WRITE) ||
      has(PERMISSIONS.LEAVES_WRITE)
    );

  const isBasicUser  = !!user && !isAdmin && !isAuthorized;

  const canSeePersonnel   = isAdmin || isAuthorized;   // Personel
  const canSeeSchedules   = isAdmin || isAuthorized;   // Çizelgeler
  const canSeeParameters  = isAdmin;                   // Parametreler (yalnız Admin)
  const canSeeUsersTab    = isAdmin;                   // Kullanıcılar: yalnız Admin
  const canSeeAI          = isAdmin || isAuthorized;   // AI Asistan: Admin + Yetkili
  const canSeeDashboard   = isAdmin || isAuthorized;   // Dashboard: Admin + Yetkili
  const canSeeAIScheduler = isAdmin || isAuthorized;   // AI Çizelge: Admin + Yetkili

  const [activeTab, setActiveTab] = useState(() => (isAdmin || isAuthorized) ? "dashboard" : "plan");
  const [navOrder, setNavOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem("navOrder")) || ["dashboard", "plan", "personnel", "schedules", "parameters", "users", "aiScheduler"]; }
    catch { return ["dashboard", "plan", "personnel", "schedules", "parameters", "users", "aiScheduler"]; }
  });

  const handleDragStart = (e, id) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    if (draggedId === targetId) return;
    setNavOrder(prev => {
      const copy = [...prev];
      const fromIdx = copy.indexOf(draggedId);
      const toIdx = copy.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, draggedId);
      localStorage.setItem("navOrder", JSON.stringify(copy));
      return copy;
    });
  };

  useEffect(() => {
    if (isBasicUser && activeTab !== "plan" && activeTab !== "myRequests" && activeTab !== "profile") {
      setActiveTab("plan");
      pushUrl("/");
    }
  }, [isBasicUser, activeTab]);

  /* ---- Mongo-first state’ler (LS sadece cache) ---- */
  const [workAreas, setWorkAreas] = useState([]);
  const [nurses, setNurses] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [workingHours, setWorkingHours] = useState(() => {
    const v2 = LS.get("workingHoursV2", null);
    const v1 = LS.get("workingHours", null);
    return Array.isArray(v2) ? v2 : Array.isArray(v1) ? v1 : [];
  });
  const [leaveTypes, setLeaveTypes] = useState(() => {
    const v2 = LS.get("leaveTypesV2", null);
    const v1 = LS.get("leaveTypes", null);
    const legacy = LS.get("izinTurleri", null);
    return Array.isArray(v2) ? v2 : Array.isArray(v1) ? v1 : Array.isArray(legacy) ? legacy : [];
  });
  const [personLeaves, setPersonLeaves] = useState({});
  const [requestBox, setRequestBox] = useState([]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    LS.set("workAreas", workAreas);
    LS.set("workAreasV2", workAreas);
    try {
      window.dispatchEvent(new Event("workAreas:changed"));
      window.dispatchEvent(new Event("settings:changed"));
    } catch {}
  }, [workAreas]);
  useEffect(() => {
    if (!personnelLoadedRef.current) return;
    LS.set("nurses", nurses);
    try { window.dispatchEvent(new Event("people:changed")); } catch {}
  }, [nurses]);
  useEffect(() => {
    if (!personnelLoadedRef.current) return;
    LS.set("doctors", doctors);
    try { window.dispatchEvent(new Event("people:changed")); } catch {}
  }, [doctors]);
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    LS.set("workingHours", workingHours);
    LS.set("workingHoursV2", workingHours);
    try {
      window.dispatchEvent(new Event("workingHours:changed"));
      window.dispatchEvent(new Event("settings:changed"));
    } catch {}
  }, [workingHours]);
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    LS.set("leaveTypes", leaveTypes);
    LS.set("leaveTypesV2", leaveTypes);
    LS.set("izinTurleri", leaveTypes);
    try { window.dispatchEvent(new Event("leaveTypes:changed")); } catch {}
  }, [leaveTypes]);
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    LS.set("personLeaves", personLeaves);
  }, [personLeaves]);

  useEffect(() => {
    if (!personnelLoadedRef.current) return;
    const canonical = [...(doctors || []), ...(nurses || [])]
      .map((p) => {
        const pid = String(p?.personId || p?.id || "").trim();
        if (!pid) return null;
        const serviceId = String(p?.serviceId ?? p?.service ?? p?.department ?? "").trim();
        return {
          ...p,
          id: pid,
          personId: pid,
          serviceId,
          service: serviceId,
          fullName: p?.fullName || p?.name || "",
          name: p?.name || p?.fullName || "",
        };
      })
      .filter(Boolean);
    LS.set("peopleV2", canonical);
    LS.set("people", canonical);
    try { window.dispatchEvent(new Event("people:changed")); } catch {}
  }, [doctors, nurses]);
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    LS.set("requestBoxV1", requestBox);
  }, [requestBox]);

  useEffect(() => {
    const syncLeaves = () => setPersonLeaves(getAllLeaves());
    syncLeaves();
    window.addEventListener("leaves:changed", syncLeaves);
    return () => window.removeEventListener("leaves:changed", syncLeaves);
  }, []);

  /* ---- Backend parametre sync (online-only) ---- */
  const settingsLoadedRef = useRef(false);
  const personnelLoadedRef = useRef(false);
  const saveTimersRef = useRef({ wa: null, wh: null, lt: null, rq: null });
  const lastSavedWorkAreasRef = useRef(null);
  const lastSavedWorkingHoursRef = useRef(null);
  const lastSavedLeaveTypesRef = useRef(null);
  const lastSavedRequestBoxRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const token = getToken();
    if (!token) {
      settingsLoadedRef.current = true;
      return undefined;
    }
    const fetchOpts = { signal: controller.signal };
    (async () => {
      try {
        const [wa, wh, lt, rq] = await Promise.all([
          API.http.get(`/api/settings/workAreas?serviceId=`, fetchOpts),
          API.http.get(`/api/settings/workingHours?serviceId=`, fetchOpts),
          API.http.get(`/api/settings/leaveTypes?serviceId=`, fetchOpts),
          API.http.get(`/api/settings/requestBoxV1?serviceId=`, fetchOpts),
        ]);
        if (controller.signal.aborted) return;
        if (Array.isArray(wa?.value)) {
          const serialized = JSON.stringify(wa.value);
          lastSavedWorkAreasRef.current = serialized;
          setWorkAreas(wa.value);
        }
        if (Array.isArray(wh?.value)) {
          lastSavedWorkingHoursRef.current = JSON.stringify(wh.value);
          setWorkingHours(wh.value);
        }
        if (Array.isArray(lt?.value)) {
          lastSavedLeaveTypesRef.current = JSON.stringify(lt.value);
          setLeaveTypes(lt.value);
        }
        if (Array.isArray(rq?.value)) {
          lastSavedRequestBoxRef.current = JSON.stringify(rq.value);
          setRequestBox(rq.value);
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.warn("Settings fetch failed:", err?.message || err);
      } finally {
        if (!controller.signal.aborted) {
          settingsLoadedRef.current = true;
        }
      }
    })();
    return () => { controller.abort(); };
  }, [user?.id]);

  const saveSetting = useCallback(async (key, value) => {
    await API.http.req(`/api/settings/${key}`, {
      method: "PUT",
      body: { value, serviceId: "" },
      retries: 0,
    });
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (!isAdmin) return;
    const serialized = JSON.stringify(workAreas ?? []);
    if (lastSavedWorkAreasRef.current === serialized) {
      return;
    }
    if (saveTimersRef.current.wa) clearTimeout(saveTimersRef.current.wa);
    saveTimersRef.current.wa = setTimeout(() => {
      saveSetting("workAreas", workAreas)
        .then(() => {
          lastSavedWorkAreasRef.current = serialized;
        })
        .catch((err) => {
          console.warn("workAreas save failed, retrying in 5s:", err?.message || err);
          saveTimersRef.current.wa = setTimeout(() => {
            saveSetting("workAreas", workAreas)
              .then(() => { lastSavedWorkAreasRef.current = serialized; })
              .catch((e) => console.warn("workAreas retry failed:", e?.message || e));
          }, 5000);
        });
    }, 600);
    return () => {
      if (saveTimersRef.current.wa) clearTimeout(saveTimersRef.current.wa);
    };
  }, [workAreas, isAdmin, saveSetting]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (!isAdmin) return;
    const serialized = JSON.stringify(workingHours ?? []);
    if (lastSavedWorkingHoursRef.current === serialized) return;
    if (saveTimersRef.current.wh) clearTimeout(saveTimersRef.current.wh);
    saveTimersRef.current.wh = setTimeout(() => {
      saveSetting("workingHours", workingHours)
        .then(() => {
          lastSavedWorkingHoursRef.current = serialized;
        })
        .catch((err) => {
          console.warn("workingHours save failed, retrying in 5s:", err?.message || err);
          saveTimersRef.current.wh = setTimeout(() => {
            saveSetting("workingHours", workingHours)
              .then(() => { lastSavedWorkingHoursRef.current = serialized; })
              .catch((e) => console.warn("workingHours retry failed:", e?.message || e));
          }, 5000);
        });
    }, 600);
    return () => {
      if (saveTimersRef.current.wh) clearTimeout(saveTimersRef.current.wh);
    };
  }, [workingHours, isAdmin, saveSetting]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (!isAdmin) return;
    const serialized = JSON.stringify(leaveTypes ?? []);
    if (lastSavedLeaveTypesRef.current === serialized) return;
    if (saveTimersRef.current.lt) clearTimeout(saveTimersRef.current.lt);
    saveTimersRef.current.lt = setTimeout(() => {
      saveSetting("leaveTypes", leaveTypes)
        .then(() => {
          lastSavedLeaveTypesRef.current = serialized;
        })
        .catch((err) => {
          console.warn("leaveTypes save failed, retrying in 5s:", err?.message || err);
          saveTimersRef.current.lt = setTimeout(() => {
            saveSetting("leaveTypes", leaveTypes)
              .then(() => { lastSavedLeaveTypesRef.current = serialized; })
              .catch((e) => console.warn("leaveTypes retry failed:", e?.message || e));
          }, 5000);
        });
    }, 600);
    return () => {
      if (saveTimersRef.current.lt) clearTimeout(saveTimersRef.current.lt);
    };
  }, [leaveTypes, isAdmin, saveSetting]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (!isAdmin) return;
    const serialized = JSON.stringify(requestBox ?? []);
    if (lastSavedRequestBoxRef.current === serialized) return;
    if (saveTimersRef.current.rq) clearTimeout(saveTimersRef.current.rq);
    saveTimersRef.current.rq = setTimeout(() => {
      saveSetting("requestBoxV1", requestBox)
        .then(() => {
          lastSavedRequestBoxRef.current = serialized;
        })
        .catch((err) => {
          console.warn("requestBox save failed, retrying in 5s:", err?.message || err);
          saveTimersRef.current.rq = setTimeout(() => {
            saveSetting("requestBoxV1", requestBox)
              .then(() => { lastSavedRequestBoxRef.current = serialized; })
              .catch((e) => console.warn("requestBox retry failed:", e?.message || e));
          }, 5000);
        });
    }, 600);
    return () => {
      if (saveTimersRef.current.rq) clearTimeout(saveTimersRef.current.rq);
    };
  }, [requestBox, isAdmin, saveSetting]);

  const peopleAll = useMemo(() => [...(doctors || []), ...(nurses || [])], [doctors, nurses]);
  const appDataValue = useMemo(
    () => ({
      workAreas,
      workingHours,
      leaveTypes,
      personLeaves,
      nurses,
      doctors,
      peopleAll,
      setNurses,
      setDoctors,
    }),
    [workAreas, workingHours, leaveTypes, personLeaves, nurses, doctors, peopleAll, setNurses, setDoctors]
  );

  /* ---- Backend’den personel çek ---- */
  const reloadPersonnel = useCallback(async () => {
    const token = getToken();
    if (!token) {
      if (!personnelLoadedRef.current) personnelLoadedRef.current = true;
      return;
    }
    try {
      const role = roleOf(user);
      const serviceIds = Array.isArray(user?.serviceIds) ? user.serviceIds.map(String).filter(Boolean) : [];
      let items = [];

      if (role === "STAFF") {
        if (!serviceIds.length) {
          setNurses([]);
          setDoctors([]);
          personnelLoadedRef.current = true;
          return;
        }
        const results = await Promise.all(
          serviceIds.map((sid) =>
            API.http.get(`/api/personnel?page=1&size=2000&serviceId=${encodeURIComponent(sid)}`)
          )
        );
        const merged = results.flatMap((r) => (Array.isArray(r?.items) ? r.items : []));
        const byId = new Map();
        merged.forEach((p) => {
          const key = String(p?.id ?? p?._id ?? "");
          if (!key) return;
          if (!byId.has(key)) byId.set(key, p);
        });
        items = Array.from(byId.values());
      } else {
        const data = await API.http.get(`/api/personnel?page=1&size=2000`);
        items = Array.isArray(data?.items) ? data.items : [];
      }

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
            .trim();
        return {
          id: p.id,
          personId: p.id,
          role: isDoctor ? ROLE.Doctor : ROLE.Nurse,
          service,
          title: meta.title || p.title || "",
          tc: p.tc || "",
          name: fullName || "",
          phone: p.phone || "",
          mail: p.email || "",
          areas: Array.isArray(p.areas) ? p.areas : Array.isArray(meta.areas) ? meta.areas : [],
          workAreaIds: Array.isArray(p.workAreaIds)
            ? p.workAreaIds
            : Array.isArray(meta.workAreaIds)
              ? meta.workAreaIds
              : [],
          shiftCodes: Array.isArray(meta.shiftCodes) ? meta.shiftCodes : [],
        };
      });

      setNurses(mapped.filter((p) => p.role === ROLE.Nurse));
      setDoctors(mapped.filter((p) => p.role === ROLE.Doctor));
      personnelLoadedRef.current = true;
    } catch (e) {
      console.warn("Personnel load error:", e?.message || e);
      if (!personnelLoadedRef.current) {
        setNurses([]);
        setDoctors([]);
        personnelLoadedRef.current = true;
      }
    }
  }, [setNurses, setDoctors, user]);

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
        if (!canSeeParameters) return setActiveTab("plan");
        if (activeTab !== "parameters") setActiveTab("parameters");
        try {
          if (!hash.startsWith("#/parametreler/servisler")) {
            window.location.hash = "/parametreler/servisler";
          }
        } catch {}
        return;
      }
      if (pathname.startsWith("/isteklerim")) {
        if (activeTab !== "myRequests") setActiveTab("myRequests");
        return;
      }
      if (pathname.startsWith("/profilim")) {
        if (activeTab !== "profile") setActiveTab("profile");
        return;
      }
      if (pathname.startsWith("/talepler")) {
        if (isAdmin || isStaff) {
          if (activeTab !== "requests") setActiveTab("requests");
        } else {
          if (activeTab !== "myRequests") setActiveTab("myRequests");
        }
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
  }, [activeTab, canSeePersonnel, canSeeSchedules, canSeeParameters, canSeeUsersTab, isAdmin, isStaff]);

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
    setActiveTab("parameters");
    if (typeof location !== "undefined") {
      location.hash = "/parametreler/servisler";
    }
    closePersonnelDd();
    closeSchedulesDd();
    closeParamsDd();
  }, [closePersonnelDd, closeSchedulesDd, closeParamsDd]);

  /* ======================= RENDER ======================= */
  return (
    <ErrorBoundary>
      <Toaster richColors position="bottom-right" />
      <AppDataProvider value={appDataValue}>
      <div className="w-screen h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f8fafc_16%,#f8fafc_100%)] text-slate-800 flex flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
          <div className="w-full px-4 py-3 md:px-6 md:py-4">
            <div className="rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_42px_-34px_rgba(15,23,42,0.28)]">
              <div className="flex flex-col gap-4 px-4 py-4 md:px-5">
                <div className="grid gap-3 lg:grid-cols-[minmax(320px,1fr)_auto] lg:items-start">
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-[0_12px_28px_-18px_rgba(15,23,42,0.8)]">
                        <CalendarIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <div className="truncate text-[19px] font-semibold tracking-tight text-slate-900">
                            Hastane Nöbet Sistemi
                          </div>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                            v1.0.1
                          </span>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                            {isAdmin ? "Yönetim" : isStaff ? "Yetkili" : "Kullanıcı"}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1">
                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                            {isAdmin ? "Yönetim oturumu" : isStaff ? "Yetkili görünümü" : "Kişisel görünüm"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:min-w-[460px]">
                    {!isBasicUser && (
                      <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                        <BackupButtons compact />
                      </div>
                    )}

                    <UserBadge
                      user={user}
                      onLogout={async () => {
                        try { await logout?.(); } catch {}
                      }}
                      onChanged={refresh}
                    />
                  </div>
                </div>

                <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-2">
                  <nav className="flex flex-wrap gap-2">
              {/* DASHBOARD — Admin + Yetkili */}
              {canSeeDashboard && (
                <div style={{ order: navOrder.indexOf("dashboard") !== -1 ? navOrder.indexOf("dashboard") : 0 }} draggable onDragStart={(e) => handleDragStart(e, "dashboard")} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, "dashboard")}><NavBtn active={activeTab === "dashboard"}
                  onClick={() => { setActiveTab("dashboard"); pushUrl("/"); closePersonnelDd(); closeSchedulesDd(); closeParamsDd(); }}
                  icon={LayoutDashboard}
                >
                  Genel Bakış</NavBtn></div>
              )}

              <div style={{ order: navOrder.indexOf("plan") !== -1 ? navOrder.indexOf("plan") : 1 }} draggable onDragStart={(e) => handleDragStart(e, "plan")} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, "plan")}><NavBtn active={activeTab === "plan"}
                onClick={() => {
                  setActiveTab("plan");
                  if (typeof location !== "undefined") location.hash = "";
                  pushUrl("/");
                  closePersonnelDd();
                  closeSchedulesDd();
                  closeParamsDd();
                }}
                icon={LayoutDashboard}
              >
                {isBasicUser ? "Takvimim" : "Planlama"}</NavBtn></div>

              {!isBasicUser && (
                <>
              {/* PERSONEL — admin & yetkili */}
              {canSeePersonnel && (
                <div style={{ order: navOrder.indexOf("personnel") !== -1 ? navOrder.indexOf("personnel") : 2 }} draggable onDragStart={(e) => handleDragStart(e, "personnel")} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, "personnel")} className="relative z-20" onMouseEnter={() => { clearTimeout(hoverTimers.current.personnel);
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
                      <Users2 className="h-4 w-4" />
                      Personel
                      <ChevronDown className="h-4 w-4 text-current/70" />
                    </summary>

                    <div role="menu" className="absolute top-full left-0 mt-3 w-72 rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] overflow-hidden z-20">
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
                <div style={{ order: navOrder.indexOf("schedules") !== -1 ? navOrder.indexOf("schedules") : 3 }} draggable onDragStart={(e) => handleDragStart(e, "schedules")} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, "schedules")} className="relative z-20" onMouseEnter={() => { clearTimeout(hoverTimers.current.schedules);
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
                      <CalendarIcon className="h-4 w-4" />
                      Çizelgeler
                      <ChevronDown className="h-4 w-4 text-current/70" />
                    </summary>
                    <div role="menu" className="absolute top-full left-0 mt-3 w-96 rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] overflow-hidden z-20">
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
                <div style={{ order: navOrder.indexOf("parameters") !== -1 ? navOrder.indexOf("parameters") : 4 }} draggable onDragStart={(e) => handleDragStart(e, "parameters")} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, "parameters")} className="relative z-30" onMouseEnter={() => { clearTimeout(hoverTimers.current.params);
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
                      <Settings2 className="h-4 w-4" />
                      Parametreler
                      <ChevronDown className="h-4 w-4 text-current/70" />
                    </summary>
                    <div role="menu" className="absolute top-full left-0 mt-3 w-80 rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] overflow-hidden z-30">
                      <DropdownItem onSelect={() => goParams("calisma-alanlari")}>Çalışma Alanları</DropdownItem>
                      <DropdownItem onSelect={() => goParams("calisma-saatleri")}>Çalışma Saatleri</DropdownItem>
                      <DropdownItem onSelect={() => goParams("izin-turleri")}>İzin Türleri</DropdownItem>
                      <DropdownItem onSelect={() => goParams("servisler")}>Servisler</DropdownItem>
                      <DropdownItem onSelect={() => goParams("tatil-takvimi")}>Tatil Takvimi</DropdownItem>
                      <DropdownItem onSelect={() => goParams("nobet-kurallari")}>Nöbet Kuralları</DropdownItem>
                      <DropdownItem onSelect={() => goParams("istek")}>İstek</DropdownItem>
                      <div className="border-t my-1" />
                      <div className="px-3 py-2 text-xs text-gray-500">Alt sayfalar <b>Parametreler</b> içinde sekmeli olarak açılır.</div>
                    </div>
                  </details>
                </div>
              )}

              {/* KULLANICILAR — yalnız Admin */}
              {canSeeUsersTab && (
                <div style={{ order: navOrder.indexOf("users") !== -1 ? navOrder.indexOf("users") : 5 }} draggable onDragStart={(e) => handleDragStart(e, "users")} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, "users")}><NavBtn active={activeTab === "users"}
                  onClick={() => { setActiveTab("users"); pushUrl("/kullanicilar"); }}
                  icon={UserRound}
                >
                  Kullanıcılar</NavBtn></div>
              )}

              {/* AI ASİSTAN — Admin + Yetkili */}
              {canSeeAI && (
                <div style={{ order: navOrder.indexOf("ai") !== -1 ? navOrder.indexOf("ai") : 6 }}><NavBtn active={activeTab === "ai"}
                  onClick={() => setActiveTab("ai")}
                  icon={() => <span style={{ fontSize: 16 }}>🤖</span>}
                >
                  AI Asistan</NavBtn></div>
              )}

              {/* AI ÇİZELGE — Admin + Yetkili */}
              {canSeeAIScheduler && (
                <div style={{ order: navOrder.indexOf("aiScheduler") !== -1 ? navOrder.indexOf("aiScheduler") : 7 }} draggable onDragStart={(e) => handleDragStart(e, "aiScheduler")} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, "aiScheduler")}><NavBtn active={activeTab === "aiScheduler"}
                  onClick={() => setActiveTab("aiScheduler")}
                  icon={() => <span style={{ fontSize: 14 }}>✨</span>}
                >
                  AI Çizelge</NavBtn></div>
              )}
                </>
              )}
            
              {/* TALEPLER VE PROFİLİM — flex'in en sağına */}
              <div className="ml-auto flex gap-2" style={{ order: 999 }}>
                <NavBtn
                  active={activeTab === (isAdmin || isStaff ? "requests" : "myRequests")}
                  onClick={() => {
                    const target = (isAdmin || isStaff) ? "requests" : "myRequests";
                    setActiveTab(target);
                    pushUrl("/talepler");
                    closePersonnelDd();
                    closeSchedulesDd();
                    closeParamsDd();
                  }}
                  icon={ClipboardList}
                >
                  Talepler
                </NavBtn>
                <NavBtn
                  active={activeTab === "profile"}
                  onClick={() => {
                    setActiveTab("profile");
                    pushUrl("/profilim");
                    closePersonnelDd();
                    closeSchedulesDd();
                    closeParamsDd();
                  }}
                  icon={UserRound}
                >
                  Profilim
                </NavBtn>
              </div>
            </nav>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full px-4 py-6 md:px-6 space-y-6 overflow-auto">
          {activeTab === "dashboard" && canSeeDashboard && (
            <DashboardPage
              activeYM={getActiveYM()}
              peopleAll={peopleAll}
              onGoSchedules={() => setActiveTab("schedules")}
              onGoAI={() => setActiveTab("ai")}
            />
          )}

          {activeTab === "aiScheduler" && canSeeAIScheduler && (
            <AISchedulerPage activeYM={getActiveYM()} />
          )}

          {activeTab === "plan" && (
            isBasicUser ? (
              <MyCalendarBox
                me={user}
                people={peopleAll}
                allLeaves={personLeaves}
                workAreas={workAreas}
                workingHours={workingHours}
              />
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
              <PersonnelTab />
            ) : <NeedAuth />
          )}

          {activeTab === "schedules" && (
            canSeeSchedules ? (
              <SchedulesTab
                  workAreas={workAreas}
                  workingHours={workingHours}
                  peopleAll={peopleAll}
                  leaveTypes={leaveTypes}
                  personLeaves={personLeaves}
                />
            ) : <NeedAuth />
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

          {activeTab === "users" && (
            canSeeUsersTab ? <UsersTab /> : <NeedAdmin />
          )}

          {activeTab === "myRequests" && <MyRequestsTab />}
          {activeTab === "requests" && (isAdmin || isStaff) && <RequestsManagementTab />}
          {activeTab === "profile" && <UserProfile currentUser={user} onUpdate={refresh} />}

          {activeTab === "ai" && canSeeAI && (
            <div style={{ padding: 24, maxWidth: 720, margin: '0 auto', height: 'calc(100vh - 120px)' }}>
              <AIChatPanel style={{ height: '100%' }} />
            </div>
          )}
        </main>

        {/* Floating AI Chat — her yerden erişilebilir, AI tab'ında gizle */}
        {canSeeAI && activeTab !== "ai" && (
          <FloatingAIChat activeYM={getActiveYM()} />
        )}
      </div>
      </AppDataProvider>
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
          <UserRound className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-800 max-w-[240px]">{email}</div>
          <div className="mt-1">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium
              ${roleLabel === "admin" ? "bg-rose-100 text-rose-700"
                : roleLabel === "yetkili" ? "bg-amber-100 text-amber-700"
                : "bg-slate-100 text-slate-700"}`}>
              {roleLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          onClick={() => setChangeOpen(true)}
          title="Şifre değiştir"
        >
          <Settings2 className="h-4 w-4" />
          Şifre Değiştir
        </button>

        <button
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-60"
          onClick={async () => {
            if (busy) return;
            if (!window.confirm("Çıkış yapmak istediğinize emin misiniz?")) return;
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
          {busy ? "Çıkış yapılıyor…" : "Çıkış"}
        </button>
      </div>

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
function MyCalendarBox({ me, people = [], allLeaves = {}, workAreas = [], workingHours = [] }) {
  const [ym, setYm] = useState(() => getActiveYM());
  const year = ym.year;
  const month = ym.month;
  const personId =
    me?.personId ||
    me?.person_id ||
    me?.person?.id ||
    me?.person?._id ||
    "";

  const goto = (delta) => {
    const dt = new Date(year, month - 1, 1);
    dt.setMonth(dt.getMonth() + delta);
    const next = { year: dt.getFullYear(), month: dt.getMonth() + 1 };
    setYm(next);
    setActiveYM(next);
  };

  const roleInfo = useMemo(
    () => ({
      isAdmin: false,
      isAuthorized: false,
      isStandard: true,
    }),
    []
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
        <div className="font-semibold">Takvimim</div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => goto(-1)} className="px-2 py-1 rounded bg-slate-100">Önceki Ay</button>
          <div className="text-slate-500">{month}.{year}</div>
          <button onClick={() => goto(1)} className="px-2 py-1 rounded bg-slate-100">Sonraki Ay</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4">
        {!personId && (
          <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            Personel kaydınız bağlı değil. İzinlerin görünmesi için hesabınızı bir personele bağlayın.
          </div>
        )}
        <PersonScheduleCalendar
          year={year}
          month={month}
          people={people}
          allLeaves={allLeaves}
          user={me}
          role={roleInfo}
          sectionId="calisma-cizelgesi"
          serviceId=""
          scheduleRole=""
          workAreas={workAreas}
          workingHours={workingHours}
        />
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
function NavBtn({ active, onClick, children, icon: Icon }) {
  return (
    <button onClick={onClick} className={`${navBase} ${active ? navActive : navIdle}`}>
      {Icon ? <Icon className="h-4 w-4" /> : null}
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
      className="w-full text-left px-4 py-3 text-[14px] text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none transition-colors"
    >
      {children}
    </button>
  );
}
