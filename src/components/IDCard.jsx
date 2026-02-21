// src/components/IDCard.jsx
import React from "react";

/* Kimlik Kartı – alt çizgi kaldırıldı */
export default function IDCard({ person }) {
  const accentBar = "bg-rose-600";

  // ------------ Yardımcılar ------------
  const clean = (s) => (s ?? "").toString().trim();
  const uniqCaseInsensitive = (arr) => {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = x.toLocaleLowerCase("tr-TR");
      if (!seen.has(k)) {
        seen.add(k);
        out.push(x);
      }
    }
    return out;
  };
  const sortTR = (arr) =>
    [...arr].sort((a, b) =>
      a.localeCompare(b, "tr-TR", { sensitivity: "base" })
    );

  // Çalışma alanlarını bütün ad varyasyonlarından toparla + normalize et
  const normAreas = () => {
    const raw =
      person?.areas ??
      person?.workAreas ??
      person?.services ??
      person?.workAreaIds ??
      [];
    const arr = Array.isArray(raw) ? raw : [];
    const names = arr
      .map((a) =>
        typeof a === "string"
          ? clean(a)
          : clean(a?.name || a?.label || a?.title || a?.id)
      )
      .filter(Boolean);
    return sortTR(uniqCaseInsensitive(names));
  };

  // Vardiya kodlarını toparla + normalize et
  const normShiftCodes = () => {
    const raw = person?.shiftCodes ?? person?.codes ?? person?.shifts ?? [];
    const arr = Array.isArray(raw) ? raw : [];
    const codes = arr
      .map((c) => (typeof c === "string" ? clean(c) : clean(c?.code || c?.id)))
      .filter(Boolean);
    return sortTR(uniqCaseInsensitive(codes));
  };

  const displayAreas = normAreas();
  const displayCodes = normShiftCodes();

  const Label = ({ children }) => (
    <div className="col-span-1 text-[11px] md:text-[12px] text-slate-500">
      {children}
    </div>
  );
  const Value = ({ children, strong }) => (
    <div
      className={
        "col-span-2 text-[12px] md:text-[13px] " +
        (strong ? "font-semibold text-slate-800" : "font-medium text-slate-700")
      }
    >
      {children}
    </div>
  );

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Üst kalın kırmızı şerit */}
      <div className={`mx-3 mt-3 h-2 rounded-full ${accentBar}`} />

      <div className="p-3 space-y-3">
        <div className="grid grid-cols-3 gap-x-2 gap-y-1">
          <Label>UNVANI</Label>
          <Value>{person?.title || person?.unvan || "-"}</Value>

          <Label>T.C. KİMLİK NO</Label>
          <Value>{person?.tc || person?.tckn || "-"}</Value>

          <Label>AD SOYAD</Label>
          <Value strong>{person?.name || person?.fullName || "-"}</Value>

          <Label>TELEFON NUMARASI</Label>
          <Value>{person?.phone || "-"}</Value>

          <Label>MAİL ADRESİ</Label>
          <Value>{person?.mail || person?.email || "-"}</Value>
        </div>

        <div>
          <div className="text-[11px] text-slate-500 mb-1">ÇALIŞMA ALANLARI</div>
          <div className="flex gap-1.5 flex-wrap">
            {displayAreas.length ? (
              displayAreas.map((s) => (
                <span
                  key={s}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700"
                  title={s}
                >
                  {s}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-slate-400 italic">-</span>
            )}
          </div>
        </div>

        <div>
          <div className="text-[11px] text-slate-500 mb-1">VARDİYE KODLARI</div>
          <div className="flex gap-1.5 flex-wrap">
            {displayCodes.length ? (
              displayCodes.map((c) => (
                <span
                  key={c}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 ring-1 ring-amber-200/60"
                  title={c}
                >
                  {c}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-slate-400 italic">-</span>
            )}
          </div>
        </div>
      </div>
      {/* alt kırmızı vurgu kaldırıldı */}
    </div>
  );
}
