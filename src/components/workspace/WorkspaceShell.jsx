import React from "react";

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export function WorkspaceHero({ badges = [], title, description, metrics = [] }) {
  return (
    <section className="rounded-[30px] border border-slate-200 bg-white px-5 py-5 shadow-sm md:px-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          {badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {badges.map((badge) => {
                const Icon = badge.icon;
                return (
                  <span
                    key={badge.label}
                    className={cx(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
                      badge.tone || "border-slate-200 bg-slate-50 text-slate-600"
                    )}
                  >
                    {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                    {badge.label}
                  </span>
                );
              })}
            </div>
          )}
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
          {description ? <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>

        {metrics.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <WorkspaceMetricCard
                key={metric.label}
                icon={metric.icon}
                accent={metric.accent}
                label={metric.label}
                value={metric.value}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function WorkspaceMetricCard({ icon: Icon, accent = "sky", label, value }) {
  const accentMap = {
    sky: "border-sky-200 bg-white text-sky-700 shadow-[0_10px_26px_-22px_rgba(14,165,233,0.7)]",
    emerald: "border-emerald-200 bg-white text-emerald-700 shadow-[0_10px_26px_-22px_rgba(16,185,129,0.7)]",
    violet: "border-violet-200 bg-white text-violet-700 shadow-[0_10px_26px_-22px_rgba(124,58,237,0.65)]",
    amber: "border-amber-200 bg-white text-amber-700 shadow-[0_10px_26px_-22px_rgba(245,158,11,0.75)]",
  };
  const tone = accentMap[accent] || accentMap.sky;
  return (
    <div className={cx("rounded-[22px] border px-4 py-3", tone)}>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-current/10 bg-current/5">
          {Icon ? <Icon className="h-4.5 w-4.5" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-current/75">{label}</div>
          <div className="mt-1 truncate text-[17px] font-semibold leading-6 text-slate-950">{value}</div>
        </div>
      </div>
    </div>
  );
}

export function WorkspacePanel({ title, description, children, aside }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{title}</div>
          {description ? <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p> : null}
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
        {aside ? <div className="xl:w-[360px] xl:shrink-0">{aside}</div> : null}
      </div>
    </div>
  );
}

export function WorkspaceStatCard({ accent = "sky", title, value, caption }) {
  const tones = {
    sky: "border-sky-100 bg-sky-50/70 text-sky-700",
    emerald: "border-emerald-100 bg-emerald-50/70 text-emerald-700",
    amber: "border-amber-100 bg-amber-50/70 text-amber-700",
    violet: "border-violet-100 bg-violet-50/70 text-violet-700",
    rose: "border-rose-100 bg-rose-50/70 text-rose-700",
    slate: "border-slate-200 bg-slate-50/70 text-slate-700",
  };
  const tone = tones[accent] || tones.sky;
  return (
    <div className={cx("rounded-2xl border p-4", tone)}>
      <div className="text-xs font-medium uppercase tracking-[0.14em]">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
      {caption ? <div className="mt-1 text-xs text-slate-500">{caption}</div> : null}
    </div>
  );
}
