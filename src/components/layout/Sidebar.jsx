// src/components/layout/Sidebar.jsx
// menuConfig.js'i okuyarak sidebar'ı render eder.
// HospitalRosterApp.jsx'in eski inline <aside> bloğunun yerine geçer.
import React, { useCallback, useEffect, useState } from "react";
import {
  BarChart,
  BarChart2,
  Bell,
  Bot,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarCog,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Clock4,
  FileText,
  LayoutDashboard,
  Megaphone,
  Menu,
  PieChart,
  Scale,
  Settings2,
  UserRound,
  Users2,
  X,
} from "lucide-react";

import { MENU_CONFIG } from "../../config/menuConfig.js";
import { LS } from "../../utils/storage.js";

// ── İkon adı → bileşen eşlemesi ──────────────────────────────────────────────
const ICON_MAP = {
  BarChart, BarChart2, Bell, Bot, CalendarCheck, CalendarClock,
  CalendarDays, CalendarCog, CircleDollarSign, ClipboardList, Clock4,
  FileText, LayoutDashboard, Megaphone, PieChart, Scale,
  Settings2, UserRound, Users2,
};

// ── Sabitler ──────────────────────────────────────────────────────────────────
const DEFAULT_PERSONNEL_SECTIONS = [
  { id: "hemsireler", name: "Hemşireler" },
  { id: "doktorlar",  name: "Doktorlar"  },
];

// ── Yardımcılar ───────────────────────────────────────────────────────────────
function pushUrl(path) {
  try {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new Event("urlchange"));
  } catch {}
}

// "parameters:calisma-alanlari" → "parameters"
function parentTabId(itemId) {
  return itemId.includes(":") ? itemId.split(":")[0] : itemId;
}

function resolveIcon(name) {
  const Ic = ICON_MAP[name];
  return Ic ? <Ic className="h-4 w-4" /> : null;
}

// ── Stil sabitleri (önceki SidebarNavButton/Branch ile birebir aynı) ───────────
const BTN_BASE =
  "flex w-full items-center gap-3 rounded-[22px] border px-4 py-4 text-left text-sm font-medium transition min-h-[96px]";
const BTN_ACTIVE =
  "border-slate-900 bg-slate-950 text-white shadow-[0_14px_30px_-20px_rgba(15,23,42,0.8)]";
const BTN_IDLE =
  "border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-white";
const ICON_ACTIVE = "border-white/15 bg-white/10 text-white";
const ICON_IDLE   = "border-slate-200 bg-white text-slate-500";

