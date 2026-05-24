// src/pages/OccupancyReportPage.jsx
import React, { useState } from "react";
import { toast } from "sonner";
import { BarChart2, RefreshCw, Users, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { http } from "../lib/api.js";

const MONTH_NAMES = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

function DiffBadge({ diff }) {
  if (diff == null || isNaN(diff)) return <span className="text-slate-400">—</span>;
  if (diff > 0) return (
    <span className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold tabular-nums">
      <TrendingUp className="h-3.5 w-3.5" />+{diff}s
    </span>
  );
  if (diff < 0) return (
    <span className="inline-flex items-center gap-0.5 text-rose-600 font-semibold tabular-nums">
      <TrendingDown className="h-3.5 w-3.5" />{diff}s
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-slate-500 tabular-nums">
      <Minus className="h-3.5 w-3.5" />0s
    </span>
  );
}

export default function OccupancyReportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [targetHours, setTargetHours] = useState(160);
  const [tab, setTab] = useState("performance"); // "performance" | "occupancy"
  const [loading, setLoading] = useState(false);

  const [perfResult, setPerfResult] = useState(null);
  const [occResult, setOccResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      if (tab === "performance") {
        const data = await http.get(
          `/api/reports/staff-performance?year=${year}&month=${month}&targetHours=${targetHours}`
        );
        setPerfResult(data);
      } else {
        const data = await http.get(
          `/api/reports/occupancy?year=${year}&month=${month}`
        );
        setOccResult(data);
      }
    } catch (err) {
      toast.error(err?.message || "Rapor yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  const perfRows = perfResult?.data || [];
  const occRows  = occResult?.data || [];
  const maxOccAssignments = occRows.length > 0
    ? Math.max(...occRows.map((r) => r.totalAssignments || 0))
    : 1;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            <BarChart2 className="h-3.5 w-3.5 text-sky-700" />
            Raporlama
          </span>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Personel Nöbet Performansı</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 max-w-2xl">
          Seçili ay için personel bazında toplam nöbet, çalışma saati ve hedef saat farkı analizi.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {[
          { key: "performance", label: "Personel Performansı", icon: Users },
          { key: "occupancy",   label: "Servis Doluluk",       icon: BarChart2 },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Yıl</label>
            <input
              type="number" min="2020" max="2099" value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Ay</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-36 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>
          {tab === "performance" && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Hedef Saat / Ay</label>
              <input
                type="number" min="1" max="300" value={targetHours}
                onChange={(e) => setTargetHours(Number(e.target.value))}
                className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>
          )}
          <button
            onClick={load} disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Yükleniyor..." : "Yükle"}
          </button>
        </div>
      </div>

      {/* ── Personel Performans Tablosu ── */}
      {tab === "performance" && perfResult && (
        <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-800">
                {MONTH_NAMES[perfResult.month - 1]} {perfResult.year} — {perfRows.length} personel
              </span>
            </div>
            <span className="text-xs text-slate-500">
              Hedef: <strong>{perfResult.targetHours} s</strong>
            </span>
          </div>

          {perfRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Users className="h-10 w-10 mb-3 opacity-30" />
              <div className="text-sm">Bu ay için atama verisi bulunamadı</div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Personel</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Servis</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Toplam Nöbet</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Gereken Saat</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Çalışılan Saat</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Hedef Farkı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {perfRows.map((row, i) => {
                    const isOver = row.totalHours > row.targetHours;
                    return (
                    <tr
                      key={row._id || i}
                      className={`transition ${isOver ? "bg-rose-50/40 hover:bg-rose-50" : "bg-emerald-50/30 hover:bg-emerald-50/60"}`}
                    >
                      <td className="px-4 py-2.5 tabular-nums text-slate-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{row.personName || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{row.serviceId || "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-700">{row.totalShifts}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{row.targetHours}s</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={`font-semibold ${isOver ? "text-rose-600" : "text-emerald-600"}`}>
                          {row.totalHours}s
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DiffBadge diff={row.targetDiff} />
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                    <td colSpan={3} className="px-4 py-2.5 text-xs text-slate-600">Toplam / Ortalama</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">
                      {perfRows.reduce((s, r) => s + (r.totalShifts || 0), 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{targetHours}s</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">
                      {perfRows.length > 0
                        ? Math.round(perfRows.reduce((s, r) => s + (r.totalHours || 0), 0) / perfRows.length)
                        : 0}s ort.
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Servis Doluluk (legacy) ── */}
      {tab === "occupancy" && occResult && (
        <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <BarChart2 className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-800">
              {MONTH_NAMES[occResult.month - 1]} {occResult.year} — {occRows.length} servis
            </span>
          </div>

          {occRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <BarChart2 className="h-10 w-10 mb-3 opacity-30" />
              <div className="text-sm">Bu ay için atama verisi bulunamadı</div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Atama Dağılımı</div>
                {occRows.map((row, i) => {
                  const pct = maxOccAssignments > 0
                    ? Math.round((row.totalAssignments / maxOccAssignments) * 100)
                    : 0;
                  return (
                    <div key={row._id || i} className="flex items-center gap-3">
                      <div className="w-32 shrink-0 truncate text-xs text-slate-600 font-medium text-right">
                        {row.serviceId || "(boş)"}
                      </div>
                      <div className="flex-1 rounded-full bg-slate-100 h-5 overflow-hidden">
                        <div className="h-full rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="w-10 shrink-0 text-xs text-slate-600 tabular-nums text-right">
                        {row.totalAssignments}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Servis ID</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Toplam Atama</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Benzersiz Personel</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Toplam Saat</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Vardiya Sayısı</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {occRows.map((row, i) => (
                      <tr key={row._id || i} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{row.serviceId || "(boş)"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.totalAssignments}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.uniquePersonCount}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.totalHours}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.shiftCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
