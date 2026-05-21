// src/tabs/MonthlyLeavesMatrixGeneric.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getAllLeaves, setLeave, unsetLeave } from "../lib/leaves.js";
import { checkLeaveShiftConflict, removeShiftOnDay } from "../utils/conflictChecker.js";

/* ===== Görsel sabitler ===== */
const MONTHS_TR = [
  "Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
  "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"
];

/* ===== Son kullanılan kod (tek tıkta yazılacak) ===== */
const LAST_CODE_KEY = "lastLeaveCodeV1";
const readLastCode = (fallback = "Y") => {
  try { return localStorage.getItem(LAST_CODE_KEY) || fallback; } catch { return fallback; }
};
const writeLastCode = (code) => { try { localStorage.setItem(LAST_CODE_KEY, code); } catch {} };

/* ===== Yardımcılar ===== */
const pad2  = (n) => String(n).padStart(2, "0");
const upTR  = (s) => (s ?? "").toString().trim().toLocaleUpperCase("tr");
const normCode = (t) =>
  upTR(t?.code ?? t?.kisaltma ?? t?.abbr ?? t?.short ?? t?.KISALTMA ?? "");
const normName = (t) =>
  (t?.name ?? t?.turAdi ?? t?.title ?? t?.TUR_ADI ?? t?.TÜR_ADI ?? "").toString();

// İsim kanonikleştirici (dosya içi kullanım)
function canonName(name = "") {
  return upTR(name).replace(/\s+/g, " ");
}

function asCode(val) {
  if (!val) return "";
  if (typeof val === "string") return upTR(val);
  if (Array.isArray(val)) return val.map(asCode).filter(Boolean).join(",");
  if (typeof val === "object") {
    const c = val.code ?? val.type ?? val.kind ?? val.short ?? "";
    return upTR(c);
  }
  return upTR(val);
}

/* ===== Parametre gelmezse gösterilecek minimal tip listesi ===== */
const FALLBACK_TYPES = [
  { code: "Y",  name: "Yıllık İzin" },
  { code: "R",  name: "Rapor" },
  { code: "SÜ", name: "Süt İzni" },
  { code: "AN", name: "Ay Sonu Nöbeti" },
  { code: "B",  name: "Boşluk İsteği" },
];

