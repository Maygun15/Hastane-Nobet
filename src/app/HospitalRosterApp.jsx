// src/app/HospitalRosterApp.jsx
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { toast, Toaster } from "sonner";
import { ThemeProvider } from "../context/ThemeContext.jsx";
import {
  Calendar as CalendarIcon,
  ClipboardList,
  Download,
  LogOut,
  MoreVertical,
  Settings2,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";

import AppSidebar from "../components/layout/Sidebar.jsx";

import ErrorBoundary from "../ErrorBoundary.jsx";
import Modal from "../components/common/Modal.jsx";

import PlanTab from "../tabs/PlanTab.jsx";
import SchedulesTab from "../tabs/SchedulesTab.jsx";
import ParametersTab from "../tabs/ParametersTab.jsx";
import PersonnelTab from "../tabs/PersonnelTab.jsx";
import { LS, pruneOldMonthlySheets } from "../utils/storage.js";

// Başlangıçta 3 aydan eski çizelge verilerini temizle (KVKK + localStorage şişmesi)
pruneOldMonthlySheets(3);

// Auth
import { useAuth } from "../auth/AuthContext.jsx";
// import AuthCard from "../ui/AuthCard.jsx"; // ❌ eski mini form
import AuthDemo from "../pages/AuthDemo.jsx";      // ✅ yeni login/register sayfası

// RBAC
import { can } from "../utils/acl.js";
import { PERMISSIONS } from "../constants/roles.js";

// Sayfalar
import UsersTab from "../tabs/UsersTab.jsx";
import AuditLogPage from "../pages/AuditLogPage.jsx";
import MyRequestsTab from "../tabs/MyRequestsTab.jsx";
import RequestsManagementTab from "../tabs/RequestsManagementTab.jsx";
import UserProfile from "../components/UserProfile.jsx";
import AIChatPanel from "../components/AIChatPanel.jsx";
import FloatingAIChat from "../components/FloatingAIChat.jsx";
import DashboardPage from "../pages/DashboardPage.jsx";
import AISchedulerPage from "../pages/AISchedulerPage.jsx";
import AICostPage from "../pages/AICostPage.jsx";
import FairnessReportPage from "../pages/FairnessReportPage.jsx";
import useSSENotifications from "../hooks/useSSENotifications.js";
import NotificationBell from "../components/NotificationBell.jsx";
import AnnouncementsPanel from "../components/AnnouncementsPanel.jsx";

// Normal kullanıcı takvimi
import PersonScheduleCalendar from "../components/PersonScheduleCalendar.jsx";
import { getActiveYM, setActiveYM, ymKey } from "../utils/activeYM.js";
import { apiChangePassword, API, getToken } from "../lib/api.js";
import { getAllLeaves } from "../lib/leaves.js";
import { ROLE } from "../constants/enums.js";
import { useAppStore } from "../state/appStore.js";
import { useDebouncedSetting } from "../hooks/useDebouncedSetting.js";
import { fetchAllPages } from "../utils/fetchAllPages.js";
import { useStoreEventBridge } from "../hooks/useStoreEventBridge.js";

import { downloadBackup, restoreFromFile } from "../lib/backup.js";
import PlanningManagementTab from "../tabs/PlanningManagementTab.jsx";
import LeaveBalanceTab from "../tabs/LeaveBalanceTab.jsx";
import OccupancyReportPage from "../pages/OccupancyReportPage.jsx";
import WorkingHoursSummaryPage from "../pages/WorkingHoursSummaryPage.jsx";
import LeaveStatsPage from "../pages/LeaveStatsPage.jsx";
import AnnouncementModal from "../components/AnnouncementModal.jsx";

let settingsBootstrapKey = "";
let settingsBootstrapPromise = null;

function loadSettingsSnapshotOnce(userId) {
  const key = String(userId || "anonymous");
  if (settingsBootstrapPromise && settingsBootstrapKey === key) return settingsBootstrapPromise;
  settingsBootstrapKey = key;
  settingsBootstrapPromise = Promise.all([
    API.http.get(`/api/settings/workAreas?serviceId=`),
    API.http.get(`/api/settings/workingHours?serviceId=`),
    API.http.get(`/api/settings/leaveTypes?serviceId=`),
    API.http.get(`/api/settings/requestBoxV1?serviceId=`),
  ]).finally(() => {
    settingsBootstrapPromise = null;
  });
  return settingsBootstrapPromise;
}

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
  const isManager = roleOf(user) === "MANAGER";
  const isAuthorized =
    !isAdmin && (
      isStaff ||
      roleOf(user) === "AUTHORIZED" ||
      isManager   ||
      has(PERMISSIONS.SCHEDULE_WRITE) ||
      has(PERMISSIONS.LEAVES_WRITE)
    );
  const canSendAnnouncement = isAdmin || isManager;

  const isBasicUser  = !!user && !isAdmin && !isAuthorized;

  const canSeePersonnel   = isAdmin || isAuthorized;   // Personel
  const canSeeSchedules   = isAdmin || isAuthorized;   // Çizelgeler
  const canSeeParameters  = isAdmin;                   // Parametreler (yalnız Admin)
  const canSeeUsersTab    = isAdmin;                   // Kullanıcılar: yalnız Admin
  const canSeeAI          = isAdmin || isAuthorized;   // AI Asistan: Admin + Yetkili
  const canSeeDashboard   = isAdmin || isAuthorized;   // Dashboard: Admin + Yetkili
  const canSeeAIScheduler = isAdmin || isAuthorized;   // AI Çizelge: Admin + Yetkili
  const canSeeAICost      = isAdmin;                   // AI Maliyet: yalnız Admin
  const canSeeFairness    = isAdmin || isAuthorized;   // Adillik Raporu: Admin + Yetkili

  // Store değişikliklerini legacy window event'lerine köprüle (geriye dönük uyumluluk)
  useStoreEventBridge();

  // SSE bildirimleri — bağlantı kur, Toaster ile göster
  useSSENotifications(React.useCallback((data) => {
    const normalized = {
      ...data,
      message: String(data?.message || data?.body || "").trim(),
      title: String(data?.title || "").trim(),
      read: !!data?.read,
      createdAt: data?.createdAt || new Date().toISOString(),
    };
    const toastTitle = normalized.title || (normalized.type === "announcement" ? "Duyuru" : "Bildirim");
    if (normalized.message) toast.info(toastTitle, { description: normalized.message });
    else if (toastTitle) toast.info(toastTitle);
    window.dispatchEvent(new CustomEvent("notification:new", { detail: normalized }));
  }, []));

  const [activeTab, setActiveTab] = useState(() => "plan");
  const [navOrder, setNavOrder] = useState(() => {
    const fallback = ["plan", "personnel", "schedules", "parameters", "users", "aiScheduler", "fairness", "aiCost"];
    try {
      const saved = JSON.parse(localStorage.getItem("navOrder"));
      if (!Array.isArray(saved)) return fallback;
      return saved.filter((id) => id !== "dashboard");
    } catch {
      return fallback;
    }
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
    if (isBasicUser && activeTab !== "plan" && activeTab !== "announcements" && activeTab !== "myRequests" && activeTab !== "profile") {
      setActiveTab("plan");
      pushUrl("/");
    }
  }, [isBasicUser, activeTab]);

  /* ---- Mongo-first state’ler — Zustand store üzerinden ---- */
  const workAreas     = useAppStore((s) => s.workAreas);
  const setWorkAreas  = useAppStore((s) => s.setWorkAreas);
  const nurses        = useAppStore((s) => s.nurses);
  const setNurses     = useAppStore((s) => s.setNurses);
  const doctors       = useAppStore((s) => s.doctors);
  const setDoctors    = useAppStore((s) => s.setDoctors);
  const workingHours  = useAppStore((s) => s.workingHours);
  const setWorkingHours = useAppStore((s) => s.setWorkingHours);
  const leaveTypes    = useAppStore((s) => s.leaveTypes);
  const setLeaveTypes = useAppStore((s) => s.setLeaveTypes);

  const personLeaves    = useAppStore((s) => s.personLeaves);
  const setPersonLeaves = useAppStore((s) => s.setPersonLeaves);

  const [requestBox, setRequestBox] = useState([]);

  // LS cache güncellemeleri (dispatchEvent çağrıları useStoreEventBridge'e taşındı)
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    LS.set("workAreas", workAreas);
    LS.set("workAreasV2", workAreas);
  }, [workAreas]);
  useEffect(() => {
    if (!personnelLoadedRef.current) return;
    LS.set("nurses", nurses);
  }, [nurses]);
  useEffect(() => {
    if (!personnelLoadedRef.current) return;
    LS.set("doctors", doctors);
  }, [doctors]);
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    LS.set("workingHours", workingHours);
    LS.set("workingHoursV2", workingHours);
  }, [workingHours]);
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    LS.set("leaveTypesV2", leaveTypes);
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
  const personnelLoadedRef       = useRef(false);
  const lastSavedWorkAreasRef    = useRef(null);
  const lastSavedWorkingHoursRef = useRef(null);
  const lastSavedLeaveTypesRef   = useRef(null);
  const lastSavedRequestBoxRef   = useRef(null);

  useEffect(() => {
    let alive = true;
    const token = getToken();
    if (!token) {
      settingsLoadedRef.current = true;
      return undefined;
    }
    (async () => {
      try {
        const [wa, wh, lt, rq] = await loadSettingsSnapshotOnce(user?.id);
        if (!alive) return;
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
        if (!alive) return;
        console.warn("Settings fetch failed:", err?.message || err);
      } finally {
        if (alive) {
          settingsLoadedRef.current = true;
        }
      }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  /* ---- Backend ayar kayıtları (debounced + retry) ---- */
  useDebouncedSetting("workAreas",    workAreas,    { gateRef: settingsLoadedRef, enabled: isAdmin, lastSavedRef: lastSavedWorkAreasRef });
  useDebouncedSetting("workingHours", workingHours, { gateRef: settingsLoadedRef, enabled: isAdmin, lastSavedRef: lastSavedWorkingHoursRef });
  useDebouncedSetting("leaveTypes",   leaveTypes,   { gateRef: settingsLoadedRef, enabled: isAdmin, lastSavedRef: lastSavedLeaveTypesRef });
  useDebouncedSetting("requestBoxV1", requestBox,   { gateRef: settingsLoadedRef, enabled: isAdmin, lastSavedRef: lastSavedRequestBoxRef });

  const peopleAll = useMemo(() => [...(doctors || []), ...(nurses || [])], [doctors, nurses]);

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
        // Tüm sayfaları çek; STAFF kullanıcısının servislerine göre filtrele
        const allowed = new Set(serviceIds);
        const all = await fetchAllPages("/api/personnel");
        items = all.filter((p) => {
          const sid = String(p?.serviceId ?? p?.service ?? "").trim();
          return !sid || allowed.has(sid);
        });
      } else {
        items = await fetchAllPages("/api/personnel");
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

  /* ---- Sidebar action handler ---- */
  const handleSidebarAction = useCallback((action) => {
    if (action === "openAnnouncementModal") setAnnouncementOpen(true);
  }, []);

  /* ---- URL -> aktif tab senkronu ---- */
  useEffect(() => {
    const syncFromLocation = () => {
      const { pathname, hash } = window.location;

      // ── Hash tabanlı rotalar (önce daha spesifik olanlar) ──────────────────
      // Yeni: Analiz grubu
      if (hash.startsWith("#/analiz/genel-bakis"))  { if (canSeeDashboard)   setActiveTab("dashboard");            return; }
      if (hash.startsWith("#/analiz/ai-cizelge"))   { if (canSeeAIScheduler) setActiveTab("aiScheduler");          return; }
      if (hash.startsWith("#/analiz/ai-maliyet"))   { if (canSeeAICost)      setActiveTab("aiCost");               return; }
      if (hash.startsWith("#/analiz/adillik"))       { if (canSeeFairness)    setActiveTab("fairness");             return; }
      // Yeni: Raporlar grubu
      if (hash.startsWith("#/reports/occupancy"))    { if (isAdmin)           setActiveTab("occupancyReport");      return; }
      if (hash.startsWith("#/reports/leave-balance")){ if (isAdmin)           setActiveTab("leaveBalance");         return; }
      if (hash.startsWith("#/reports/working-hours")){ if (isAdmin)           setActiveTab("workingHoursSummary");  return; }
      if (hash.startsWith("#/reports/leave-stats"))  { if (isAdmin)           setActiveTab("leaveStats");           return; }
      // Yeni: Yönetim grubu
      if (hash.startsWith("#/yonetim/planlama"))     { if (isAdmin)           setActiveTab("plannings");            return; }
      // Mevcut: Parametreler + Çizelgeler
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
      // ── Pathname tabanlı rotalar ────────────────────────────────────────────
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
      if (pathname.startsWith("/islem-gunlugu") || hash.startsWith("#/islem-gunlugu")) {
        if (!canSeeUsersTab) return setActiveTab("plan");
        if (activeTab !== "auditlog") setActiveTab("auditlog");
        return;
      }
      if (pathname.startsWith("/servisler") || hash.startsWith("#/servisler")) {
        if (!canSeeParameters) return setActiveTab("plan");
        if (activeTab !== "parameters") setActiveTab("parameters");
        try { if (!hash.startsWith("#/parametreler/servisler")) window.location.hash = "/parametreler/servisler"; } catch {}
        return;
      }
      if (pathname.startsWith("/isteklerim"))  { if (activeTab !== "myRequests")    setActiveTab("myRequests");    return; }
      if (pathname.startsWith("/duyurular"))   { if (activeTab !== "announcements") setActiveTab("announcements"); return; }
      if (pathname.startsWith("/profilim"))    { if (activeTab !== "profile")       setActiveTab("profile");       return; }
      if (pathname.startsWith("/talepler")) {
        const target = (isAdmin || isStaff) ? "requests" : "myRequests";
        if (activeTab !== target) setActiveTab(target);
        return;
      }
      if (activeTab !== "plan") setActiveTab("plan");
    };
    syncFromLocation();
    window.addEventListener("urlchange",   syncFromLocation);
    window.addEventListener("popstate",    syncFromLocation);
    window.addEventListener("hashchange",  syncFromLocation);
    return () => {
      window.removeEventListener("urlchange",   syncFromLocation);
      window.removeEventListener("popstate",    syncFromLocation);
      window.removeEventListener("hashchange",  syncFromLocation);
    };
  }, [activeTab, canSeePersonnel, canSeeSchedules, canSeeParameters, canSeeUsersTab,
      canSeeDashboard, canSeeAIScheduler, canSeeAICost, canSeeFairness, isAdmin, isStaff]);

  // Quick-action callbacks (sidebar dışı: header toolbar)
  const openRequests = useCallback(() => {
    const target = (isAdmin || isStaff) ? "requests" : "myRequests";
    setActiveTab(target);
    pushUrl("/talepler");
  }, [isAdmin, isStaff]);

  const openProfile = useCallback(() => {
    setActiveTab("profile");
    pushUrl("/profilim");
  }, []);

  const openAI = useCallback(() => setActiveTab("ai"), []);
  const [announcementOpen, setAnnouncementOpen] = useState(false);


  useEffect(() => {
    const labels = {
      dashboard: "Dashboard",
      plan: "Planlama",
      personnel: "Personel",
      schedules: "Çizelgeler",
      parameters: "Parametreler",
      users: "Kullanıcılar",
      ai: "AI Asistan",
      aiScheduler: "AI Çizelge",
      fairness: "Adillik",
      aiCost: "AI Maliyet",
      plannings: "Planlama Yönetimi",
      leaveBalance: "İzin Bakiyesi",
      occupancyReport: "Doluluk Raporu",
      workingHoursSummary: "Çalışma Saatleri",
      leaveStats: "İzin İstatistikleri",
    };
    document.title = `${labels[activeTab] || "Hastane Nöbet"} | Hastane Nöbet Sistemi`;
  }, [activeTab]);


  /* ======================= RENDER ======================= */
  return (
    <ErrorBoundary>
      <ThemeProvider moduleId="hastane">
      <Toaster richColors position="bottom-right" />
      <div className="w-screen h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f8fafc_16%,#f8fafc_100%)] text-slate-800 flex flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
          <div className="w-full px-4 py-3 md:px-6 md:py-4">
            <div className="rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_42px_-34px_rgba(15,23,42,0.28)]">
              <div className="flex flex-col gap-4 px-4 py-4 md:px-5">
                <div className="grid gap-3 lg:grid-cols-[minmax(320px,1fr)_auto] lg:items-center">
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

                  <UserBadge
                    user={user}
                    isAdmin={isAdmin}
                    onLogout={async () => {
                      try { await logout?.(); } catch {}
                    }}
                    onChanged={refresh}
                  />
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 w-full px-4 py-5 md:px-6">
          <div className="grid h-full min-h-0 gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <AppSidebar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onAction={handleSidebarAction}
              isAdmin={isAdmin}
              isManager={isManager}
              isAuthorized={isAuthorized}
              isBasicUser={isBasicUser}
            />

            <main className="min-h-0 overflow-auto space-y-5">
              <div className="space-y-6">
          {activeTab === "dashboard" && canSeeDashboard && (
            <DashboardPage
              activeYM={ymKey(getActiveYM())}
              peopleAll={peopleAll}
              onGoSchedules={() => setActiveTab("schedules")}
              onGoAI={openAI}
            />
          )}

          {activeTab === "aiScheduler" && canSeeAIScheduler && (
            <AISchedulerPage activeYM={ymKey(getActiveYM())} />
          )}

          {activeTab === "fairness" && canSeeFairness && (
            <FairnessReportPage activeYM={ymKey(getActiveYM())} />
          )}

          {activeTab === "aiCost" && canSeeAICost && (
            <AICostPage />
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

          {activeTab === "auditlog" && (
            canSeeUsersTab ? <AuditLogPage /> : <NeedAdmin />
          )}

          {activeTab === "myRequests" && <MyRequestsTab />}
          {activeTab === "announcements" && isBasicUser && (
            <div className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.24)]">
              <AnnouncementsPanel />
            </div>
          )}
          {activeTab === "requests" && (isAdmin || isStaff) && <RequestsManagementTab />}
          {activeTab === "profile" && <UserProfile currentUser={user} onUpdate={refresh} />}

          {activeTab === "ai" && canSeeAI && (
            <div className="p-6 max-w-3xl mx-auto" style={{ height: 'calc(100vh - 120px)' }}>
              <AIChatPanel style={{ height: '100%' }} />
            </div>
          )}

          {activeTab === "plannings" && isAdmin && <PlanningManagementTab />}
          {activeTab === "leaveBalance" && isAdmin && <LeaveBalanceTab />}
          {activeTab === "occupancyReport" && isAdmin && <OccupancyReportPage />}
          {activeTab === "workingHoursSummary" && isAdmin && <WorkingHoursSummaryPage />}
          {activeTab === "leaveStats" && isAdmin && <LeaveStatsPage />}
          {announcementOpen && <AnnouncementModal onClose={() => setAnnouncementOpen(false)} />}
              </div>
            </main>
          </div>
        </div>

        {/* Floating AI Chat — her zaman erişilebilir FAB */}
        {canSeeAI && (
          <FloatingAIChat activeYM={ymKey(getActiveYM())} />
        )}
      </div>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

/* ---------------- Sağ üst kullanıcı etiketi + profil dropdown ---------------- */
function UserBadge({ user, onLogout, onChanged, isAdmin }) {
  const [busy, setBusy] = React.useState(false);
  const [changeOpen, setChangeOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const forceChange = !!user?.mustChangePassword;

  React.useEffect(() => {
    if (forceChange) setChangeOpen(true);
  }, [forceChange]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  if (!user) return null;
  const email = user.email || user.username || user.name || "Kullanıcı";
  const role = (user.role || user.roleKey || "").toString().toLowerCase();

  const roleLabel =
    role === "admin" ? "admin" :
    role === "authorized" || role === "manager" || role === "staff" ? "yetkili" : "user";

  const handleLogout = async () => {
    setMenuOpen(false);
    if (!window.confirm("Çıkış yapmak istediğinize emin misiniz?")) return;
    setBusy(true);
    try {
      await onLogout?.();
    } finally {
      setBusy(false);
      try { window.history.pushState({}, "", "/"); window.dispatchEvent(new Event("urlchange")); } catch {}
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-[22px] border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
          <UserRound className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-800 max-w-[180px]">{email}</div>
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

      <div className="flex items-center gap-1.5 ml-auto">
        <NotificationBell />

        {/* Profil menü butonu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
            title="Profil menüsü"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-slate-200 bg-white shadow-xl z-50 overflow-hidden py-1">
              {/* Şifre Değiştir */}
              <button
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => { setMenuOpen(false); setChangeOpen(true); }}
              >
                <Settings2 className="h-4 w-4 text-slate-400" />
                Şifre Değiştir
              </button>

              {isAdmin && (
                <>
                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Sistem Yönetimi
                  </div>
                  <button
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
                    onClick={() => { setMenuOpen(false); downloadBackup(); }}
                  >
                    <Download className="h-4 w-4 text-slate-400" />
                    Yedeği İndir
                  </button>
                  <button
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
                    onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }}
                  >
                    <Upload className="h-4 w-4 text-slate-400" />
                    Yedekten Yükle
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) restoreFromFile(file);
                      e.target.value = "";
                    }}
                  />
                </>
              )}

              <div className="my-1 border-t border-slate-100" />
              <button
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-60"
                onClick={handleLogout}
                disabled={busy}
              >
                <LogOut className="h-4 w-4" />
                {busy ? "Çıkış yapılıyor…" : "Çıkış Yap"}
              </button>
            </div>
          )}
        </div>
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
        <div className="space-y-1">
          <label htmlFor="current-password" className="block text-[12px] font-medium text-slate-600">Mevcut Şifre</label>
          <input
            id="current-password"
            className={input}
            type="password"
            placeholder="Mevcut şifre"
            value={oldPass}
            onChange={(e) => setOldPass(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="new-password" className="block text-[12px] font-medium text-slate-600">Yeni Şifre</label>
          <input
            id="new-password"
            className={input}
            type="password"
            placeholder="Yeni şifre (min 6)"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="new-password-confirm" className="block text-[12px] font-medium text-slate-600">Yeni Şifre Tekrar</label>
          <input
            id="new-password-confirm"
            className={input}
            type="password"
            placeholder="Yeni şifre (tekrar)"
            value={newPass2}
            onChange={(e) => setNewPass2(e.target.value)}
            autoComplete="new-password"
          />
        </div>

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
          leaveTypes={leaveTypes}
        />
      </div>
    </div>
  );
}


function QuickActionBtn({ active, onClick, children, icon: Icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-11 items-center gap-2 rounded-2xl border px-4 text-sm font-medium transition ${
        active
          ? "border-slate-900 bg-slate-950 text-white shadow-[0_14px_30px_-20px_rgba(15,23,42,0.8)]"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
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
