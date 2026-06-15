// src/components/layout/Sidebar.jsx
import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
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
  ShieldCheck,
  UserRound,
  Users2,
  X,
} from "lucide-react";

import { MENU_CONFIG } from "../../config/menuConfig.js";
import { LS } from "../../utils/storage.js";

// ── İkon adı → bileşen eşlemesi ──────────────────────────────────────────────
const ICON_MAP = {
  Activity, BarChart, BarChart2, Bell, Bot, CalendarCheck, CalendarClock,
  CalendarDays, CalendarCog, CircleDollarSign, ClipboardList, Clock4,
  FileText, LayoutDashboard, Megaphone, PieChart, Scale,
  Settings2, ShieldCheck, UserRound, Users2,
};

// ── Sabitler ──────────────────────────────────────────────────────────────────
const DEFAULT_PERSONNEL_SECTIONS = [
  { id: "hemsireler", name: "Hemşireler" },
  { id: "doktorlar",  name: "Doktorlar"  },
];

// ── Stil sabitleri — Modern Minimalist SaaS ───────────────────────────────────
const ITEM =
  "flex w-full items-center gap-2.5 rounded-lg border-l-2 pl-2.5 pr-3 py-[7px] text-[13px] font-medium transition-colors";
const ITEM_ACTIVE = "border-blue-500 bg-blue-50 text-blue-700";
const ITEM_IDLE   = "border-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-800";

// ── Yardımcılar ───────────────────────────────────────────────────────────────
function pushUrl(path) {
  try {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new Event("urlchange"));
  } catch {}
}

function parentTabId(itemId) {
  return itemId.includes(":") ? itemId.split(":")[0] : itemId;
}

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
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [openGroups, setOpenGroups] = useState({
    yonetim: true,
    raporlar: false,
    analiz:   true,
  });

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

  // ── Rol filtresi ──────────────────────────────────────────────────────────────
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

  function handleAction(item) {
    onAction?.(item.action);
  }

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

  // ── Alt bileşenler ────────────────────────────────────────────────────────────
  function LeafBtn({ item, active }) {
    const Icon = ICON_MAP[item.icon];
    return (
      <button
        type="button"
        onClick={() => handleLeaf(item)}
        className={`${ITEM} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="truncate">{item.label}</span>
      </button>
    );
  }

  function ActionBtn({ item }) {
    const Icon = ICON_MAP[item.icon];
    return (
      <button
        type="button"
        onClick={() => handleAction(item)}
        className={`${ITEM} ${ITEM_IDLE}`}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="truncate">{item.label}</span>
      </button>
    );
  }

  function BranchItem({ item }) {
    const active   = activeTab === item.id;
    const expanded = !!openBranches[item.id];
    const children = childrenOf(item).filter((c) => canSee(c.visibleTo));
    const Icon = ICON_MAP[item.icon];

    function toggle() {
      navigate(item.path);
      onTabChange(item.id);
      setOpenBranches((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
      setDrawerOpen(false);
    }

    return (
      <div>
        <button
          type="button"
          onClick={toggle}
          className={`${ITEM} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}
        >
          {Icon && <Icon className="h-4 w-4 shrink-0" />}
          <span className="flex-1 truncate text-left">{item.label}</span>
          {children.length > 0 && (
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
            />
          )}
        </button>

        {/* Alt öğeler */}
        {children.length > 0 && expanded && (
          <div className="ml-[22px] mt-0.5 space-y-0.5 border-l border-slate-100 pl-2.5">
            {children.map((child) => {
              const childActive = activeTab === parentTabId(child.id);
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => handleLeaf(child)}
                  className={`flex w-full rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                    childActive
                      ? "font-medium text-blue-700 bg-blue-50/60"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}
                >
                  {child.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function GroupSection({ group, showDivider }) {
    const visibleItems = (group.children || []).filter((item) =>
      canSee(item.visibleTo),
    );
    if (visibleItems.length === 0) return null;

    const isCollapsible = group.collapsible;
    const isOpen = !isCollapsible || !!openGroups[group.id];

    return (
      <>
        {showDivider && <div className="my-2 border-t border-slate-100" />}
        <section>
          {/* Grup başlığı */}
          <div className="mb-1 flex items-center justify-between px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {group.label}
            </span>
            {isCollapsible && (
              <button
                type="button"
                onClick={() =>
                  setOpenGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                }
                className="rounded p-0.5 text-slate-300 transition hover:text-slate-500"
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </div>

          {/* Öğeler */}
          {isOpen && (
            <div className="space-y-0.5">
              {visibleItems.map((item) => {
                if (item.type === "branch") {
                  return <BranchItem key={item.id} item={item} />;
                }
                if (item.type === "action") {
                  return canSee(item.visibleTo)
                    ? <ActionBtn key={item.id} item={item} />
                    : null;
                }
                return canSee(item.visibleTo)
                  ? <LeafBtn key={item.id} item={item} active={activeTab === item.id} />
                  : null;
              })}
            </div>
          )}
        </section>
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const sidebarGroups = MENU_CONFIG.filter((g) => !g.isQuickAction && canSee(g.visibleTo));

  return (
    <>
      {/* Mobil backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm xl:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 w-[260px] overflow-y-auto p-3",
          "transition-transform duration-300 ease-in-out",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          "xl:relative xl:inset-auto xl:z-auto xl:w-[220px] xl:translate-x-0 xl:min-h-0 xl:transition-none",
          "rounded-[28px] border border-slate-200 bg-white/90",
          "shadow-[0_18px_42px_-34px_rgba(15,23,42,0.24)]",
        ].join(" ")}
      >
        {/* Mobil kapatma */}
        <div className="mb-2 flex items-center justify-between xl:hidden">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Menü
          </span>
          <button
            type="button"
            aria-label="Menüyü kapat"
            onClick={() => setDrawerOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Grup listesi */}
        <nav className="space-y-0">
          {sidebarGroups.map((group, idx) => (
            <GroupSection key={group.id} group={group} showDivider={idx > 0} />
          ))}
        </nav>
      </aside>

      {/* Hamburger FAB — yalnızca mobilde */}
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
