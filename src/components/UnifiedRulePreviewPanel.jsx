import React, { useMemo } from "react";
import {
  getUiRuleMetaByUiRuleId,
  resolveUnifiedCodeFromUiRuleId,
} from "../rules/uiRuleAdapter.js";

function buildPreviewRow(rule) {
  const uiRuleId = String(rule?.id || "").trim();
  const unifiedCode = resolveUnifiedCodeFromUiRuleId(uiRuleId);
  const meta = getUiRuleMetaByUiRuleId(uiRuleId);

  return {
    uiRuleId,
    unifiedCode: unifiedCode || null,
    shortLabelTr: meta?.shortLabelTr || meta?.labelTr || uiRuleId || "Bilinmeyen Kural",
    categoryTr: meta?.categoryTr || null,
    type: meta?.type || null,
    locked: meta?.locked === true,
    metadataFound: Boolean(meta),
  };
}

export default function UnifiedRulePreviewPanel({
  rules = [],
  title = "Birleşik Kural Önizlemesi",
}) {
  const rows = useMemo(() => {
    const safeRules = Array.isArray(rules) ? rules.filter(Boolean) : [];
    return safeRules
      .map(buildPreviewRow)
      .filter((item) => item.uiRuleId)
      .sort((a, b) => String(a.uiRuleId).localeCompare(String(b.uiRuleId)));
  }, [rules]);

  return (
    <details className="rounded-2xl border bg-white" open={false}>
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-semibold text-slate-800">{title}</div>
          <div className="text-xs text-slate-500">
            UI kural kimliklerinin birleşik kural kimliği ile eşleşmesini read-only gösterir.
          </div>
        </div>
        <span className="text-xs px-2 py-1 rounded-full border bg-slate-50 text-slate-600">
          {rows.length} kural
        </span>
      </summary>

      <div className="border-t px-4 py-3">
        {!rows.length ? (
          <div className="text-sm text-slate-500">Önizlenecek kural bulunamadı.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.uiRuleId} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] px-1.5 py-0.5 rounded border bg-white text-slate-500">
                    {row.uiRuleId}
                  </span>
                  <span className="font-medium text-slate-800">{row.shortLabelTr}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      row.metadataFound
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-100 text-slate-600 border-slate-200"
                    }`}
                  >
                    {row.metadataFound ? "Metadata Var" : "Metadata Yok"}
                  </span>
                  {row.type && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200">
                      {row.type}
                    </span>
                  )}
                  {row.locked && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                      Sistem Kuralı
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  <span className="font-medium">Unified Code:</span>{" "}
                  {row.unifiedCode || "Eşleşme Yok"}
                </div>
                {row.categoryTr && (
                  <div className="mt-0.5 text-xs text-slate-500">{row.categoryTr}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
