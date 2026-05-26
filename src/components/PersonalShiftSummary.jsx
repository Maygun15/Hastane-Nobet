// src/components/PersonalShiftSummary.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMergedScheduleTruth } from "../utils/scheduleTruth.js";
import { fetchHolidayCalendar } from "../api/apiAdapter.js";
import { API } from "../lib/api.js";
import { useAppStore } from "../state/appStore.js";
import { resolvePersonId, resolvePersonRef, canonName } from "../utils/personIdentity.js";

// ── Sabitler ──────────────────────────────────────────────────────────────────

const NIGHT_CODES = new Set(["N", "V1", "V2", "SV", "G", "GECE", "NIGHT"]);
const SHIFT_HOURS_FALLBACK = { N: 24, V2: 24, V1: 16, M: 8, M4: 8 };
const TR_MONTHS = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];

// ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────────

function resolveHours(a) {
  if (a.hours && typeof a.hours === "number" && a.hours > 0) return a.hours;
  const code = String(a.shiftCode || "").toUpperCase();
  return SHIFT_HOURS_FALLBACK[code] ?? 0;
}

function isWeekend(ymd) {
  if (!ymd) return false;
  const d = new Date(String(ymd).slice(0, 10));
  return d.getDay() === 0 || d.getDay() === 6;
}

function fmtTurkishDate(ymd) {
  if (!ymd) return "—";
  const parts = String(ymd).slice(0, 10).split("-").map(Number);
  return `${parts[2]} ${TR_MONTHS[(parts[1] - 1)] ?? ""}`;
}

function resolvePersonFromUser(me, people = []) {
  const found = resolvePersonRef(me, people);
  if (found) return resolvePersonId(found);

  const direct = resolvePersonId(me);
  if (direct) return direct;

  const meCanon = canonName(
    me?.fullName || me?.name || me?.displayName || me?.username || ""
  );
  if (!meCanon) return "";
  const match = people.find((p) => {
    const pCanon = p.canon || canonName(p.fullName || p.name || p.displayName || "");
    return pCanon && pCanon === meCanon;
  });
  return match ? resolvePersonId(match) : "";
}

function getThisWeekHours(mine) {
  const today = new Date();
  const mon = new Date(today);
  mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  mon.setHours(0, 0, 0, 0);
  const nextMon = new Date(mon);
  nextMon.setDate(mon.getDate() + 7);
  return mine
    .filter((a) => {
      const d = new Date(String(a.date || a.day || "").slice(0, 10));
      return d >= mon && d < nextMon;
    })
    .reduce((sum, a) => sum + resolveHours(a), 0);
}

function weekIntensityLabel(h) {
  if (h === 0) return "Nöbet yok";
  if (h <= 16) return "Hafif";
  if (h <= 32) return "Orta";
  return "Yoğun";
}

function monthIntensityLabel(h) {
  if (h <= 120) return "Hafif";
  if (h <= 180) return "Normal";
  if (h <= 240) return "Yoğun";
  return "Çok Yoğun";
}

function getNextShift(mine) {
  const todayYmd = new Date().toISOString().slice(0, 10);
  const future = mine
    .map((a) => ({ a, d: String(a.date || a.day || "").slice(0, 10) }))
    .filter(({ d }) => d > todayYmd)
    .sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  if (!future.length) return null;
  return { dateStr: future[0].d, shiftCode: future[0].a.shiftCode || "" };
}

function getBusiestDay(mine) {
  const byDay = {};
  for (const a of mine) {
    const d = String(a.date || a.day || "").slice(0, 10);
    if (!d) continue;
    byDay[d] = (byDay[d] || 0) + resolveHours(a);
  }
  let maxH = 0;
  let maxDay = null;
  for (const [d, h] of Object.entries(byDay)) {
    if (h > maxH) { maxH = h; maxDay = d; }
  }
  return maxDay ? { dateStr: maxDay, hours: maxH } : null;
}

function computeStats(mine, holidays) {
  const holidaySet = new Set(
    (holidays || []).map((h) => String(h.date || "").slice(0, 10)).filter(Boolean)
  );
  let totalShifts = 0, nightShifts = 0, totalHours = 0, weekendShifts = 0, holidayShifts = 0;

  for (const a of mine) {
    totalShifts++;
    const code = String(a.shiftCode || "").toUpperCase();
    if (NIGHT_CODES.has(code)) nightShifts++;
    totalHours += resolveHours(a);
    const ymd = String(a.date || a.day || "").slice(0, 10);
    if (isWeekend(ymd)) weekendShifts++;
    if (holidaySet.has(ymd)) holidayShifts++;
  }

  return {
    totalShifts,
    nightShifts,
    totalHours,
    weekendShifts,
    holidayShifts,
    thisWeekHours: getThisWeekHours(mine),
    nextShift: getNextShift(mine),
    busiestDay: getBusiestDay(mine),
  };
}

// ── UI bileşenleri ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, colorClass }) {
  return (
    <div className={`rounded-xl p-3 flex flex-col gap-0.5 ${colorClass}`}>
      <div className="text-xs font-medium opacity-70 leading-tight">{label}</div>
      <div className="text-lg font-bold tabular-nums leading-snug">{value}</div>
      {sub && <div className="text-xs opacity-60 leading-tight">{sub}</div>}
    </div>
  );
}

function SkeletonRow({ count, cols }) {
  return (
    <div className={`grid ${cols} gap-3 mb-3`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl bg-slate-100 animate-pulse h-16" />
      ))}
    </div>
  );
}

