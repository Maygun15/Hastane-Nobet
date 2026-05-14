// src/components/TopBar.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, CheckCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import { apiFetch } from "../lib/api.js";

function Badge({ children, tone = "slate" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    blue:  "bg-sky-100 text-sky-700",
    red:   "bg-rose-100 text-rose-700",
    green: "bg-emerald-100 text-emerald-700",
  }[tone] || "bg-slate-100 text-slate-700";
  return <span className={`px-2 py-0.5 rounded-full text-[11px] ${cls}`}>{children}</span>;
}

const TYPE_STYLE = {
  success: "border-l-4 border-emerald-400 bg-emerald-50",
  error:   "border-l-4 border-rose-400 bg-rose-50",
  warning: "border-l-4 border-amber-400 bg-amber-50",
  info:    "border-l-4 border-sky-400 bg-sky-50",
};

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
      className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border z-50 overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
        <span className="text-sm font-semibold text-slate-800">
          Bildirimler
          {unread > 0 && (
            <span className="ml-1.5 text-[10px] bg-rose-500 text-white rounded-full px-1.5 py-0.5">{unread}</span>
          )}
        </span>
        {unread > 0 && (
          <button
            onClick={markAll}
            className="text-xs text-sky-600 hover:underline flex items-center gap-1"
          >
            <CheckCheck className="w-3 h-3" /> Tümünü okundu yap
          </button>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
        {loading && (
          <div className="py-8 text-center text-sm text-slate-400">Yükleniyor…</div>
        )}
        {!loading && items.length === 0 && (
          <div className="py-10 text-center">
            <BellOff className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">Henüz bildirim yok</p>
          </div>
        )}
        {!loading && items.map((n) => (
          <div
            key={n._id}
            onClick={() => { if (!n.read) markOne(n._id); }}
            className={`px-4 py-3 cursor-pointer transition-opacity ${TYPE_STYLE[n.type] || TYPE_STYLE.info} ${n.read ? "opacity-50" : ""}`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                {n.title && (
                  <p className="text-xs font-semibold text-slate-700 truncate">{n.title}</p>
                )}
                <p className="text-xs text-slate-600 leading-snug mt-0.5">{n.message}</p>
                <p className="text-[10px] text-slate-400 mt-1">
                  {new Date(n.createdAt).toLocaleString("tr-TR", {
                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
              {!n.read && <Check className="w-3.5 h-3.5 text-sky-500 mt-0.5 flex-shrink-0" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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

  const roleTone = user.role === "ADMIN" || user.role === "admin" ? "red"
    : user.role === "AUTHORIZED" || user.role === "staff" ? "blue"
    : "slate";

  return (
    <header className="w-full h-14 bg-white border-b flex items-center justify-between px-3 sm:px-4 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="font-semibold text-sm sm:text-base truncate">
          🏥 <span className="hidden sm:inline">Hastane Nöbet Sistemi</span>
          <span className="sm:hidden">Nöbet</span>
        </div>
        <Badge tone="blue">v1.2.0</Badge>
      </div>

      <div className="flex items-center gap-2">
        {/* Bildirim zili */}
        <div className="relative">
          <button
            onClick={() => setPanelOpen((o) => !o)}
            className="relative h-9 w-9 flex items-center justify-center rounded-md border bg-white hover:bg-slate-50 transition-colors"
            title="Bildirimler"
          >
            <Bell className="h-4 w-4 text-slate-600" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 min-w-[16px] flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] px-0.5 font-bold leading-none">
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

        {/* Kullanıcı adı — küçük ekranda gizle */}
        <div className="text-right hidden sm:block">
          <div className="text-sm font-medium leading-4">
            {user.name || user.email || "Kullanıcı"}
          </div>
          <div className="leading-4 mt-0.5">
            <Badge tone={roleTone}>{user.role}</Badge>
          </div>
        </div>

        {/* Çıkış */}
        <button
          onClick={logout}
          className="h-9 px-3 rounded-md border bg-white hover:bg-slate-50 text-sm"
          title="Çıkış"
        >
          Çıkış
        </button>
      </div>
    </header>
  );
}
