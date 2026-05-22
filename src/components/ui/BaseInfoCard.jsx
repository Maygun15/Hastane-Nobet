/**
 * BaseInfoCard — tema-duyarlı özet kart bileşeni.
 *
 * useModuleTheme() hook'u ile aktif modülün renklerini otomatik okur.
 * İsteğe bağlı olarak `moduleTheme` prop'u ile bağımsız tema verebilirsin.
 *
 * Props:
 *   title       — kart başlığı (küçük etiket)
 *   value       — ana metrik değeri
 *   subtitle    — ikincil açıklama satırı
 *   icon        — Lucide icon bileşeni
 *   trend       — yüzdesel değişim (pozitif → yeşil, negatif → kırmızı)
 *   loading     — skeleton gösterir
 *   moduleTheme — opsiyonel, context yerine doğrudan tema ver
 */
import React from "react";
import { useModuleTheme } from "../../context/ThemeContext.jsx";

function Skeleton({ className }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-100 ${className}`}
      aria-hidden="true"
    />
  );
}

export default function BaseInfoCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  loading = false,
  moduleTheme: propTheme,
}) {
  const ctxTheme = useModuleTheme();
  const theme = propTheme ?? ctxTheme;

  if (loading) {
    return (
      <div className="rounded-card border border-slate-200 bg-white p-4 shadow-card">
        <div className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-card border ${theme.border} bg-white p-4 shadow-card transition-shadow hover:shadow-panel`}
    >
      <div className="flex items-start gap-3">
        {/* İkon alanı */}
        {Icon && (
          <span
            className={`${theme.icon.bg} ${theme.icon.color} flex h-9 w-9 shrink-0 items-center justify-center rounded-lg`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        )}

        {/* Metin alanı */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-slate-500">{title}</p>
          <p className={`mt-0.5 text-2xl font-bold leading-none ${theme.heading}`}>
            {value ?? "—"}
          </p>
          {subtitle && (
            <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
          )}
        </div>

        {/* Trend göstergesi */}
        {trend != null && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${
              trend >= 0
                ? "bg-emerald-50 text-emerald-600"
                : "bg-rose-50 text-rose-600"
            }`}
          >
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
          </span>
        )}
      </div>

      {/* Modül renk çubuğu */}
      <div className={`mt-3 h-0.5 w-full rounded-full ${theme.indicator} opacity-20`} />
    </div>
  );
}
