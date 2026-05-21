import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Megaphone, X } from "lucide-react";
import { toast } from "sonner";
import { http } from "../lib/api.js";

function normalizeNotification(raw = {}) {
  const id = raw._id || raw.id || `announcement-${raw.createdAt || Date.now()}`;
  return {
    ...raw,
    _id: String(id),
    type: String(raw.type || "").trim(),
    title: String(raw.title || "").trim(),
    message: String(raw.message || raw.body || "").trim(),
    read: !!raw.read,
    data: raw.data && typeof raw.data === "object" ? raw.data : {},
    createdAt: raw.createdAt || new Date().toISOString(),
  };
}

function isAnnouncement(item) {
  return String(item?.type || "").toLowerCase() === "announcement";
}

function timeLabel(dateStr) {
  if (!dateStr) return "";
  const time = new Date(dateStr).getTime();
  if (!Number.isFinite(time)) return "";
  const diff = Date.now() - time;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

function announcementMode(item) {
  return String(item?.data?.announcementMode || "info").toLowerCase();
}

function hasResponse(item) {
  return !!item?.data?.response?.type;
}

function needsAction(item) {
  const mode = announcementMode(item);
  return (mode === "ack" || mode === "reply") && !hasResponse(item);
}

function pickPrimary(items) {
  if (!items.length) return null;
  return (
    items.find(needsAction) ||
    items.find((item) => !item.read) ||
    items[0]
  );
}

export default function AnnouncementsPanel({ limit = 30 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const unreadCount = useMemo(
    () => items.filter((item) => !item.read).length,
    [items]
  );
  const actionCount = useMemo(
    () => items.filter(needsAction).length,
    [items]
  );
  const primaryItem = useMemo(() => pickPrimary(items), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await http.get("/api/notifications?limit=50&type=announcement");
      const rawItems = Array.isArray(res?.notifications)
        ? res.notifications
        : Array.isArray(res?.items)
          ? res.items
          : [];
      setItems(
        rawItems
          .map(normalizeNotification)
          .filter(isAnnouncement)
          .slice(0, limit)
      );
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = (event) => {
      const incoming = normalizeNotification(event?.detail || {});
      if (!isAnnouncement(incoming)) return;
      setItems((prev) => {
        if (prev.some((item) => String(item._id) === String(incoming._id))) return prev;
        return [incoming, ...prev].slice(0, limit);
      });
    };
    window.addEventListener("notification:new", handler);
    return () => window.removeEventListener("notification:new", handler);
  }, [limit]);

  const markAllRead = async () => {
    try {
      await http.patch("/api/notifications/read-all?type=announcement", {});
      setItems((prev) => prev.map((item) => ({ ...item, read: true })));
    } catch {}
  };

  const respond = async (item, responseType) => {
    const id = String(item?._id || "");
    if (!id) return;
    const message = String(drafts[id] || "").trim();
    if (responseType === "reply" && !message) {
      toast.error("Cevap içeriği zorunludur");
      return;
    }
    setBusyId(id);
    try {
      const res = await http.post(`/api/notifications/${id}/respond`, { responseType, message });
      const response = res?.response || {};
      setItems((prev) => prev.map((entry) => {
        if (String(entry._id) !== id) return entry;
        return {
          ...entry,
          read: true,
          data: {
            ...(entry.data || {}),
            response: {
              type: response.responseType || responseType,
              message: response.message || message,
              createdAt: response.updatedAt || response.createdAt || new Date().toISOString(),
            },
          },
        };
      }));
      setDrafts((prev) => ({ ...prev, [id]: "" }));
      toast.success(responseType === "ack" ? "Okundu onayı kaydedildi" : "Cevabınız gönderildi");
    } catch (e) {
      toast.error(e?.message || "Yanıt kaydedilemedi");
    } finally {
      setBusyId("");
    }
  };

  const markOneRead = async (item) => {
    const id = String(item?._id || "");
    if (!id) return;
    try {
      await http.patch(`/api/notifications/${id}/read`, {});
      setItems((prev) => prev.map((entry) => (
        String(entry._id) === id ? { ...entry, read: true } : entry
      )));
    } catch {}
  };

  const renderItem = (item, { compact = false } = {}) => {
    const mode = announcementMode(item);
    const response = item.data?.response || null;
    const isBusy = busyId === String(item._id);
    return (
      <article key={item._id} className={`${!item.read ? "bg-sky-50/60" : ""} ${compact ? "" : "border-b border-slate-100 last:border-b-0"}`}>
        <div className={`flex gap-3 ${compact ? "px-4 py-3" : "px-4 py-4"}`}>
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.read ? "bg-slate-300" : "bg-sky-500"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="truncate text-[13px] font-semibold text-slate-900">
                {item.title || "Duyuru"}
              </h3>
              <span className="text-[10px] text-slate-400">{timeLabel(item.createdAt)}</span>
            </div>
            {item.message && (
              <p className="mt-1 text-[12px] leading-5 text-slate-600">{item.message}</p>
            )}
            {mode === "info" && !item.read && (
              <button
                type="button"
                onClick={() => markOneRead(item)}
                className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-white"
              >
                Okundu yap
              </button>
            )}
            {mode === "ack" && (
              <div className="mt-3">
                {response?.type === "ack" ? (
                  <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    Okundu onayı verildi
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => respond(item, "ack")}
                    className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                  >
                    Okudum
                  </button>
                )}
              </div>
            )}
            {mode === "reply" && (
              <div className="mt-3 space-y-2">
                {response?.type === "reply" ? (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
                    Cevabınız kaydedildi: {response.message || "-"}
                  </div>
                ) : (
                  <>
                    <textarea
                      rows={compact ? 1 : 2}
                      value={drafts[item._id] || ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [item._id]: e.target.value }))}
                      placeholder="Kısa cevabınızı yazın..."
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[12px] outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                    />
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => respond(item, "reply")}
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                    >
                      Cevap gönder
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </article>
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Megaphone size={17} />
          </span>
          <div>
            <div className="text-[13px] font-semibold text-slate-900">Duyurular</div>
            <div className="text-[11px] text-slate-500">
              Yönetim tarafından gönderilen son duyurular
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actionCount > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
              {actionCount} işlem bekliyor
            </span>
          )}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Tüm duyurular {items.length ? `(${items.length})` : ""}
          </button>
        </div>
      </div>

      <div>
        {loading && items.length === 0 && (
          <div className="px-4 py-4 text-[12px] text-slate-400">Duyurular yükleniyor...</div>
        )}
        {!loading && items.length === 0 && (
          <div className="px-4 py-4 text-[12px] text-slate-400">Henüz duyuru yok.</div>
        )}
        {primaryItem && renderItem(primaryItem, { compact: true })}
      </div>

      {historyOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" onClick={() => setHistoryOpen(false)}>
          <div
            className="h-full w-full max-w-xl overflow-hidden bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-[15px] font-semibold text-slate-900">Tüm Duyurular</div>
                <div className="text-[11px] text-slate-500">
                  Son duyurular, okundu onayları ve cevaplar
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Kapat"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div className="text-[12px] text-slate-500">
                {unreadCount > 0 ? `${unreadCount} okunmamış duyuru` : "Okunmamış duyuru yok"}
              </div>
              {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <Check size={13} />
                  Tümünü okundu yap
          </button>
              )}
            </div>
            <div className="h-[calc(100vh-110px)] overflow-y-auto">
              {items.length === 0 && (
                <div className="px-5 py-8 text-center text-[12px] text-slate-400">Henüz duyuru yok.</div>
              )}
              {items.map((item) => renderItem(item))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
