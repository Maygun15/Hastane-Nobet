// src/components/IDCard.jsx
import React, { useState } from "react";
import { maskTC } from "../utils/format.js";

const clean = (s) => (s ?? "").toString().trim();
const uniq = (arr) => {
  const seen = new Set();
  return arr.filter((x) => {
    const k = x.toLocaleLowerCase("tr-TR");
    return seen.has(k) ? false : seen.add(k);
  });
};
const sortTR = (arr) =>
  [...arr].sort((a, b) => a.localeCompare(b, "tr-TR", { sensitivity: "base" }));
const isMongoLikeId = (value) => /^[a-f0-9]{24}$/i.test(String(value || "").trim());

const ROLE_COLOR = {
  doctor: "bg-blue-50 text-blue-700 border-blue-200",
  nurse: "bg-rose-50 text-rose-700 border-rose-200",
  default: "bg-slate-50 text-slate-600 border-slate-200",
};

function roleColor(role) {
  const r = String(role || "").toLowerCase();
  if (r.includes("doctor") || r.includes("doktor")) return ROLE_COLOR.doctor;
  if (r.includes("nurse") || r.includes("hem")) return ROLE_COLOR.nurse;
  return ROLE_COLOR.default;
}

function Chip({ children, cls }) {
  return (
    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  );
}

function Row({ label, value, mono }) {
  if (!value || value === "-") return null;
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400 w-24">
        {label}
      </span>
      <span className={`text-[12px] text-slate-700 truncate ${mono ? "font-mono" : "font-medium"}`}>
        {value}
      </span>
    </div>
  );
}

export default function IDCard({ person, serviceNames }) {
  const [expanded, setExpanded] = useState(false);

  const servicesDisplay = (
    Array.isArray(serviceNames) && serviceNames.length
      ? serviceNames
      : [person?.serviceName || person?.service || ""]
  )
    .map((s) => clean(s))
    .filter((s) => s && !isMongoLikeId(s));

  const rawAreas = person?.areas ?? person?.workAreas ?? [];
  const displayAreas = sortTR(uniq(
    (Array.isArray(rawAreas) ? rawAreas : [])
      .map((a) => (typeof a === "string" ? clean(a) : clean(a?.name || a?.label || "")))
      .filter(Boolean)
  ));

  const rawCodes = person?.shiftCodes ?? person?.codes ?? [];
  const displayCodes = sortTR(uniq(
    (Array.isArray(rawCodes) ? rawCodes : [])
      .map((c) => (typeof c === "string" ? clean(c) : clean(c?.code || "")))
      .filter(Boolean)
  ));

  const rc = roleColor(person?.role);
  const hasExtra = displayAreas.length > 0 || displayCodes.length > 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden transition-shadow hover:shadow-md">
      <div className="px-4 py-2.5 flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold border ${rc}`}>
            {(person?.name || person?.fullName || "?")[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-800 truncate uppercase tracking-wide">
              {person?.name || person?.fullName || "-"}
            </div>
            <div className="text-[11px] text-slate-500">
              {person?.title || person?.unvan || ""}
            </div>
          </div>
        </div>

        {servicesDisplay.length > 0 && (
          <div className="shrink-0 flex flex-col items-end gap-1">
            {servicesDisplay.slice(0, 2).map((s) => (
              <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-medium">
                {s}
              </span>
            ))}
            {servicesDisplay.length > 2 && (
              <span className="text-[10px] text-slate-400">+{servicesDisplay.length - 2}</span>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 space-y-1.5 border-b border-slate-100">
        <Row label="TC" value={maskTC(person?.tc || person?.tckn)} mono />
        <Row label="Telefon" value={person?.phone} />
        <Row label="Mail" value={person?.mail || person?.email} />
      </div>

      {hasExtra && (
        <div className="px-4 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 mb-2"
          >
            <span>{expanded ? "▲" : "▼"}</span>
            <span>{expanded ? "Gizle" : "Çalışma alanları & vardiyeler"}</span>
          </button>

          {expanded && (
            <div className="space-y-2">
              {displayAreas.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Çalışma Alanları</div>
                  <div className="flex flex-wrap gap-1">
                    {displayAreas.map((s) => (
                      <Chip key={s} cls="bg-slate-50 text-slate-600 border-slate-200">{s}</Chip>
                    ))}
                  </div>
                </div>
              )}
              {displayCodes.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Vardiye Kodları</div>
                  <div className="flex flex-wrap gap-1">
                    {displayCodes.map((c) => (
                      <Chip key={c} cls="bg-amber-50 text-amber-700 border-amber-200">{c}</Chip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