// ── Ana bileşen ────────────────────────────────────────────────────────────────

export default function PersonalShiftSummary({ me, people = [], year, month }) {
  const activeServiceId = useAppStore((s) => s.activeServiceId);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [gcal, setGcal] = useState({ loading: false, connected: false, lastSyncAt: null });

  // people listesi her render'da taranmasın
  const resolvedId = useMemo(
    () => resolvePersonFromUser(me, people),
    [me, people]
  );

  const meCanon = useMemo(
    () => canonName(me?.fullName || me?.name || me?.displayName || me?.username || ""),
    [me]
  );

  const load = useCallback(async () => {
    if (!resolvedId) return;
    setLoading(true);
    try {
      // Tek çekme — fetchMergedScheduleTruth çoğaltılmıyor
      const [truth, holidays] = await Promise.all([
        fetchMergedScheduleTruth({
          sectionId: "calisma-cizelgesi",
          serviceId: String(me?.serviceId || me?.service || activeServiceId || ""),
          roles: ["", "Nurse", "Doctor", "Hemşire", "Doktor", "Personel"],
          year,
          month,
          options: { preferScheduleReadModel: true },
        }),
        fetchHolidayCalendar({ year, month }).catch(() => []),
      ]);

      const all = truth?.assignments || [];
      const mine = all.filter((a) => {
        const aid = String(a.personId || a.pid || a.staffId || "").trim();
        if (aid && aid === resolvedId) return true;
        // isim fallback
        if (!aid && meCanon) {
          const aCanon = canonName(a.personName || a.fullName || a.name || "");
          return aCanon && aCanon === meCanon;
        }
        return false;
      });

      setStats(computeStats(mine, holidays));
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [resolvedId, meCanon, me, year, month, activeServiceId]);

  // Google Calendar durumu — bağımsız, bir kez mount'ta çekilir
  useEffect(() => {
    let active = true;
    setGcal((s) => ({ ...s, loading: true }));
    API.http
      .get("/api/calendar/google/status")
      .then((data) => {
        if (!active) return;
        setGcal({
          loading: false,
          connected: !!data?.connected,
          lastSyncAt: data?.lastSyncAt || null,
        });
      })
      .catch(() => {
        if (!active) return;
        setGcal({ loading: false, connected: false, lastSyncAt: null });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Kişi çözümlenemiyorsa hiçbir şey gösterme
  if (!resolvedId) return null;

  if (loading) {
    return (
      <>
        <SkeletonRow count={4} cols="grid-cols-2 sm:grid-cols-4" />
        <SkeletonRow count={6} cols="grid-cols-2 sm:grid-cols-3" />
      </>
    );
  }

  if (!stats || stats.totalShifts === 0) {
    return (
      <div className="mb-4 text-sm text-slate-500 text-center py-3 bg-slate-50 rounded-xl border border-slate-200">
        Bu ay nöbet kaydı yok
      </div>
    );
  }

  const {
    totalShifts, nightShifts, totalHours, weekendShifts, holidayShifts,
    thisWeekHours, nextShift, busiestDay,
  } = stats;

  const gcalValue = gcal.loading ? "…" : gcal.connected ? "Bağlı" : "Bağlı Değil";
  const gcalSub = gcal.connected && gcal.lastSyncAt
    ? `Son: ${new Date(gcal.lastSyncAt).toLocaleDateString("tr-TR")}`
    : gcal.connected ? "Senkronize edilmedi" : "Google Takvim";

  return (
    <>
      {/* Mevcut 4 kart — birebir korunur */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <StatCard
          label="Toplam Nöbet"
          value={totalShifts}
          colorClass="bg-blue-50 text-blue-700"
        />
        <StatCard
          label="Gece Nöbeti"
          value={nightShifts}
          colorClass="bg-purple-50 text-purple-700"
        />
        <StatCard
          label="Toplam Saat"
          value={`${totalHours}s`}
          colorClass="bg-green-50 text-green-700"
        />
        <StatCard
          label="Hafta Sonu"
          value={weekendShifts}
          colorClass="bg-orange-50 text-orange-700"
        />
      </div>

      {/* Faz-2: 6 yeni kart */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Sonraki Nöbet"
          value={nextShift ? fmtTurkishDate(nextShift.dateStr) : "—"}
          sub={nextShift?.shiftCode || undefined}
          colorClass="bg-sky-50 text-sky-700"
        />
        <StatCard
          label="Bu Hafta"
          value={`${thisWeekHours}s`}
          sub={weekIntensityLabel(thisWeekHours)}
          colorClass="bg-teal-50 text-teal-700"
        />
        <StatCard
          label="Resmi Tatil"
          value={holidayShifts}
          sub={holidayShifts > 0 ? "nöbet" : "nöbet yok"}
          colorClass="bg-red-50 text-red-700"
        />
        <StatCard
          label="Aylık Yoğunluk"
          value={monthIntensityLabel(totalHours)}
          sub={`${totalHours}s toplam`}
          colorClass="bg-amber-50 text-amber-700"
        />
        <StatCard
          label="En Yoğun Gün"
          value={busiestDay ? fmtTurkishDate(busiestDay.dateStr) : "—"}
          sub={busiestDay ? `${busiestDay.hours}s` : undefined}
          colorClass="bg-rose-50 text-rose-700"
        />
        <StatCard
          label="Google Takvim"
          value={gcalValue}
          sub={gcalSub}
          colorClass={gcal.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500"}
        />
      </div>
    </>
  );
}
