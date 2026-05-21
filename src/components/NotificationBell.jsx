// src/components/NotificationBell.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { http } from "../lib/api.js";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  const loadUnread = useCallback(async () => {
    try {
      const res = await http.get("/api/notifications/unread-count");
      setUnread(res?.count ?? 0);
    } catch {}
  }, []);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await http.get("/api/notifications?limit=20");
      const items = Array.isArray(res?.notifications)
        ? res.notifications
        : Array.isArray(res?.items)
          ? res.items
          : [];
      setNotifications(items);
      setUnread(items.filter((item) => !item?.read).length);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadUnread();
    const interval = setInterval(loadUnread, 30000);
    return () => clearInterval(interval);
  }, [loadUnread]);

  useEffect(() => {
    if (!open) return;
    loadNotifications();
  }, [open, loadNotifications]);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {};
      const incoming = {
        _id: detail?.id || detail?._id || `live-${Date.now()}`,
        title: String(detail?.title || "").trim(),
        message: String(detail?.message || detail?.body || "").trim(),
        body: String(detail?.body || detail?.message || "").trim(),
        read: false,
        createdAt: detail?.createdAt || new Date().toISOString(),
        type: detail?.type || "info",
      };
      setUnread((prev) => prev + 1);
      setNotifications((prev) => {
        const existing = prev.find((item) => String(item?._id) === String(incoming._id));
        if (existing) return prev;
        return [incoming, ...prev].slice(0, 20);
      });
    };
    window.addEventListener("notification:new", handler);
    return () => window.removeEventListener("notification:new", handler);
  }, []);

  // Panel dışı tıklamada kapat
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markAllRead = async () => {
    try {
      await http.patch("/api/notifications/read-all", {});
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch {}
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "az önce";
    if (m < 60) return `${m}dk önce`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}s önce`;
    return `${Math.floor(h / 24)}g önce`;
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        aria-label={`Bildirimler${unread > 0 ? ` (${unread} okunmamış)` : ""}`}
        title="Bildirimler"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl border bg-white shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-[13px] font-semibold text-slate-800">Bildirimler</span>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-sky-600 hover:text-sky-800 flex items-center gap-0.5"
                  title="Tümünü okundu işaretle"
                >
                  <Check size={12} /> Tümü okundu
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-400 ml-1" aria-label="Kapat">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && (
              <div className="py-8 text-center text-[12px] text-slate-400">Yükleniyor…</div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="py-8 text-center text-[12px] text-slate-400">Bildirim yok</div>
            )}
            {!loading && notifications.map((n) => (
              <div
                key={n._id}
                className={`px-4 py-3 border-b last:border-0 ${!n.read ? "bg-sky-50" : ""}`}
              >
                <div className="flex items-start gap-2">
                  {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />}
                    <div className={!n.read ? "" : "pl-3.5"}>
                    <div className="text-[12px] font-semibold text-slate-800">{n.title}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{n.message || n.body}</div>
                    <div className="text-[10px] text-slate-400 mt-1">{timeAgo(n.createdAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
