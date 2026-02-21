// src/tabs/WorkingHoursTimesheet.jsx
import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

/* === utils === */
import { buildMonthDays } from "../utils/date.js";
import { LS } from "../utils/storage.js";

/* AY/YIL tek kaynak (hook) */
import useActiveYM from "../hooks/useActiveYM.js";

/* === veri adaptörü === */
import { getPeople } from "../lib/dataResolver.js"; // servis bazlı personel

/* -----------------------------------------------------------
   Plan okuma (LS’te farklı anahtar/şemalara toleranslı)
------------------------------------------------------------ */
function normalizePlan(raw) {
  // çıktı: personId -> day(int) -> "M/G/E/N/..."
  const out = {};
  const put = (pid, day, code) => {
    if (!pid || !day || !code) return;
    if (!out[pid]) out[pid] = {};
    out[pid][day] = String(code).trim().toUpperCase();
  };

  if (!raw) return out;

  // A) { [personId]: { "1":"M", "2":"G", ... } }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const looksLikeA = Object.values(raw).some(
      (v) => v && typeof v === "object" && !Array.isArray(v)
    );
    if (looksLikeA) {
      for (const [pid, days] of Object.entries(raw)) {
        for (const [d, code] of Object.entries(days || {})) {
          put(pid, Number(d), code);
        }
      }
      return out;
    }
    // C) { assignments:[{date, personId, code/shift}] }
    if (Array.isArray(raw.assignments)) {
      for (const a of raw.assignments) {
        const day = Number(String(a.date).slice(-2));
        put(a.personId || a.staffId || a.pid, day, a.code || a.shift);
      }
      return out;
    }
  }

  // B) [{ date:"2025-09-07", personId:"..", shift:"M" }, ...]
  if (Array.isArray(raw)) {
    for (const a of raw) {
      const day = Number(String(a.date).slice(-2));
      put(a.personId || a.staffId || a.pid, day, a.code || a.shift);
    }
  }
  return out;
}

function findPlanFor({ ym, serviceId }) {
  // Projendeki muhtemel anahtar adları
  const prefer = [
    `plan:${serviceId}:${ym}`,
    `roster:${serviceId}:${ym}`,
    `assignments:${serviceId}:${ym}`,
    `duties:${serviceId}:${ym}`,
    `schedule:${serviceId}:${ym}`,
  ];
  for (const k of prefer) {
    const v = LS.get(k);
    if (v) return normalizePlan(v);
  }
  // Genel tarama (emniyet kemeri)
  const keys = Object.keys(localStorage)
    .filter((k) => k.includes(ym) && /(plan|roster|assign|duties|schedule)/i.test(k))
    .sort();
  if (keys[0]) return normalizePlan(LS.get(keys[0]));
  return {};
}

/* -----------------------------------------------------------
   Bileşen
------------------------------------------------------------ */
const MONTHS_TR = [
  "", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

export default function WorkingHoursTimesheet({
  serviceId = "hemsire",
  title = "Aylık Çalışma ve Mesai Saatleri Çizelgesi — Hemşireler",
}) {
  /* === 1) Tek kaynaktan yıl–ay === */
  const { ym, setYear, setMonth } = useActiveYM(); // {year, month} 1..12

  const ymStr = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
  const days = useMemo(
    () => buildMonthDays(ym.year, ym.month),
    [ym.year, ym.month]
  );

  /* === 2) Personel === */
  const [people, setPeople] = useState([]);
  useEffect(() => {
    setPeople(getPeople(serviceId) || []);
  }, [serviceId]);

  /* === 3) Satırlar === */
  const [rows, setRows] = useState([]);
  useEffect(() => {
    setRows(
      (people || []).map((p, i) => ({
        order: i + 1,
        personId: p.id || p.tc || p.tckn || p.pid || p.TCKN,
        tckn: p.tc || p.tckn || p.TCKN || "",
        name:
          p.name ||
          p.fullName ||
          p.adSoyad ||
          `${p.ad || ""} ${p.soyad || ""}`.trim(),
        role: p.role || p.unvan || "",
        days: {}, // day -> shift code
      }))
    );
  }, [people]);

  /* === 4) Liste Oluştur → vardiya kodlarını bas === */
  const fillFromPlan = () => {
    const planMap = findPlanFor({ ym: ymStr, serviceId });
    setRows((prev) =>
      prev.map((r) => {
        const per = planMap[r.personId] || {};
        const nextDays = {};
        for (const d of days) nextDays[d.day] = per[d.day] || "-";
        return { ...r, days: nextDays };
      })
    );
  };

  const resetTable = () =>
    setRows((prev) => prev.map((r) => ({ ...r, days: {} })));

  /* === 5) Excel'e Aktar === */
  const exportExcel = () => {
    const header = [
      "sıra no",
      "Ünvan",
      "T.C. Kimlik Numarası",
      "Adı Soyadı",
      ...days.map((d) => d.day),
    ];
    const data = rows.map((r, idx) => [
      idx + 1,
      r.role || "",
      r.tckn || "",
      r.name || "",
      ...days.map((d) => r.days?.[d.day] ?? ""),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${MONTHS_TR[ym.month]} ${ym.year}`);
    XLSX.writeFile(
      wb,
      `Aylik_Calisma_Mesai_${ym.year}_${String(ym.month).padStart(2, "0")}.xlsx`
    );
  };

  return (
    <div className="p-4">
      {/* Üst bar */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>

        <div className="ml-auto flex items-center gap-2">
          {/* Yıl */}
          <select
            className="border rounded px-2 py-1"
            value={ym.year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {Array.from({ length: 7 }).map((_, i) => {
              const y = new Date().getFullYear() - 2 + i;
              return (
                <option key={y} value={y}>
                  {y}
                </option>
              );
            })}
          </select>

          {/* Ay */}
          <select
            className="border rounded px-2 py-1"
            value={ym.month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <option key={i + 1} value={i + 1}>
                {MONTHS_TR[i + 1]}
              </option>
            ))}
          </select>

          <button className="btn btn-primary" onClick={fillFromPlan}>
            Liste Oluştur
          </button>
          <button className="btn" onClick={exportExcel}>
            Excel'e Aktar
          </button>
          <button className="btn btn-danger" onClick={resetTable}>
            Sıfırla
          </button>
        </div>
      </div>

      {/* Tablo */}
      <div className="overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-2 py-2">sıra no</th>
              <th className="px-2 py-2">Ünvan</th>
              <th className="px-2 py-2">T.C. Kimlik Numarası</th>
              <th className="px-2 py-2">Adı Soyadı</th>
              {days.map((d) => (
                <th key={d.day} className="px-2 py-2 text-center">
                  {d.day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-2 py-3 text-center text-gray-500"
                  colSpan={4 + days.length}
                >
                  “Liste Oluştur” ile vardiya kodlarını doldurabilirsiniz.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.personId || idx} className="border-t">
                  <td className="px-2 py-1 text-center">{idx + 1}</td>
                  <td className="px-2 py-1">{r.role || ""}</td>
                  <td className="px-2 py-1">{r.tckn || ""}</td>
                  <td className="px-2 py-1">{r.name || ""}</td>
                  {days.map((d) => (
                    <td key={d.day} className="px-1 py-1">
                      <input
                        className="w-16 text-center border rounded h-8"
                        value={r.days?.[d.day] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value.toUpperCase();
                          setRows((prev) =>
                            prev.map((x) => {
                              if (
                                (x.personId || x.order) !==
                                (r.personId || r.order)
                              )
                                return x;
                              return {
                                ...x,
                                days: { ...x.days, [d.day]: v },
                              };
                            })
                          );
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
