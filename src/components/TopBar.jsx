// src/components/TopBar.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, CheckCheck, LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { apiFetch } from "../lib/api.js";

// ── Bildirim tipi renk sistemi ──────────────────────────────────────
const TYPE_STYLE = {
  success: "border-l-2 border-emerald-400 bg-emerald-50/80",
  error:   "border-l-2 border-rose-400 bg-rose-50/80",
  warning: "border-l-2 border-amber-400 bg-amber-50/80",
  info:    "border-l-2 border-brand-600/60 bg-brand-50/60",
};

// ── Kullanıcının baş harflerinden avatar ────────────────────────────
function UserAvatar({ name, role }) {
  const initials = String(name || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const color =
    role === "ADMIN" || role === "admin"
      ? "bg-rose-500"
      : role === "AUTHORIZED" || role === "staff"
      ? "bg-brand-600"
      : "bg-slate-500";

  return (
    <div
      className={`h-8 w-8 rounded-full ${color} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 select-none`}
    >
      {initials}
    </div>
  );
}

// ── Bildirim paneli ─────────────────────────────────────────────────
function NotificationPanel({ onClose, onCountChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch("/api/notifications?limit=40");
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const markAll = async () => {
    try { await apiFetch("/api/notifications/read-all", { method: "PATCH" }); } catch {}
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    onCountChange(0);
  };

  const markOne = async (id) => {
    try { await apiFetch(`/api/notifications/${id}/read`, { method: "PATCH" }); } catch {}
    setItems((prev) => {
      const next = prev.map((n) => n._id === id ? { ...n, read: true } : n);
      onCountChange(next.filter((n) => !n.read).length);
      return next;
    });
  };

  const unread = items.filter((n) => !n.read).length;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-2.5 w-80 sm:w-96 bg-white rounded-card shadow-panel border border-slate-200/80 z-50 overflow-hidden"
    >
      {/* Panel başlık */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/70">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">Bildirimler</span>
          {unread > 0 && (
            <span className="text-[10px] font-bold bg-rose-500 text-white rounded-full px-1.5 py-0.5 leading-none">
              {unread}
            </span>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={markAll}
            className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1 font-medium transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Tümünü okundu yap
          </button>
        )}
      </div>

      {/* Bildirim listesi */}
      <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
        {loading && (
          <div className="py-8 text-center text-sm text-ink-faint">Yükleniyor…</div>
        )}
        {!loading && items.length === 0 && (
          <div className="py-10 text-center">
            <BellOff className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-ink-faint">Henüz bildirim yok</p>
          </div>
        )}
        {!loading && items.map((n) => (
          <div
            key={n._id}
            onClick={() => { if (!n.read) markOne(n._id); }}
            className={`px-4 py-3 cursor-pointer transition-opacity ${TYPE_STYLE[n.type] || TYPE_STYLE.info} ${n.read ? "opacity-40" : "hover:brightness-95"}`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                {n.title && (
                  <p className="text-xs font-semibold text-ink truncate">{n.title}</p>
                )}
                <p className="text-xs text-ink-muted leading-snug mt-0.5">{n.message}</p>
                <p className="text-[10px] text-ink-faint mt-1 font-mono">
                  {new Date(n.createdAt).toLocaleString("tr-TR", {
                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
              {!n.read && <Check className="w-3.5 h-3.5 text-brand-600 mt-0.5 flex-shrink-0" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Ana TopBar bileşeni ─────────────────────────────────────────────
export default function TopBar() {
  const { user, logout } = useAuth();
  const [panelOpen, setPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const data = await apiFetch("/api/notifications/unread-count");
      setUnreadCount(Number(data?.count) || 0);
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => clearInterval(id);
  }, [user, fetchCount]);

  if (!user) return null;

  const displayName = user.name || user.email || "Kullanıcı";
  const roleLabel =
    user.role === "ADMIN" || user.role === "admin" ? "Yönetici"
    : user.role === "AUTHORIZED" || user.role === "staff" ? "Yetkili"
    : "Kullanıcı";

  return (
    <header className="w-full h-14 bg-brand-900 flex items-center justify-between px-4 sm:px-6 gap-4 flex-shrink-0">

      {/* ── Logo + Başlık ── */}
      <div className="flex items-center gap-3 min-w-0">
        {/* SVG Hastane İkonu */}
        <div className="flex-shrink-0 w-8 h-8 rounded-control bg-white/10 flex items-center justify-center">
          <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
            <rect x="3" y="3" width="14" height="14" rx="2" fill="white" fillOpacity="0.15" stroke="white" strokeWidth="1.25"/>
            <path d="M10 6.5v7M6.5 10h7" stroke="white" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-white font-semibold text-sm leading-none tracking-tight truncate">
            Nöbet Yönetim Sistemi
          </div>
          <div className="text-white/40 text-[10px] font-mono mt-0.5 hidden sm:block">
            Hastane Çizelge
          </div>
        </div>
      </div>

      {/* ── Sağ Taraf ── */}
      <div className="flex items-center gap-2">

        {/* Bildirim zili */}
        <div className="relative">
          <button
            onClick={() => setPanelOpen((o) => !o)}
            className="relative h-9 w-9 flex items-center justify-center rounded-control bg-white/8 hover:bg-white/15 transition-colors"
            title="Bildirimler"
          >
            <Bell className="h-4 w-4 text-white/80" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] px-0.5 font-bold leading-none border-2 border-brand-900">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          {panelOpen && (
            <NotificationPanel
              onClose={() => { setPanelOpen(false); fetchCount(); }}
              onCountChange={setUnreadCount}
            />
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-white/15 hidden sm:block" />

        {/* Kullanıcı bilgisi */}
        <div className="hidden sm:flex items-center gap-2.5">
          <UserAvatar name={displayName} role={user.role} />
          <div className="min-w-0">
            <div className="text-white text-[13px] font-medium leading-none truncate max-w-[140px]" title={displayName}>
              {displayName}
            </div>
            <div className="text-white/50 text-[10px] mt-0.5">{roleLabel}</div>
          </div>
        </div>

        {/* Çıkış */}
        <button
          onClick={logout}
          className="h-9 w-9 flex items-center justify-center rounded-control bg-white/8 hover:bg-white/15 transition-colors"
          title="Çıkış Yap"
        >
          <LogOut className="h-4 w-4 text-white/70" />
        </button>
      </div>
    </header>
  );
}
