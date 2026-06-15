// src/tabs/MyRequestsTab.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, X, Clock, CheckCircle, XCircle, Trash2, ArrowLeftRight, User } from "lucide-react";
import { createRequest, getMyRequests } from "../api/apiAdapter.js";
import { http } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.jsx";

const TYPE_LABELS = { izin: "İzin", takas: "Takas", tercih: "Tercih", diger: "Diğer" };

const STATUS_META = {
  pending:  { label: "Beklemede",  cls: "bg-amber-100 text-amber-800",    icon: Clock },
  approved: { label: "Onaylandı",  cls: "bg-emerald-100 text-emerald-800", icon: CheckCircle },
  rejected: { label: "Reddedildi", cls: "bg-rose-100 text-rose-800",      icon: XCircle },
};

const PEER_META = {
  pending:  { label: "Yanıt bekleniyor",   cls: "bg-amber-50 text-amber-700 border border-amber-200" },
  accepted: { label: "Karşı taraf onayladı", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  rejected: { label: "Karşı taraf reddetti", cls: "bg-rose-50 text-rose-700 border border-rose-200" },
};

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent";
const labelCls = "text-[12px] font-medium text-slate-600";

const EMPTY_FORM = {
  type: "izin",
  targetDate: "",
  targetDateEnd: "",
  message: "",
  swapWithPersonId: "",
  swapWithPersonName: "",
  swapMyDate: "",
  swapMyAssignment: null,
  swapMyShiftId: "",
  swapMyShiftLabel: "",
  swapTargetDate: "",
  swapTargetAssignment: null,
  swapTargetShiftId: "",
  swapTargetShiftLabel: "",
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, cls: "bg-slate-100 text-slate-600", icon: Clock };
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${m.cls}`}>
      <Icon size={10} /> {m.label}
    </span>
  );
}

function PeerBadge({ peerStatus }) {
  const m = PEER_META[peerStatus];
  if (!m) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${m.cls}`}>
      <ArrowLeftRight size={9} /> {m.label}
    </span>
  );
}

function requestMonthKey(r) {
  const raw = String(r?.targetDate || r?.swapMyDate || r?.swapTargetDate || r?.createdAt || "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const d = r?.createdAt ? new Date(r.createdAt) : null;
  if (d && !Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return "tarihsiz";
}

function requestMonthLabel(key) {
  if (key === "tarihsiz") return "Tarihsiz Talepler";
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}

function groupByMonth(list) {
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

// Bir kişinin belirli tarihteki vardiyalarını çeken dropdown
function ShiftPicker({ date, personId, value, onChange, placeholder = "Vardiya seçin…" }) {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!date) { setShifts([]); return; }
    setLoading(true);
    const params = new URLSearchParams({ date });
    if (personId) params.set("personId", personId);
    http.get(`/api/requests/swap-shifts?${params}`)
      .then((res) => setShifts(Array.isArray(res?.items) ? res.items : []))
      .catch(() => setShifts([]))
      .finally(() => setLoading(false));
  }, [date, personId]);

  if (!date) return null;
  if (loading) return <div className="text-[11px] text-slate-400 py-1">Vardiyalar yükleniyor…</div>;
  if (shifts.length === 0) return (
    <div className="text-[11px] text-amber-600 py-1">
      Bu tarihte seçilebilecek doğrulanmış vardiya bulunamadı.
    </div>
  );

  return (
    <div className="space-y-1">
      <select
        className={inputCls}
        value={value}
        onChange={(e) => {
          const selected = shifts.find((shift) => String(shift._id) === e.target.value) || null;
          onChange(selected);
        }}
      >
        <option value="">{placeholder}</option>
        {shifts.map((s) => {
          const id = String(s._id);
          const label = [s.roleLabel, s.shiftCode || s.shiftId, s.role].filter(Boolean).join(" · ");
          return <option key={id} value={id}>{label || "Vardiya"}</option>;
        })}
      </select>
    </div>
  );
}

