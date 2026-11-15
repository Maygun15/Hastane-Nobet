// Çizelgenin yayın durumu + yayın öncesi risk kararları.
// Taslak: personel göremez. Yayınlandı: personel görür, bildirim gitmiştir.
// Hastane kararı (2026-11-16): boş slot ve riskli atamalar için yönetici her
// biri adına "Yerine ata" ya da "Bu şekilde devam" der; karara bağlanmamış risk
// varken yayınlanamaz.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ackScheduleRisks,
  assignSchedule,
  getMonthlySchedule,
  getScheduleRisks,
  getSlotCandidates,
  setSchedulePublication,
} from "../api/apiAdapter.js";

const TYPE_LABEL = {
  BOS_SLOT: "Boş görev",
  KURAL: "Kural riski",
  TERCIH: "Tercih çelişkisi",
  VERI_EKSIGI: "Personel verisi eksik",
};
const COLLAPSED_COUNT = 8;

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Boş görev için aday listesi + atama.
function SlotAssignDialog({ scope, risk, onClose, onAssigned }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    getSlotCandidates(scope, { date: risk.date, rowId: risk.rowId })
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setError(e?.message || "Adaylar alınamadı"); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risk.key]);

  const assign = async (c) => {
    if (savingRef.current) return;
    const base = {
      ...scope, date: risk.date, rowId: risk.rowId, shiftId: risk.rowId, shiftCode: data?.slot?.shiftCode || risk.shiftCode,
      personId: c.personId, personName: c.personName, roleLabel: data?.slot?.area || "",
    };
    if (!c.eligible && !window.confirm(`${c.personName} bu görev için riskli:\n• ${c.reasons.join("\n• ")}\n\nYine de atansın mı? (Yönetici onayı olarak kaydedilir.)`)) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await assignSchedule(c.eligible ? base : { ...base, force: true, overrideReason: `Risk paneli: yönetici onayı (${c.reasons.join(", ")})` });
      if (!c.eligible) {
        // "Yine de ata" zaten yönetici kararı: bu atamanın doğurduğu riskleri aynı gerekçeyle kapat.
        const after = await getScheduleRisks(scope).catch(() => null);
        const keys = (after?.risks || [])
          .filter((r) => !r.acknowledged && r.personId === c.personId && r.date === risk.date && (r.type === "KURAL" || r.type === "TERCIH"))
          .map((r) => r.key);
        if (keys.length) await ackScheduleRisks(scope, keys, `"Yine de ata" ile onaylandı: ${c.reasons.join(", ")}`);
      }
      toast.success(`${c.personName} atandı`);
      onAssigned?.();
      onClose();
    } catch (e) {
      toast.error("Atama yapılamadı", { description: e?.message || "" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const list = (data?.candidates || []).filter((c) => showAll || c.eligible);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-label="Boş göreve ata">
      <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-4 text-slate-800 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold">Boş göreve ata</div>
            <div className="text-[12px] text-slate-500">{risk.message}</div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500" aria-label="Kapat">✕</button>
        </div>
        {error && <div className="mt-3 text-[13px] text-rose-700">{error}</div>}
        {!data && !error && <div className="mt-3 text-[13px] text-slate-500">Adaylar hesaplanıyor…</div>}
        {data && (
          <>
            <div className="mt-3 text-[12px] text-slate-500">
              Uygun aday: {(data.candidates || []).filter((c) => c.eligible).length}. Ay saati ve gece sayısı az olan önce.
            </div>
            <ul className="mt-2 divide-y divide-slate-100" data-testid="slot-candidates">
              {list.map((c) => (
                <li key={c.personId} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{c.personName}</div>
                    <div className="text-[11px] text-slate-500">
                      {c.monthHours} saat · {c.monthNights} gece
                      {c.softPreference ? " · bekleyen tercihi var" : ""}
                      {!c.eligible ? ` · ${c.reasons.join(", ")}` : ""}
                    </div>
                  </div>
                  <button type="button" disabled={saving} onClick={() => assign(c)}
                    className={`rounded-lg px-2.5 py-1 text-[12px] disabled:opacity-60 ${c.eligible ? "bg-emerald-600 text-white" : "border border-rose-300 text-rose-700"}`}>
                    {c.eligible ? "Ata" : "Yine de ata"}
                  </button>
                </li>
              ))}
              {!list.length && <li className="py-2 text-[13px] text-slate-500">Uygun aday yok.</li>}
            </ul>
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[12px] text-sky-700">
              {showAll ? "Sadece uygunları göster" : "Uygun olmayanları da göster"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Mevcut atama için: hızlı değiştirme penceresini o kişiyle aç.
function openReplace(risk) {
  window.dispatchEvent(new CustomEvent("quick-replace:open", {
    detail: {
      date: risk.date,
      shiftId: String(risk.rowId || ""),
      rowId: String(risk.rowId || ""),
      shiftCode: String(risk.shiftCode || ""),
      personName: risk.personName || "",
      autoSearch: !!risk.personName,
    },
  }));
}

function RiskRow({ risk, busy, onAck, onFillSlot }) {
  const canReplace = !!risk.date && risk.type !== "VERI_EKSIGI";
  const replace = () => (risk.type === "BOS_SLOT" ? onFillSlot(risk) : openReplace(risk));
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid="risk-row">
      <div className="min-w-0 flex-1">
        <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] ${risk.severity === "yuksek" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
          {TYPE_LABEL[risk.type] || risk.type}
        </span>
        <span className="text-[13px]">{risk.message}</span>
        {risk.acknowledged && (
          <span className="ml-2 text-[11px] text-slate-500">
            ✓ Bu şekilde devam{risk.ack?.byName ? ` — ${risk.ack.byName}` : ""}
          </span>
        )}
        {risk.type === "VERI_EKSIGI" && !risk.acknowledged && (
          <span className="ml-2 text-[11px] text-slate-500">Personel kartından alan / vardiya kodu ekleyin.</span>
        )}
      </div>
      {!risk.acknowledged && (
        <div className="flex gap-1.5">
          {canReplace && (
            <button type="button" disabled={busy} onClick={replace}
              className="rounded-lg border border-sky-300 bg-white px-2.5 py-1 text-[12px] text-sky-700 disabled:opacity-60">
              Yerine ata
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => onAck([risk.key])}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[12px] text-slate-700 disabled:opacity-60">
            Bu şekilde devam
          </button>
        </div>
      )}
    </li>
  );
}

export default function SchedulePublishBar({ sectionId, serviceId = "", role = "", year, month, refreshKey }) {
  const [publication, setPublication] = useState(null);
  const [exists, setExists] = useState(false);
  const [risks, setRisks] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fillRisk, setFillRisk] = useState(null);
  const busyRef = useRef(false);
  const scope = { sectionId, serviceId, role, year, month };

  const load = useCallback(async () => {
    if (!sectionId || !year || !month) return;
    try {
      const schedule = await getMonthlySchedule({ sectionId, serviceId, role, year, month });
      setExists(!!schedule);
      setPublication(schedule?.publication || null);
      if (schedule) {
        const r = await getScheduleRisks({ sectionId, serviceId, role, year, month }).catch(() => null);
        setRisks(Array.isArray(r?.risks) ? r.risks : []);
      } else {
        setRisks([]);
      }
    } catch {
      // Durum okunamazsa çubuğu gizli bırak; düzenleyicinin kendi hata akışı var.
      setExists(false);
    }
  }, [sectionId, serviceId, role, year, month]);

  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener("schedule:saved", handler);
    window.addEventListener("schedule:changed", handler);
    return () => {
      window.removeEventListener("schedule:saved", handler);
      window.removeEventListener("schedule:changed", handler);
    };
  }, [load]);

  const withLock = async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  };

  const ack = (keys) => withLock(async () => {
    try {
      await ackScheduleRisks(scope, keys);
      await load();
    } catch (e) {
      toast.error("Karar kaydedilemedi", { description: e?.message || "" });
    }
  });

  const pendingRisks = risks.filter((r) => !r.acknowledged);
  const isDraft = publication?.status === "draft";

  const ackAll = () => {
    if (!pendingRisks.length) return;
    if (!window.confirm(`${pendingRisks.length} riskin hepsi için "Bu şekilde devam" denilsin mi?\nKarar sizin adınıza kaydedilir.`)) return;
    ack(pendingRisks.map((r) => r.key));
  };

  const change = (publish) => withLock(async () => {
    if (publish && pendingRisks.length) return;
    if (publish && !window.confirm(`${month}/${year} çizelgesi yayınlansın mı?\nPersonel çizelgeyi görecek ve bildirim alacak.`)) return;
    if (!publish && !window.confirm("Çizelge taslağa alınsın mı?\nPersonel artık bu ayı göremeyecek.")) return;
    try {
      const res = await setSchedulePublication(scope, publish);
      setPublication(res?.publication || null);
      if (publish) {
        toast.success("Çizelge yayınlandı", { description: `${Number(res?.notified || 0)} personele bildirim gönderildi.` });
      } else {
        toast.success("Çizelge taslağa alındı");
      }
    } catch (e) {
      toast.error(publish ? "Çizelge yayınlanamadı" : "Taslağa alınamadı", { description: e?.message || "" });
      await load();
    }
  });

  if (!exists) return null;

  const visibleRisks = showAll ? risks : [...pendingRisks, ...risks.filter((r) => r.acknowledged)].slice(0, COLLAPSED_COUNT);

  return (
    <div
      data-testid="schedule-publish-bar"
      className={`rounded-xl border px-4 py-2 text-sm ${
        isDraft ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {isDraft ? (
            <>
              <span className="font-semibold">Taslak</span> — personel bu çizelgeyi henüz göremiyor.
            </>
          ) : (
            <>
              <span className="font-semibold">Yayınlandı</span>
              {publication?.publishedAt ? ` — ${formatDate(publication.publishedAt)}` : ""}
              {publication?.publishedByName ? ` (${publication.publishedByName})` : ""}. Personel görebiliyor.
            </>
          )}
        </div>
        {isDraft ? (
          <button
            type="button"
            disabled={busy || pendingRisks.length > 0}
            title={pendingRisks.length ? "Önce riskler için karar verin" : undefined}
            onClick={() => change(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-white disabled:opacity-50"
          >
            {busy ? "…" : pendingRisks.length ? `Yayınla (${pendingRisks.length} risk karar bekliyor)` : "Yayınla"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => change(false)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-700 disabled:opacity-60"
          >
            {busy ? "…" : "Taslağa al"}
          </button>
        )}
      </div>

      {risks.length > 0 && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800" data-testid="risk-panel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] font-semibold">
              {pendingRisks.length
                ? `Yönetici kararı bekleyen ${pendingRisks.length} risk`
                : `Tüm riskler için karar verildi (${risks.length})`}
            </div>
            {pendingRisks.length > 1 && (
              <button type="button" disabled={busy} onClick={ackAll}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-[12px] text-slate-700 disabled:opacity-60">
                Hepsi için bu şekilde devam
              </button>
            )}
          </div>
          <ul className="mt-1 divide-y divide-slate-100">
            {visibleRisks.map((r) => <RiskRow key={r.key} risk={r} busy={busy} onAck={ack} onFillSlot={setFillRisk} />)}
          </ul>
          {risks.length > COLLAPSED_COUNT && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-[12px] text-sky-700">
              {showAll ? "Daha az göster" : `Tümünü göster (${risks.length})`}
            </button>
          )}
        </div>
      )}
      {fillRisk && (
        <SlotAssignDialog scope={scope} risk={fillRisk} onClose={() => setFillRisk(null)} onAssigned={load} />
      )}
    </div>
  );
}
