// src/components/PersonalShiftSummary.jsx
import React, { useCallback, useEffect, useState } from "react";
import { fetchMergedScheduleTruth } from "../utils/scheduleTruth.js";
import { useAppStore } from "../state/appStore.js";
import { resolvePersonId, resolvePersonRef, canonName } from "../utils/personIdentity.js";

const NIGHT_CODES = new Set(["N", "V1", "V2", "SV", "G", "GECE", "NIGHT"]);
const SHIFT_HOURS_FALLBACK = { N: 24, V2: 24, V1: 16, M: 8, M4: 8 };

function resolveHours(a) {
  if (a.hours && typeof a.hours === "number" && a.hours > 0) return a.hours;
  const code = String(a.shiftCode || "").toUpperCase();
  return SHIFT_HOURS_FALLBACK[code] ?? 0;
}

function isWeekend(dateStr) {
  if (!dateStr) return false;
  const d = new Date(String(dateStr).slice(0, 10));
  return d.getDay() === 0 || d.getDay() === 6;
}

// Tıpkı PersonScheduleCalendar gibi: user + people listesinden kişi ID'sini çöz.
// Önce direkt ID eşleştirmesi, sonra isim eşleştirmesi.
function resolvePersonFromUser(me, people = []) {
  // 1) resolvePersonRef: id → isim fallback
  const found = resolvePersonRef(me, people);
  if (found) return resolvePersonId(found);

  // 2) Direkt me üzerinden dene (me.id yerine)
  const direct = resolvePersonId(me);
  if (direct) return direct;

  // 3) İsim bazlı: me.name / me.fullName ile people listesinde ara
  const meCanon = canonName(
    me?.fullName || me?.name || me?.displayName || me?.username || ""
  );
  if (!meCanon) return "";
  const match = people.find((p) => {
    const pCanon =
      p.canon ||
      canonName(p.fullName || p.name || p.displayName || "");
    return pCanon && pCanon === meCanon;
  });
  return match ? resolvePersonId(match) : "";
}

function StatCard({ label, value, colorClass }) {
  return (
    <div className={`rounded-xl p-3 flex flex-col gap-1 ${colorClass}`}>
      <div className="text-xs font-medium opacity-70 leading-tight">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export default function PersonalShiftSummary({ me, people = [], year, month }) {
  const activeServiceId = useAppStore((s) => s.activeServiceId);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const resolvedId = resolvePersonFromUser(me, people);
    if (!resolvedId) return;

    setLoading(true);
    try {
      const truth = await fetchMergedScheduleTruth({
        sectionId: "calisma-cizelgesi",
        serviceId: activeServiceId || "",
        roles: ["Nurse", "Doctor"],
        year,
        month,
        options: { preferScheduleReadModel: true },
      });

      const all = truth?.assignments || [];

      // Kişi ID eşleştirmesi (primary), isim eşleştirmesi (fallback)
      const meCanon = canonName(
        me?.fullName || me?.name || me?.displayName || me?.username || ""
      );
      const mine = all.filter((a) => {
        const aid = String(a.personId || a.pid || a.staffId || "").trim();
        if (aid && aid === resolvedId) return true;
        // İsim fallback'i
        if (!aid && meCanon) {
          const aCanon = canonName(a.personName || a.fullName || a.name || "");
          return aCanon && aCanon === meCanon;
        }
        return false;
      });

      let totalShifts = 0;
      let nightShifts = 0;
      let totalHours = 0;
      let weekendShifts = 0;

      for (const a of mine) {
        totalShifts++;
        const code = String(a.shiftCode || "").toUpperCase();
        if (NIGHT_CODES.has(code)) nightShifts++;
        totalHours += resolveHours(a);
        if (isWeekend(a.date || a.day)) weekendShifts++;
      }

      setStats({ totalShifts, nightShifts, totalHours, weekendShifts });
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [me, people, year, month, activeServiceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Kişi çözümlenemiyorsa sessizce gizle
  const resolvedId = resolvePersonFromUser(me, people);
  if (!resolvedId) return null;

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl p-3 bg-slate-100 animate-pulse h-16" />
        ))}
      </div>
    );
  }

  if (!stats || stats.totalShifts === 0) {
    return (
      <div className="mb-4 text-sm text-slate-500 text-center py-3 bg-slate-50 rounded-xl border border-slate-200">
        Bu ay nöbet kaydı yok
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <StatCard
        label="Toplam Nöbet"
        value={stats.totalShifts}
        colorClass="bg-blue-50 text-blue-700"
      />
      <StatCard
        label="Gece Nöbeti"
        value={stats.nightShifts}
        colorClass="bg-purple-50 text-purple-700"
      />
      <StatCard
        label="Toplam Saat"
        value={`${stats.totalHours}s`}
        colorClass="bg-green-50 text-green-700"
      />
      <StatCard
        label="Hafta Sonu"
        value={stats.weekendShifts}
        colorClass="bg-orange-50 text-orange-700"
      />
    </div>
  );
}