// Person autocomplete dropdown
function PersonSearch({ value, personnel, onSelect }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return personnel.slice(0, 10);
    const q = query.trim().toLowerCase();
    return personnel.filter((p) => (p.name || "").toLowerCase().includes(q)).slice(0, 10);
  }, [query, personnel]);

  useEffect(() => { setQuery(value || ""); }, [value]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        className={inputCls}
        placeholder="Kişi adı ile ara..."
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onSelect("", ""); }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white rounded-lg border border-slate-200 shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((p) => (
            <button
              key={p._id || p.id}
              type="button"
              className="w-full text-left px-3 py-2 text-[12px] hover:bg-sky-50 flex items-center gap-2"
              onMouseDown={(e) => { e.preventDefault(); onSelect(p._id || p.id, p.name || ""); setQuery(p.name || ""); setOpen(false); }}
            >
              <User size={11} className="text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700">{p.name}</span>
              {p.serviceId && <span className="text-slate-400 text-[10px] ml-auto">{p.serviceId}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IncomingSwapCard({ r, responding, onAccept, onReject }) {
  const isResponded = r.peerStatus !== "pending";
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-700">{r.fromName || "Bilinmeyen"} takas talep ediyor</span>
          <StatusBadge status={r.status} />
          {r.peerStatus && <PeerBadge peerStatus={r.peerStatus} />}
        </div>
        <div className="text-[12px] text-slate-600 bg-slate-50 rounded-lg p-2 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-slate-400 font-medium mb-0.5">Onların nöbeti (sana gelecek)</div>
            <div>{r.swapMyDate} {r.swapMyShiftLabel || r.swapMyShiftId}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 font-medium mb-0.5">Senin nöbetin (onlara gidecek)</div>
            <div>{r.swapTargetDate} {r.swapTargetShiftLabel || r.swapTargetShiftId}</div>
          </div>
        </div>
        {r.message && <div className="text-[11px] text-slate-500 italic">"{r.message}"</div>}
        {!isResponded && r.status === "pending" && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onAccept(r._id || r.id)}
              disabled={!!responding}
              className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-medium hover:bg-emerald-700 disabled:opacity-60"
            >
              {responding === (r._id || r.id) ? "İşleniyor…" : "Kabul Et"}
            </button>
            <button
              onClick={() => onReject(r._id || r.id)}
              disabled={!!responding}
              className="flex-1 py-2 rounded-lg bg-rose-100 text-rose-700 text-[12px] font-medium hover:bg-rose-200 disabled:opacity-60"
            >
              Reddet
            </button>
          </div>
        )}
        {isResponded && (
          <div className="text-[11px] text-slate-400">
            {r.peerStatus === "accepted" ? "Onayladınız — yönetici onayı bekleniyor" : "Reddettiniz"}
            {r.peerNote ? ` — Not: ${r.peerNote}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MyRequestsTab() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState("");
  const [responding, setResponding] = useState("");
  const [filter, setFilter] = useState("all");
  const [personnel, setPersonnel] = useState([]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyRequests();
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      toast.error(e?.message || "Talepler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Lazy-load personnel only when takas modal opens
  useEffect(() => {
    if (open && form.type === "takas" && personnel.length === 0) {
      http.get("/api/personnel?size=500&page=1").then((res) => {
        setPersonnel(Array.isArray(res?.items) ? res.items : []);
      }).catch(() => {});
    }
  }, [open, form.type, personnel.length]);

  // Outgoing: requests I created / Incoming: takas requests targeting me
  const { outgoing, incoming } = useMemo(() => {
    const uid = String(user?._id || "");
    return {
      outgoing: items.filter((r) => String(r.fromUserId || "") === uid),
      incoming: items.filter((r) => String(r.fromUserId || "") !== uid && r.type === "takas"),
    };
  }, [items, user?._id]);

  const filteredOutgoing = useMemo(() => {
    if (filter === "all") return outgoing;
    return outgoing.filter((r) => r.status === filter);
  }, [outgoing, filter]);

  const grouped = useMemo(() => groupByMonth(filteredOutgoing), [filteredOutgoing]);

  const submit = async () => {
    if (!form.message.trim()) { toast.error("Mesaj zorunludur"); return; }
    if (form.type === "izin" && !form.targetDate) { toast.error("İzin başlangıç tarihi zorunludur"); return; }
    if (form.type === "takas") {
      if (!form.swapWithPersonId)  { toast.error("Takas yapılacak kişiyi seçin"); return; }
      if (!form.swapMyDate)        { toast.error("Kendi tarihini girin"); return; }
      if (!form.swapMyAssignment?._id) { toast.error("Kendi vardiyanızı listeden seçin"); return; }
      if (!form.swapTargetDate)    { toast.error("Karşı tarih tarihini girin"); return; }
      if (!form.swapTargetAssignment?._id) { toast.error("Karşı vardiyayı listeden seçin"); return; }
    }

    setSubmitting(true);
    try {
      const payload = {
        type: form.type,
        message: form.message.trim(),
        targetDate: form.targetDate || "",
        targetDateEnd: form.targetDateEnd || "",
      };
      if (form.type === "takas") {
        Object.assign(payload, {
          swapWithPersonId:     form.swapWithPersonId,
          swapWithPersonName:   form.swapWithPersonName,
          swapMyAssignmentId:   form.swapMyAssignment._id,
          swapTargetAssignmentId: form.swapTargetAssignment._id,
          swapMyDate:           form.swapMyDate,
          swapMyShiftId:        form.swapMyShiftId,
          swapMyShiftLabel:     form.swapMyShiftLabel,
          swapTargetDate:       form.swapTargetDate,
          swapTargetShiftId:    form.swapTargetShiftId,
          swapTargetShiftLabel: form.swapTargetShiftLabel,
        });
        payload.targetDate = form.swapMyDate;
      }
      await createRequest(payload);
      toast.success("Talebiniz gönderildi");
      setOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      toast.error(e?.message || "Talep gönderilemedi");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async (id) => {
    if (!window.confirm("Bu talebi iptal etmek istediğinizden emin misiniz?")) return;
    setCancelling(id);
    try {
      await http.delete(`/api/requests/${id}`);
      toast.success("Talep iptal edildi");
      load();
    } catch (e) {
      toast.error(e?.message || "Talep iptal edilemedi");
    } finally {
      setCancelling("");
    }
  };

  const respondToSwap = async (id, accepted, note = "") => {
    setResponding(id);
    try {
      await http.post(`/api/requests/${id}/peer-response`, { accepted, note });
      toast.success(accepted ? "Takas talebini onayladınız" : "Takas talebini reddettiniz");
      load();
    } catch (e) {
      toast.error(e?.message || "İşlem başarısız");
    } finally {
      setResponding("");
    }
  };

  const openModal = () => { setForm(EMPTY_FORM); setOpen(true); };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-semibold text-[15px] text-slate-800">Taleplerim</div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-lg border px-3 text-[12px] focus:outline-none"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Tümü</option>
            <option value="pending">Beklemede</option>
            <option value="approved">Onaylandı</option>
            <option value="rejected">Reddedildi</option>
          </select>
          <button
            onClick={openModal}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 text-white text-[13px] hover:bg-sky-700"
          >
            <Plus size={14} /> Yeni Talep
          </button>
        </div>
      </div>

      {/* Incoming swap requests */}
      {incoming.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={15} className="text-amber-600" />
            <div className="font-semibold text-[13px] text-amber-800">Gelen Takas Talepleri</div>
            <span className="ml-auto rounded-full bg-amber-200 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
              {incoming.length}
            </span>
          </div>
          {incoming.map((r) => (
            <IncomingSwapCard
              key={r._id || r.id}
              r={r}
              responding={responding}
              onAccept={(id) => respondToSwap(id, true)}
              onReject={(id) => {
                const note = window.prompt("Ret nedeninizi belirtin (isteğe bağlı):", "") ?? "";
                respondToSwap(id, false, note);
              }}
            />
          ))}
        </section>
      )}

      {/* My outgoing requests */}
      {loading && <div className="py-8 text-center text-[13px] text-slate-400">Yükleniyor…</div>}

      {!loading && filteredOutgoing.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
          <div className="text-[14px] font-medium text-slate-500 mb-1">
            {filter === "all" ? "Henüz talep göndermediniz" : "Bu durumda talep yok"}
          </div>
          <div className="text-[12px] text-slate-400">
            İzin, takas veya tercih talebi oluşturmak için "Yeni Talep" butonunu kullanın.
          </div>
        </div>
      )}

      {!loading && filteredOutgoing.length > 0 && (
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
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-slate-700">
                            {TYPE_LABELS[r.type] || r.type}
                          </span>
                          <StatusBadge status={r.status} />
                          {r.type === "takas" && r.peerStatus && <PeerBadge peerStatus={r.peerStatus} />}
                        </div>
                        {r.type === "takas" && (r.swapMyDate || r.swapTargetDate) && (
                          <div className="text-[11px] text-slate-500">
                            {r.swapMyDate} {r.swapMyShiftLabel || r.swapMyShiftId}
                            {" ↔ "}
                            {r.swapWithPersonName || "?"} — {r.swapTargetDate}{" "}
                            {r.swapTargetShiftLabel || r.swapTargetShiftId}
                          </div>
                        )}
                        {r.type !== "takas" && r.targetDate && (
                          <div className="text-[11px] text-slate-400">
                            {r.targetDate}
                            {r.targetDateEnd && r.targetDateEnd !== r.targetDate ? ` → ${r.targetDateEnd}` : ""}
                          </div>
                        )}
                        <div className="text-[12px] text-slate-600">{r.message}</div>
                        {r.status === "rejected" && r.adminNote && (
                          <div className="mt-1 text-[11px] text-rose-600 bg-rose-50 rounded px-2 py-1">
                            Ret nedeni: {r.adminNote}
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400">
                          {r.createdAt ? new Date(r.createdAt).toLocaleDateString("tr-TR") : ""}
                        </div>
                      </div>
                      {r.status === "pending" && (
                        <button
                          onClick={() => cancelRequest(r._id || r.id)}
                          disabled={cancelling === (r._id || r.id)}
                          className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500 disabled:opacity-40 shrink-0"
                          title="Talebi iptal et"
                          aria-label="Talebi iptal et"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* New request modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="font-semibold text-slate-800">Yeni Talep</div>
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Kapat">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Tür */}
              <div className="space-y-1">
                <label className={labelCls}>Talep Türü <span className="text-rose-500">*</span></label>
                <select className={inputCls} value={form.type} onChange={(e) => set("type", e.target.value)}>
                  <option value="izin">İzin</option>
                  <option value="takas">Takas</option>
                  <option value="tercih">Tercih</option>
                  <option value="diger">Diğer</option>
                </select>
              </div>

              {/* İzin: tarih aralığı */}
              {form.type === "izin" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className={labelCls}>Başlangıç <span className="text-rose-500">*</span></label>
                    <input type="date" className={inputCls} value={form.targetDate} onChange={(e) => set("targetDate", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>Bitiş (isteğe bağlı)</label>
                    <input type="date" className={inputCls} value={form.targetDateEnd} onChange={(e) => set("targetDateEnd", e.target.value)} min={form.targetDate} />
                  </div>
                </div>
              )}

              {/* Takas: detaylar */}
              {form.type === "takas" && (
                <div className="space-y-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[12px] font-semibold text-slate-600">Takas Detayları</div>

                  <div className="space-y-1">
                    <label className={labelCls}>Takas Yapılacak Kişi <span className="text-rose-500">*</span></label>
                    <PersonSearch
                      value={form.swapWithPersonName}
                      personnel={personnel}
                      onSelect={(id, name) => setForm((f) => ({
                        ...f,
                        swapWithPersonId: id,
                        swapWithPersonName: name,
                        swapTargetAssignment: null,
                        swapTargetShiftId: "",
                        swapTargetShiftLabel: "",
                      }))}
                    />
                    {personnel.length === 0 && (
                      <p className="text-[11px] text-slate-400">Personel listesi yükleniyor…</p>
                    )}
                  </div>

                  {/* Benim vardiyam */}
                  <div className="space-y-1">
                    <label className={labelCls}>Benim Tarihim <span className="text-rose-500">*</span></label>
                    <input
                      type="date" className={inputCls} value={form.swapMyDate}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        swapMyDate: e.target.value,
                        swapMyAssignment: null,
                        swapMyShiftId: "",
                        swapMyShiftLabel: "",
                      }))}
                    />
                  </div>
                  {form.swapMyDate && (
                    <div className="space-y-1">
                      <label className={labelCls}>Benim Vardiyam <span className="text-rose-500">*</span></label>
                      <ShiftPicker
                        date={form.swapMyDate}
                        personId={null}
                        value={form.swapMyAssignment?._id || ""}
                        onChange={(assignment) => setForm((f) => ({
                          ...f,
                          swapMyAssignment: assignment,
                          swapMyShiftId: assignment?.shiftId || assignment?.shiftCode || assignment?.rowId || "",
                          swapMyShiftLabel: assignment?.roleLabel || assignment?.shiftCode || assignment?.shiftId || "",
                        }))}
                        placeholder="Kendi vardiyamı seçin…"
                      />
                    </div>
                  )}

                  {/* Karşı tarafın vardiyası */}
                  <div className="space-y-1">
                    <label className={labelCls}>Karşı Tarih <span className="text-rose-500">*</span></label>
                    <input
                      type="date" className={inputCls} value={form.swapTargetDate}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        swapTargetDate: e.target.value,
                        swapTargetAssignment: null,
                        swapTargetShiftId: "",
                        swapTargetShiftLabel: "",
                      }))}
                    />
                  </div>
                  {form.swapTargetDate && form.swapWithPersonId && (
                    <div className="space-y-1">
                      <label className={labelCls}>Karşı Vardiya <span className="text-rose-500">*</span></label>
                      <ShiftPicker
                        date={form.swapTargetDate}
                        personId={form.swapWithPersonId}
                        value={form.swapTargetAssignment?._id || ""}
                        onChange={(assignment) => setForm((f) => ({
                          ...f,
                          swapTargetAssignment: assignment,
                          swapTargetShiftId: assignment?.shiftId || assignment?.shiftCode || assignment?.rowId || "",
                          swapTargetShiftLabel: assignment?.roleLabel || assignment?.shiftCode || assignment?.shiftId || "",
                        }))}
                        placeholder="Karşı tarafın vardiyasını seçin…"
                      />
                    </div>
                  )}
                  {form.swapTargetDate && !form.swapWithPersonId && (
                    <div className="text-[11px] text-slate-400">Karşı tarafın vardiyasını görmek için önce kişiyi seçin.</div>
                  )}
                </div>
              )}

              {/* Diğer / Tercih: tek tarih */}
              {(form.type === "tercih" || form.type === "diger") && (
                <div className="space-y-1">
                  <label className={labelCls}>Tarih (isteğe bağlı)</label>
                  <input type="date" className={inputCls} value={form.targetDate} onChange={(e) => set("targetDate", e.target.value)} />
                </div>
              )}

              {/* Mesaj */}
              <div className="space-y-1">
                <label className={labelCls}>Açıklama <span className="text-rose-500">*</span></label>
                <textarea
                  rows={3}
                  className={inputCls}
                  placeholder="Talebinizi açıklayın..."
                  value={form.message}
                  onChange={(e) => set("message", e.target.value)}
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border text-[13px] text-slate-600 hover:bg-slate-50">
                Vazgeç
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-sky-600 text-white text-[13px] font-medium hover:bg-sky-700 disabled:opacity-60"
              >
                {submitting ? "Gönderiliyor…" : "Gönder"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
