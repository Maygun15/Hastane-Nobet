// src/tabs/MyRequestsTab.jsx
import React, { useEffect, useMemo, useState } from "react";
import { createRequest, getMyRequests } from "../api/apiAdapter.js";

const typeLabels = {
  izin: "İzin",
  takas: "Takas",
  tercih: "Tercih",
  diger: "Diğer",
};

const statusTone = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
};

export default function MyRequestsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const [type, setType] = useState("izin");
  const [targetDate, setTargetDate] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await getMyRequests();
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setError(e?.message || "Talepler alınamadı");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    if (!type || !message.trim()) {
      setError("Tür ve mesaj zorunlu");
      return;
    }
    try {
      setSubmitting(true);
      setError("");
      await createRequest({
        type,
        targetDate,
        message: message.trim(),
      });
      setOpen(false);
      setType("izin");
      setTargetDate("");
      setMessage("");
      load();
    } catch (e) {
      setError(e?.message || "Talep gönderilemedi");
    } finally {
      setSubmitting(false);
    }
  };

  const rows = useMemo(() => items || [], [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-[15px]">Taleplerim</div>
        <button
          className="px-3 py-2 rounded-lg bg-sky-600 text-white text-sm hover:bg-sky-700"
          onClick={() => setOpen(true)}
        >
          + Yeni Talep
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Yükleniyor...</div>
      ) : rows.length === 0 ? (
        <div className="p-4 rounded-lg border text-sm text-slate-600">Henüz talep yok.</div>
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <div key={r._id || r.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-600">
                  {r.createdAt ? new Date(r.createdAt).toLocaleString("tr-TR") : "-"}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] ${statusTone[r.status] || "bg-slate-100 text-slate-700"}`}>
                  {r.status === "approved" ? "Onaylandı" : r.status === "rejected" ? "Reddedildi" : "Beklemede"}
                </span>
              </div>
              <div className="mt-2 text-[13px]">
                <div className="font-medium">{typeLabels[r.type] || r.type}</div>
                <div className="text-slate-600">{r.message}</div>
                {r.status === "rejected" && r.adminNote ? (
                  <div className="mt-2 text-rose-700 text-[12px]">
                    Admin notu: {r.adminNote}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="font-semibold">Yeni Talep</div>
              <button className="text-sm text-slate-500" onClick={() => setOpen(false)}>Kapat</button>
            </div>
            <div className="p-5 space-y-3">
              <label className="flex flex-col gap-1 text-sm">
                Tür
                <select
                  className="h-9 rounded-lg border px-3 text-sm"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value="izin">İzin</option>
                  <option value="takas">Takas</option>
                  <option value="tercih">Tercih</option>
                  <option value="diger">Diğer</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Tarih
                <input
                  type="date"
                  className="h-9 rounded-lg border px-3 text-sm"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Mesaj
                <textarea
                  rows={3}
                  className="rounded-lg border px-3 py-2 text-sm"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Talebinizi yazın..."
                />
              </label>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2">
              <button className="px-3 py-2 rounded-lg border" onClick={() => setOpen(false)}>
                Vazgeç
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm hover:bg-sky-700 disabled:opacity-60"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? "Gönderiliyor..." : "Gönder"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
