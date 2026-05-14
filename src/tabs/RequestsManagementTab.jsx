// src/tabs/RequestsManagementTab.jsx
import React, { useEffect, useMemo, useState } from "react";
import { getMyRequests, updateRequest } from "../api/apiAdapter.js";

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

export default function RequestsManagementTab() {
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [error, setError] = useState("");
  const [noteFor, setNoteFor] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [processing, setProcessing] = useState("");

  const load = async () => {
    try {
      setError("");
      const res = await getMyRequests();
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setError(e?.message || "Talepler alınamadı");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return (items || []).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      return true;
    });
  }, [items, statusFilter, typeFilter]);

  const approve = async (r) => {
    const id = r._id || r.id;
    if (processing === id) return;
    setProcessing(id);
    try {
      setError("");
      await updateRequest(id, { status: "approved", adminNote: "" });
      load();
    } catch (e) {
      setError(e?.message || "Onaylanamadı");
    } finally {
      setProcessing("");
    }
  };

  const reject = async (r) => {
    const id = r._id || r.id;
    if (processing === id) return;
    setProcessing(id);
    try {
      setError("");
      await updateRequest(id, { status: "rejected", adminNote: noteText });
      setNoteFor(null);
      setNoteText("");
      load();
    } catch (e) {
      setError(e?.message || "Reddedilemedi");
    } finally {
      setProcessing("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-[15px]">Talepler</div>
        <div className="flex gap-2">
          <select
            className="h-9 rounded-lg border px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Hepsi</option>
            <option value="pending">Beklemede</option>
            <option value="approved">Onaylandı</option>
            <option value="rejected">Reddedildi</option>
          </select>
          <select
            className="h-9 rounded-lg border px-3 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">Tümü</option>
            <option value="izin">İzin</option>
            <option value="takas">Takas</option>
            <option value="tercih">Tercih</option>
            <option value="diger">Diğer</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="p-4 rounded-lg border text-sm text-slate-600">Talep bulunamadı.</div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((r) => (
            <div key={r._id || r.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-600">
                  {r.fromName || "-"} • {r.serviceId || "-"} • {r.targetDate || "-"}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] ${statusTone[r.status] || "bg-slate-100 text-slate-700"}`}>
                  {r.status === "approved" ? "Onaylandı" : r.status === "rejected" ? "Reddedildi" : "Beklemede"}
                </span>
              </div>
              <div className="mt-2 text-[13px]">
                <div className="font-medium">{typeLabels[r.type] || r.type}</div>
                <div className="text-slate-600">{r.message}</div>
                {r.adminNote ? (
                  <div className="mt-2 text-[12px] text-slate-500">Not: {r.adminNote}</div>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={!!processing}
                  className="text-[12px] px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-60"
                  onClick={() => approve(r)}
                >
                  {processing === (r._id || r.id) ? "…" : "Onayla"}
                </button>
                <button
                  disabled={!!processing}
                  className="text-[12px] px-3 py-1 rounded bg-rose-600 text-white disabled:opacity-60"
                  onClick={() => setNoteFor(r)}
                >
                  Reddet
                </button>
              </div>

              {noteFor && (noteFor._id || noteFor.id) === (r._id || r.id) && (
                <div className="mt-3 space-y-2">
                  <textarea
                    rows={2}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="Reddetme nedeni..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={!!processing}
                      className="text-[12px] px-3 py-1 rounded border disabled:opacity-60"
                      onClick={() => { setNoteFor(null); setNoteText(""); }}
                    >
                      Vazgeç
                    </button>
                    <button
                      disabled={!!processing}
                      className="text-[12px] px-3 py-1 rounded bg-rose-600 text-white disabled:opacity-60"
                      onClick={() => reject(r)}
                    >
                      {processing === (r._id || r.id) ? "…" : "Reddet"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