// ── Ana bileşen ───────────────────────────────────────────────────────────────
export default function Sidebar({
  activeTab,
  onTabChange,
  onAction,
  isAdmin,
  isManager,
  isAuthorized,
  isBasicUser,
}) {
  // Mobil drawer açık mı?
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Hangi collapsible gruplar açık?
  const [openGroups, setOpenGroups] = useState({
    yonetim: true,
    raporlar: false,
    analiz:   true,
  });

  // Hangi branch'ler genişletilmiş?
  const [openBranches, setOpenBranches] = useState({});

  // Aktif tab değişince ilgili branch'i otomatik aç
  useEffect(() => {
    const toOpen = {};
    for (const group of MENU_CONFIG) {
      for (const item of group.children || []) {
        if (item.type === "branch" && item.id === activeTab) {
          toOpen[item.id] = true;
        }
      }
    }
    if (Object.keys(toOpen).length) {
      setOpenBranches((prev) => ({ ...prev, ...toOpen }));
    }
  }, [activeTab]);

  // Dinamik personel bölümleri (LS'den gelir, değişince güncellenir)
  const [personnelSections, setPersonnelSections] = useState(
    () => LS.get("personnelSections", DEFAULT_PERSONNEL_SECTIONS),
  );
  useEffect(() => {
    const refresh = () =>
      setPersonnelSections(LS.get("personnelSections", DEFAULT_PERSONNEL_SECTIONS));
    window.addEventListener("personnelSectionsChanged", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("personnelSectionsChanged", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // ── Rol filtresi ─────────────────────────────────────────────────────────────
  const canSee = useCallback(
    (visibleTo) => {
      if (!visibleTo) return true;
      if (visibleTo.includes("admin")      && isAdmin)                     return true;
      if (visibleTo.includes("manager")    && isManager)                   return true;
      if (visibleTo.includes("authorized") && (isAuthorized || isManager)) return true;
      if (visibleTo.includes("staff")      && isAuthorized)                return true;
      if (visibleTo.includes("user")       && isBasicUser)                 return true;
      return false;
    },
    [isAdmin, isManager, isAuthorized, isBasicUser],
  );

  // ── Navigasyon ────────────────────────────────────────────────────────────────
  function navigate(path) {
    if (!path) return;
    if (path.startsWith("#")) {
      window.location.hash = path.slice(1);
    } else {
      pushUrl(path);
    }
  }

  function handleLeaf(item) {
    navigate(item.path);
    onTabChange(parentTabId(item.id));
    setDrawerOpen(false);
  }

  function handleBranch(item) {
    navigate(item.path);
    onTabChange(item.id);
    setDrawerOpen(false);
  }

  function handleAction(item) {
    onAction?.(item.action);
  }

  // ── Branch'in alt-öğelerini belirle (Personel için LS merge) ─────────────────
  function childrenOf(item) {
    if (item.id === "personnel") {
      return personnelSections.map((s) => ({
        type: "leaf",
        id:   `personnel:${s.id}`,
        label: s.name,
        path: `/personel?sec=${encodeURIComponent(s.id)}`,
        visibleTo: item.visibleTo,
      }));
    }
    return item.children || [];
  }

  // ── Modül etiketi (aside başlığındaki "Çalışma Alanı" kutusu) ─────────────────
  const moduleLabel = React.useMemo(() => {
    for (const group of MENU_CONFIG) {
      for (const item of group.children || []) {
        if (item.id === activeTab) return item.label;
        for (const child of item.children || []) {
          if (parentTabId(child.id) === activeTab) return item.label;
        }
      }
    }
    if (activeTab === "requests" || activeTab === "myRequests") return "Talepler";
    if (activeTab === "profile")       return "Profilim";
    if (activeTab === "ai")            return "AI Asistan";
    if (activeTab === "announcements") return "Duyurular";
    return "Çalışma Alanı";
  }, [activeTab]);

  // ── Alt bileşenler ────────────────────────────────────────────────────────────
  function IconBox({ name, active }) {
    return (
      <span
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
          active ? ICON_ACTIVE : ICON_IDLE
        }`}
      >
        {resolveIcon(name)}
      </span>
    );
  }

  function LeafBtn({ item, active }) {
    return (
      <button
        type="button"
        onClick={() => handleLeaf(item)}
        className={`${BTN_BASE} ${active ? BTN_ACTIVE : BTN_IDLE}`}
      >
        <IconBox name={item.icon} active={active} />
        <span className="truncate">{item.label}</span>
      </button>
    );
  }

  function ActionBtn({ item }) {
    return (
      <button
        type="button"
        onClick={() => handleAction(item)}
        className={`${BTN_BASE} ${BTN_IDLE}`}
      >
        <IconBox name={item.icon} active={false} />
        <span className="truncate">{item.label}</span>
      </button>
    );
  }

  function BranchItem({ item }) {
    const active   = activeTab === item.id;
    const expanded = !!openBranches[item.id];
    const children = childrenOf(item).filter((c) => canSee(c.visibleTo));

    return (
      <div className="space-y-2">
        {/* Branch başlık satırı */}
        <div
          className={`flex min-h-[96px] items-center gap-2 rounded-[22px] border px-4 py-4 transition ${
            active ? BTN_ACTIVE : BTN_IDLE
          }`}
        >
          {/* Sol: ikon + etiket */}
          <button
            type="button"
            onClick={() => handleBranch(item)}
            className={`flex min-w-0 flex-1 items-center gap-3 text-left text-sm font-medium ${
              active ? "text-white" : "text-slate-700"
            }`}
          >
            <IconBox name={item.icon} active={active} />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">{item.label}</div>
              <div className={`mt-1 text-xs leading-5 ${active ? "text-slate-300" : "text-slate-500"}`}>
                Alt sayfalara hızlı geçiş
              </div>
            </div>
          </button>

          {/* Sağ: açma/kapama düğmesi */}
          {children.length > 0 && (
            <button
              type="button"
              aria-label={expanded ? `${item.label} kapat` : `${item.label} aç`}
              aria-expanded={String(expanded)}
              onClick={() =>
                setOpenBranches((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
              }
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition ${
                active
                  ? "border-white/10 bg-white/10 text-white hover:bg-white/15"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>

        {/* Alt öğeler (animasyonlu grid) */}
        {children.length > 0 && (
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
              expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <div
                className={`ml-4 space-y-1 rounded-[20px] border px-2 py-2 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.18)] ${
                  active ? "border-slate-200 bg-slate-50/95" : "border-slate-200 bg-white"
                }`}
              >
                {children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => handleLeaf(child)}
                    className="block w-full rounded-xl px-3 py-2 text-left text-[13px] text-slate-600 transition hover:bg-white hover:text-slate-900"
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function GroupSection({ group }) {
    const visibleItems = (group.children || []).filter((item) =>
      canSee(item.visibleTo),
    );
    if (visibleItems.length === 0) return null;

    const isCollapsible = group.collapsible;
    const isOpen = !isCollapsible || !!openGroups[group.id];

    return (
      <section>
        {/* Grup başlığı */}
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {group.label}
          </span>
          {isCollapsible && (
            <button
              type="button"
              aria-label={isOpen ? `${group.label} kapat` : `${group.label} aç`}
              onClick={() =>
                setOpenGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
              }
              className="rounded-md p-0.5 text-slate-400 hover:text-slate-600 transition"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>

        {/* Öğeler */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="space-y-2 pb-1">
              {visibleItems.map((item) => {
                if (item.type === "branch") {
                  return <BranchItem key={item.id} item={item} />;
                }
                if (item.type === "action") {
                  return canSee(item.visibleTo) ? (
                    <ActionBtn key={item.id} item={item} />
                  ) : null;
                }
                // leaf
                return canSee(item.visibleTo) ? (
                  <LeafBtn
                    key={item.id}
                    item={item}
                    active={activeTab === item.id}
                  />
                ) : null;
              })}
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const sidebarGroups = MENU_CONFIG.filter((g) => !g.isQuickAction);

  return (
    <>
      {/* Mobil backdrop — tıklanınca drawer kapanır */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm xl:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar paneli
          Mobil (< xl)  : fixed drawer, translate ile açılıp kapanır
          Masaüstü (xl+): belge akışında, her zaman görünür            */}
      <aside
        className={[
          // Mobil: sabit konumlu drawer
          "fixed inset-y-0 left-0 z-50 w-[300px] overflow-y-auto p-4",
          "transition-transform duration-300 ease-in-out",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          // Masaüstü override (xl+)
          "xl:relative xl:inset-auto xl:z-auto xl:w-auto xl:translate-x-0 xl:min-h-0 xl:transition-none",
          // Ortak görsel stiller
          "rounded-[28px] border border-slate-200 bg-white/90",
          "shadow-[0_18px_42px_-34px_rgba(15,23,42,0.24)]",
        ].join(" ")}
      >
        {/* Mobil kapatma düğmesi (xl+ gizli) */}
        <div className="mb-3 flex items-center justify-between xl:hidden">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Menü
          </span>
          <button
            type="button"
            aria-label="Menüyü kapat"
            onClick={() => setDrawerOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modül bilgi kutusu */}
        <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Çalışma Alanı
          </div>
          <div className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
            {moduleLabel}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Operasyon modülleri solda, sık kullanılan aksiyonlar üstte tutulur.
          </p>
        </div>

        {/* Grup listesi */}
        <div className="mt-5 space-y-5">
          {sidebarGroups.map((group) =>
            canSee(group.visibleTo) ? (
              <GroupSection key={group.id} group={group} />
            ) : null,
          )}
        </div>
      </aside>

      {/* Hamburger FAB — yalnızca mobilde görünür (xl+ gizli) */}
      <button
        type="button"
        aria-label={drawerOpen ? "Menüyü kapat" : "Menüyü aç"}
        aria-expanded={String(drawerOpen)}
        onClick={() => setDrawerOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 xl:hidden flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_8px_28px_-6px_rgba(15,23,42,0.45)] transition-transform duration-200 active:scale-95 hover:bg-slate-800"
      >
        {drawerOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
    </>
  );
}
