/**
 * ActionToolbar + ToolbarButton — tema-duyarlı araç çubuğu ailesi.
 *
 * ToolbarButton:
 *   variant     — 'primary' | 'secondary' | 'danger' | 'reset'
 *   icon        — Lucide icon bileşeni (opsiyonel)
 *   loading     — spin animasyonu gösterir, butonu devre dışı bırakır
 *   moduleTheme — context yerine doğrudan tema (opsiyonel)
 *
 * ActionToolbar:
 *   title, subtitle — başlık alanı
 *   actions         — { label, icon, variant, danger, onClick, disabled } dizisi
 *   moduleTheme     — opsiyonel doğrudan tema
 *   children        — actions dizisi yerine/yanında custom butonlar
 */
import React from "react";
import { Loader2 } from "lucide-react";
import { useModuleTheme } from "../../context/ThemeContext.jsx";

// ── ToolbarButton ─────────────────────────────────────────────────────────────

export function ToolbarButton({
  children,
  variant = "secondary",
  icon: Icon,
  loading = false,
  moduleTheme: propTheme,
  className = "",
  disabled,
  ...props
}) {
  const ctxTheme = useModuleTheme();
  const theme = propTheme ?? ctxTheme;
  const colorClass = theme.button[variant] ?? theme.button.secondary;

  return (
    <button
      disabled={disabled || loading}
      className={[
        "inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-sm",
        "font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        colorClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

// ── ActionToolbar ─────────────────────────────────────────────────────────────

/**
 * @param {{
 *   title?: string,
 *   subtitle?: string,
 *   actions?: Array<{
 *     label: string,
 *     icon?: React.ComponentType,
 *     variant?: 'primary'|'secondary'|'danger'|'reset',
 *     loading?: boolean,
 *     disabled?: boolean,
 *     onClick: () => void,
 *   }>,
 *   moduleTheme?: import('../../styles/theme.js').ModuleTheme,
 *   children?: React.ReactNode,
 * }} props
 */
export default function ActionToolbar({
  title,
  subtitle,
  actions,
  moduleTheme: propTheme,
  children,
}) {
  const ctxTheme = useModuleTheme();
  const theme = propTheme ?? ctxTheme;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Başlık */}
      {(title || subtitle) && (
        <div className="min-w-0">
          {title && (
            <h2 className={`text-lg font-semibold ${theme.heading}`}>
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
      )}

      {/* Aksiyon butonları */}
      <div className="flex flex-wrap items-center gap-2">
        {actions?.map((action, i) => (
          <ToolbarButton
            key={i}
            variant={action.variant ?? "secondary"}
            icon={action.icon}
            loading={action.loading}
            disabled={action.disabled}
            onClick={action.onClick}
            moduleTheme={theme}
          >
            {action.label}
          </ToolbarButton>
        ))}
        {children}
      </div>
    </div>
  );
}
