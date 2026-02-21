// src/tabs/PersonCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { ymKey } from "../utils/storage.js";
import { getAllLeaves, upsertLeave, removeLeave } from "../lib/leaves.js";

/* === Son kullanılan kod (MonthlyLeavesMatrix ile ortak) === */
const LAST_CODE_KEY = "lastLeaveCodeV1";
const readLastCode = (fallback = "Y") => {
  try { return localStorage.getItem(LAST_CODE_KEY) || fallback; } catch { return fallback; }
};
const writeLastCode = (code) => { try { localStorage.setItem(LAST_CODE_KEY, code); } catch {} };

/* === Yardımcılar === */
const pad2 = (n) => String(n).padStart(2, "0");
const dayNameTR = (y, m, d) => {
  const names = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  return names[new Date(y, m, d).getDay()] || "";
};
const asCode = (v) => {
  if (!v) return "";
  if (typeof v === "string") return v.toUpperCase();
  if (Array.isArray(v)) return v.map(asCode).filter(Boolean).join(",");
  if (typeof v === "object") {
    const c = v.code ?? v.type ?? v.kind ?? v.short ?? "";
    return String(c || "").toUpperCase();
  }
  return String(v).toUpperCase();
};

export default function PersonCalendar({
  person,
  year,
  month, // 0-baz
  leaveTypes = [],
}) {
  const [ver, setVer] = useState(0);
  const mkey = ymKey(year, month + 1);

  // Kod listesi
  const types = useMemo(() => {
    const arr = (leaveTypes || []).map((t) => {
      const code =
        t?.kisaltma ?? t?.code ?? t?.abbr ?? t?.short ?? t?.Kod ?? t?.Kısaltma ?? "";
      const name = t?.turAdi ?? t?.name ?? t?.TürAdı ?? String(code).toUpperCase();
      return { code: String(code || "").toUpperCase(), name };
    });
    ["Y","R","SÜ","AN","B"].forEach((c) => {
      if (!arr.some((x) => x.code === c)) arr.push({ code: c, name: c });
    });
    return arr.sort((a, b) => a.code.localeCompare(b.code, "tr", { sensitivity: "base" }));
  }, [leaveTypes]);

  // Varsayılan/son kod
  const defaultCode = types[0]?.code || "Y";
  const [selCode, setSelCode] = useState(() => {
    const saved = readLastCode(defaultCode);
    return types.some((t) => t.code === saved) ? saved : defaultCode;
  });
  useEffect(() => {
    if (!types.some((t) => t.code === selCode)) {
      setSelCode(defaultCode);
      writeLastCode(defaultCode);
    }
  }, [types, selCode, defaultCode]);

  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);

  // Bu kişinin bu aydaki izinleri
  const monthly = useMemo(() => {
    const all = getAllLeaves();
    const pid = String(person?.id ?? "");
    return (all?.[pid]?.[mkey]) || {};
  }, [person, mkey, ver]);

  useEffect(() => {
    const onChange = () => setVer((x) => x + 1);
    window.addEventListener("leaves:changed", onChange);
    return () => window.removeEventListener("leaves:changed", onChange);
  }, []);

  // Yaz / Sil (tek/çift tık davranışı)
  const onCellClick = (day) => {
    if (!person?.id) return;
    const ymd = `${mkey}-${pad2(day)}`;
    const current =
      monthly[ymd] ?? monthly[pad2(day)] ?? monthly[String(day)] ?? null;
    const curCode = asCode(current);
    if (!curCode) upsertLeave(person.id, ymd, selCode);
    else if (curCode === selCode) removeLeave(person.id, ymd);
    else upsertLeave(person.id, ymd, selCode);
    setVer((x) => x + 1);
  };
  const onCellDblClick = (day) => {
    if (!person?.id) return;
    const ymd = `${mkey}-${pad2(day)}`;
    removeLeave(person.id, ymd);
    setVer((x) => x + 1);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="font-semibold">
          {person?.name || "Kişi"} — {mkey}
        </div>
        <label className="text-sm text-slate-500 flex items-center gap-2">
          Varsayılan kod:
          <select
            value={selCode}
            onChange={(e) => { setSelCode(e.target.value); writeLastCode(e.target.value); }}
            className="border rounded px-2 py-1 text-sm"
            title="Tek tıkta kullanılacak kod"
          >
            {types.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
          const ymd = `${mkey}-${pad2(d)}`;
          const val =
            monthly[ymd] ??
            monthly[pad2(d)] ??
            monthly[String(d)] ??
            null;
          const badge = asCode(val);

          return (
            <div
              key={d}
              className="border rounded-xl p-2 hover:bg-slate-50 cursor-pointer"
              onClick={() => onCellClick(d)}
              onDoubleClick={() => onCellDblClick(d)}
              title={
                badge
                  ? `${pad2(d)} ${mkey} • ${badge} — Tek tık değiştir/kaldır, çift tık temizle`
                  : `${pad2(d)} ${mkey} — Tek tık ${selCode} yaz`
              }
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs text-slate-500">{dayNameTR(year, month, d)}</span>
                <span className="text-xs font-medium">{pad2(d)}</span>
              </div>

              <div className="h-8 flex items-center">
                {badge ? (
                  <span className="text-xs inline-flex px-2 py-0.5 rounded bg-amber-100 border border-amber-200 text-amber-900">
                    {badge}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        İpucu: Hücreye <b>tek tık</b> seçili kodu yazar/değiştirir, <b>çift tık</b> temizler. Üstten
        “Varsayılan kod”u değiştirerek tek tıkta yazılacak değeri belirleyebilirsin.
      </p>
    </div>
  );
}
