// Çizelgenin yayın durumunu gösterir ve sorumlunun yayınlamasını sağlar.
// Taslak: personel göremez. Yayınlandı: personel görür, bildirim gitmiştir.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getMonthlySchedule, setSchedulePublication } from "../api/apiAdapter.js";

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function SchedulePublishBar({ sectionId, serviceId = "", role = "", year, month, refreshKey }) {
  const [publication, setPublication] = useState(null);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (!sectionId || !year || !month) return;
    try {
      const schedule = await getMonthlySchedule({ sectionId, serviceId, role, year, month });
      setExists(!!schedule);
      setPublication(schedule?.publication || null);
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

  const change = async (publish) => {
    if (busyRef.current) return;
    if (publish && !window.confirm(`${month}/${year} çizelgesi yayınlansın mı?\nPersonel çizelgeyi görecek ve bildirim alacak.`)) return;
    if (!publish && !window.confirm("Çizelge taslağa alınsın mı?\nPersonel artık bu ayı göremeyecek.")) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await setSchedulePublication({ sectionId, serviceId, role, year, month }, publish);
      setPublication(res?.publication || null);
      if (publish) {
        toast.success("Çizelge yayınlandı", {
          description: `${Number(res?.notified || 0)} personele bildirim gönderildi.`,
        });
      } else {
        toast.success("Çizelge taslağa alındı");
      }
    } catch (e) {
      toast.error(publish ? "Çizelge yayınlanamadı" : "Taslağa alınamadı", { description: e?.message || "" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (!exists) return null;
  const isDraft = publication?.status === "draft";

  return (
    <div
      data-testid="schedule-publish-bar"
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2 text-sm ${
        isDraft ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"
      }`}
    >
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
          disabled={busy}
          onClick={() => change(true)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-white disabled:opacity-60"
        >
          {busy ? "Yayınlanıyor…" : "Yayınla"}
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
  );
}
