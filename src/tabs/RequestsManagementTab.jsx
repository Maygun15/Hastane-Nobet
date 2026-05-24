// src/tabs/RequestsManagementTab.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getMyRequests, updateRequest } from "../api/apiAdapter.js";
import { loadLeavesFromBackend, emitLeavesChanged } from "../lib/leaves.js";

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

const peerTone = {
  pending:  "bg-amber-50 text-amber-600 border border-amber-200",
  accepted: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  rejected: "bg-rose-50 text-rose-600 border border-rose-200",
};
const peerLabel = { pending: "Karşı taraf: yanıt bekleniyor", accepted: "Karşı taraf onayladı", rejected: "Karşı taraf reddetti" };

function requestMonthDate(r) {
  return (
    r?.targetDate ||
    r?.swapMyDate ||
    r?.swapTargetDate ||
    r?.createdAt ||
    ""
  );
}

function requestMonthKey(r) {
  const raw = String(requestMonthDate(r) || "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const date = r?.createdAt ? new Date(r.createdAt) : null;
  if (date && !Number.isNaN(date.getTime())) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  return "tarihsiz";
}

function requestMonthLabel(key) {
  if (key === "tarihsiz") return "Tarihsiz Talepler";
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}

function groupRequestsByMonth(list) {
  const map = new Map();
  for (const item of list || []) {
    const key = requestMonthKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === "tarihsiz") return 1;
      if (b === "tarihsiz") return -1;
      return b.localeCompare(a);
    })
    .map(([key, rows]) => ({
      key,
      label: requestMonthLabel(key),
      rows: rows.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
      pending: rows.filter((r) => r.status === "pending").length,
    }));
}

export default function RequestsManagementTab() {
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [error, setError] = useState("");
  const [noteFor, setNoteFor] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [processing, setProcessing] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (signal) => {
    setLoading(true);
    try {
      setError("");
      const res = await getMyRequests();
      if (signal?.aborted) return;
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      if (!signal?.aborted) setError(e?.message || "Talepler alınamadı");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const filtered = useMemo(() => {
    return (items || []).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (serviceFilter !== "all" && !(r.serviceId || "").toLowerCase().includes(serviceFilter.toLowerCase())) return false;
      return true;
    });
  }, [items, statusFilter, typeFilter, serviceFilter]);

  const grouped = useMemo(() => groupRequestsByMonth(filtered), [filtered]);

  const approve = async (r) => {
    const id = r._id || r.id;
    if (processing) return;
    setProcessing(id);
    try {
      setError("");
      await updateRequest(id, { status: "approved", adminNote: "" });
      // İzin talebi onaylandıysa leaves cache'ini tazele:
      // 1) Backend'den yeni veriyi çek  2) MonthlyLeavesMatrixGeneric'e leaves:changed ilet
      if ((r.type || "") === "izin") {
        loadLeavesFromBackend()
          .then(() => emitLeavesChanged())
          .catch(() => {});
      }
      await load();
    } catch (e) {
      setError(e?.message || "Onaylanamadı");
    } finally {
      setProcessing("");
    }
  };

  const reject = async (r) => {
    const id = r._id || r.id;
    if (processing) return;
    setProcessing(id);
    try {
      setError("");
      await updateRequest(id, { status: "rejected", adminNote: noteText });
      setNoteFor(null);
      setNoteText("");
      await load();
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
          <input
            className="h-9 rounded-lg border px-3 text-sm w-36 focus:outline-none"
            placeholder="Servis filtre..."
            value={serviceFilter === "all" ? "" : serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value || "all")}
          />
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="p-4 text-center text-sm text-slate-500">Yükleniyor…</div>
      )}

      {!loading && filtered.length === 0 ? (
        <div className="p-4 rounded-lg border text-sm text-slate-600">Talep bulunamadı.</div>
      ) : !loading && (
        <div className="space-y-5">
          {grouped.map((group) => (
            <section key={group.key} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                <div>
                  <div className="text-[13px] font-semibold text-slate-900">{group.label}</div>
                  <div className="text-[11px] text-slate-500">{group.rows.length} talep</div>
                </div>
                {group.pending > 0 && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                    {group.pending} beklemede
                  </span>
                )}
              </div>
              <div className="grid gap-3">
                {group.rows.map((r) => (
                  <div key={r._id || r.id} className="rounded-xl border bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-slate-600">
                        {r.fromName || "-"} • {r.serviceId || "-"} • {r.targetDate
                          ? (r.targetDateEnd && r.targetDateEnd !== r.targetDate
                            ? `${r.targetDate} → ${r.targetDateEnd}`
                            : r.targetDate)
                          : "-"}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] ${statusTone[r.status] || "bg-slate-100 text-slate-700"}`}>
                        {r.status === "approved" ? "Onaylandı" : r.status === "rejected" ? "Reddedildi" : "Beklemede"}
                      </span>
                    </div>
                    <div className="mt-2 text-[13px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{typeLabels[r.type] || r.type}</span>
                        {r.type === "takas" && r.peerStatus && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${peerTone[r.peerStatus] || ""}`}>
                            {peerLabel[r.peerStatus] || r.peerStatus}
                          </span>
                        )}
                      </div>
                      {r.type === "takas" && (r.swapMyDate || r.swapTargetDate) && (
                        <div className="mt-1 text-[11px] text-slate-500 bg-slate-50 rounded p-2">
                          <span className="font-medium">{r.fromName}</span>:{" "}
                          {r.swapMyDate} {r.swapMyShiftLabel || r.swapMyShiftId}
                          {" ↔ "}
                          <span className="font-medium">{r.swapWithPersonName || "?"}</span>:{" "}
                          {r.swapTargetDate} {r.swapTargetShiftLabel || r.swapTargetShiftId}
                        </div>
                      )}
                      <div className="text-slate-600 mt-1">{r.message}</div>
                      {r.adminNote ? (
                        <div className="mt-2 text-[12px] text-slate-500">Not: {r.adminNote}</div>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        disabled={processing === (r._id || r.id)}
                        className="text-[12px] px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-60"
                        onClick={() => approve(r)}
                      >
                        {processing === (r._id || r.id) ? "…" : "Onayla"}
                      </button>
                      <button
                        disabled={processing === (r._id || r.id)}
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
                            disabled={processing === (r._id || r.id)}
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