export default function MonthlyLeavesMatrixGeneric({
  title,
  people = [],
  year,
  month,                 // 0-baz
  selectedService = null,
  serviceId = null,
  personLeaves,          // PlanTab’tan gelirse onu kullanırız, yoksa getAllLeaves()
  leaveTypes = [],
}) {
  const m0   = Math.max(0, Math.min(11, Number(month) || 0));   // 0..11
  const ym   = `${year}-${pad2(m0 + 1)}`;                       // "YYYY-MM"
  const monthLabel = MONTHS_TR[m0] || "";

  const daysInMonth = useMemo(() => new Date(year, m0 + 1, 0).getDate(), [year, m0]);
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  /* ---- Leave type listesini normalize et ---- */
  const types = useMemo(() => {
    const src = Array.isArray(leaveTypes) && leaveTypes.length ? leaveTypes : FALLBACK_TYPES;
    const seen = new Set(); const out = [];
    for (const t of src) {
      const code = normCode(t);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push({ code, name: normName(t) });
    }
    return out.sort((a, b) => a.code.localeCompare(b.code, "tr", { sensitivity: "base" }));
  }, [leaveTypes]);
  const typeCodes = useMemo(() => types.map((t) => t.code), [types]);

  /* ---- Son kullanılan kod ---- */
  const defaultCode = types[0]?.code || "Y";
  const [lastCode, setLastCode] = useState(() => {
    const saved = readLastCode(defaultCode);
    return typeCodes.includes(saved) ? saved : defaultCode;
  });
  useEffect(() => {
    if (!typeCodes.includes(lastCode)) {
      setLastCode(defaultCode);
      writeLastCode(defaultCode);
    }
  }, [typeCodes, defaultCode, lastCode]);

  /* ---- İzin verisini canlı tut ---- */
  const [version, setVersion] = useState(0);
  const [liveLeaves, setLiveLeaves] = useState(() => getAllLeaves());
  const leavesObj = useMemo(() => {
    const fromProp = personLeaves && typeof personLeaves === "object" ? personLeaves : {};
    const fromLive = liveLeaves && typeof liveLeaves === "object" ? liveLeaves : {};
    return { ...fromProp, ...fromLive };
  }, [personLeaves, liveLeaves, ym, version]);

  useEffect(() => {
    const refresh = () => {
      setLiveLeaves(getAllLeaves());
      setVersion((v) => v + 1);
    };
    window.addEventListener("leaves:changed", refresh);
    return () => {
      window.removeEventListener("leaves:changed", refresh);
    };
  }, []);

  /* ---- Filtrelenmiş satırlar ---- */
  const rows = useMemo(() => {
    const svc = selectedService ?? serviceId ?? null;
    const filtered = (people || []).filter(
      (p) => !svc || p?.service === svc || p?.serviceId === svc
    );

    const sorted = [...filtered].sort((a, b) => {
      const aName = String(a?.fullName || a?.name || "").trim();
      const bName = String(b?.fullName || b?.name || "").trim();
      const byName = aName.localeCompare(bName, "tr", { sensitivity: "base" });
      if (byName !== 0) return byName;
      const aId = String(a?.id ?? a?.personId ?? "");
      const bId = String(b?.id ?? b?.personId ?? "");
      return aId.localeCompare(bId, "tr", { sensitivity: "base" });
    });

    return sorted.map((p) => {
      const canon   = canonName(p.fullName || p.name || "");
      const pid     = p?.id ? String(p.id) : "";
      const monthly = leavesObj?.[pid]?.[ym] || {};
      return {
        id: String(pid || canon || Math.random()),
        personId: pid,
        name: p.fullName || p.name || canon,
        canon,
        monthly,
      };
    });
  }, [people, selectedService, serviceId, leavesObj, ym]);

  /* ---- Hücrede görünen mevcut kod ---- */
  const cellCode = (monthly, d) => {
    const v = monthly?.[`${ym}-${pad2(d)}`] ?? monthly?.[pad2(d)] ?? monthly?.[String(d)];
    return asCode(v);
  };

  /* ---- Yaz / Sil ---- */
  const applySet = async (pid, name, d, code) => {
    const conflict = checkLeaveShiftConflict({
      personId: pid,
      personName: name,
      year,
      month: m0 + 1,
      day: d,
      people,
    });
    if (conflict.hasConflict) {
      const ok = window.confirm(`${conflict.message}\n\nYine de izin eklensin mi?`);
      if (!ok) return;
      try {
        window.dispatchEvent(new CustomEvent("leave:conflict", { detail: conflict }));
      } catch {}
      await removeShiftOnDay({
        personId: pid,
        personName: name,
        year,
        month: m0 + 1,
        day: d,
        people,
      });
    }
    setLeave({ personId: pid, personName: name, year, month: m0 + 1, day: d, code });
    setVersion((v) => v + 1);
  };
  const applyUnset = (pid, name, d) => {
    unsetLeave({ personId: pid, personName: name, year, month: m0 + 1, day: d });
    setVersion((v) => v + 1);
  };

  /* ---- Tek tık (ekle/değiştir/kaldır) ---- */
  const quickClick = (pid, name, d, currentCode) => {
    const lc  = upTR(lastCode || defaultCode);
    const cur = upTR(currentCode || "");
    if (!cur)              void applySet(pid, name, d, lc);
    else if (cur === lc)   applyUnset(pid, name, d);
    else                   void applySet(pid, name, d, lc);
  };

  /* ---- Kod seçim menüsü (Shift+tık) ---- */
  const [menu, setMenu] = useState(null); // {open,x,y,pid,day,current}
  const menuRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (!menu?.open) return;
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  const openMenu = (evt, pid, name, d, currentCode) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    setMenu({
      open: true,
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.bottom + window.scrollY + 4),
      pid, name, day: d, current: currentCode || null,
    });
  };
  const chooseType = (code) => {
    if (!menu?.open) return;
    const chosen = code || defaultCode;
    setLastCode(chosen);
    writeLastCode(chosen);
    void applySet(menu.pid, menu.name, menu.day, chosen);
    setMenu(null);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 relative">
      <div className="flex items-center justify-between">
        <div className="font-semibold">
          {title || `Toplu İzin Listesi — ${monthLabel} ${year}`}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span>Varsayılan kod:</span>
          <select
            value={lastCode}
            onChange={(e) => { setLastCode(e.target.value); writeLastCode(e.target.value); }}
            className="border rounded px-2 py-1"
            title="Tek tıkta kullanılacak kod"
          >
            {types.map((lt) => (
              <option key={lt.code} value={lt.code}>
                {lt.code}{lt.name ? ` — ${lt.name}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-auto mt-3 rounded-card border border-slate-200 shadow-card">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="text-left w-64 px-3 py-2.5 text-xs font-semibold text-ink-muted uppercase tracking-wide bg-white border-b-2 border-brand-600 border-r border-slate-100">Ad Soyad</th>
              {days.map((d) => {
                const dow = new Date(year, m0, d).getDay();
                const isWE = dow === 0 || dow === 6;
                return (
                  <th key={d} className={`text-center px-1 py-2.5 text-xs font-semibold font-mono tabular-nums border-b-2 ${isWE ? "bg-blue-50 text-blue-600 border-blue-300" : "bg-white text-ink-muted border-brand-600"}`}>{d}</th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="odd:bg-white even:bg-slate-50/50 hover:bg-blue-50/30 transition-colors">
                <td className="px-3 py-2 font-medium text-ink border-r border-slate-200 w-64">{r.name}</td>
                {days.map((d) => {
                  const dow = new Date(year, m0, d).getDay();
                  const isWE = dow === 0 || dow === 6;
                  const code = cellCode(r.monthly, d);
                  const has  = !!code;
                  return (
                    <td
                      key={`${r.id}-${d}`}
                      className={`text-center px-1 py-1 cursor-pointer select-none transition-colors ${
                        has
                          ? "bg-emerald-50 hover:bg-emerald-100"
                          : isWE
                          ? "bg-blue-50 hover:bg-blue-100/70"
                          : "hover:bg-slate-100/60"
                      }`}
                      title={
                        has
                          ? `İzin: ${code} — Tek tık değiştir/kaldır • Çift tık: kaldır • Shift: tür seç • Ctrl/Cmd: kaldır`
                          : "Tek tık: ekle • Shift: tür seç"
                      }
                      onClick={(e) => {
                        if (e.shiftKey) { openMenu(e, r.id, r.name, d, code); }
                        else if (e.metaKey || e.ctrlKey) { applyUnset(r.id, r.name, d); }
                        else { quickClick(r.id, r.name, d, code); }
                      }}
                      onDoubleClick={() => applyUnset(r.id, r.name, d)}
                      onContextMenu={(e) => { e.preventDefault(); applyUnset(r.id, r.name, d); }}
                    >
                      <div
                        className={`h-7 min-w-[28px] mx-auto rounded-chip grid place-items-center text-xs font-semibold ${
                          has
                            ? "bg-emerald-100 border border-emerald-300 text-emerald-800"
                            : "border border-transparent text-slate-300"
                        }`}
                      >
                        {has ? code : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={1 + days.length} className="px-3 py-10 text-center text-ink-faint">
                  Kişi bulunamadı. (Personel listesi veya filtreyi kontrol edin.)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Tür seçme menüsü */}
      {menu?.open && (
        <div
          ref={menuRef}
          style={{ position: "absolute", left: menu.x, top: menu.y, zIndex: 1000, minWidth: 220 }}
          className="rounded-lg shadow-lg border border-slate-200 bg-white p-1"
        >
          <div className="px-2 py-1 text-xs text-slate-500">
            {MONTHS_TR[m0]} {menu.day}
          </div>
          <div className="max-h-64 overflow-auto">
            {types.map((lt) => (
              <button
                key={lt.code}
                onClick={() => chooseType(lt.code)}
                className={`w-full text-left px-3 py-2 rounded hover:bg-slate-100 ${
                  menu.current === lt.code ? "bg-emerald-50 border border-emerald-200" : ""
                }`}
              >
                <span className="font-medium">{lt.code}</span>
                {lt.name ? <span className="ml-2 text-slate-500">{lt.name}</span> : null}
              </button>
            ))}
          </div>
          <div className="border-t mt-1 pt-1 flex gap-1">
            <button onClick={() => setMenu(null)} className="px-3 py-2 rounded bg-white hover:bg-slate-100 text-sm">
              Kapat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
