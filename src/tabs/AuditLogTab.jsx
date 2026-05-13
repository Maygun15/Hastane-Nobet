// src/tabs/AuditLogTab.jsx — admin audit log görüntüleyici
import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search, CheckCircle, XCircle, Clock } from "lucide-react";
import { apiFetch } from "../lib/api.js";

const METHOD_COLOR = {
  GET:    "bg-sky-100 text-sky-700",
  POST:   "bg-emerald-100 text-emerald-700",
  PUT:    "bg-amber-100 text-amber-700",
  PATCH:  "bg-amber-100 text-amber-700",
  DELETE: "bg-rose-100 text-rose-700",
};

function StatusIcon({ code }) {
  if (code >= 200 && code < 300) return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />;
  if (code >= 400) return <XCircle className="w-3.5 h-3.5 text-rose-500" />;
  return <Clock className="w-3.5 h-3.5 text-slate-400" />;
}

export default function AuditLogTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/admin/audit-logs?limit=200`);
      const items = Array.isArray(data?.logs || data?.items || data)
        ? (data?.logs || data?.items || data)
        : [];
      setLogs(items);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = logs.filter((l) => {
    if (!query) return true;
    const q = query.toLocaleLowerCase("tr-TR");
    return (
      String(l.userId || "").toLowerCase().includes(q) ||
      String(l.action || l.endpoint || "").toLowerCase().includes(q) ||
      String(l.method || "").toLowerCase().includes(q) ||
      String(l.statusCode || "").includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">İşlem Günlüğü</h2>
          <p className="text-xs text-slate-500 mt-0.5">Son API işlemlerinin kaydı — kim ne zaman ne yaptı</p>
        </div>
        <button
          onClick={() => { load(); setPage(1); }}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </button>
      </div>

      {/* Arama */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="Kullanıcı, endpoint, metod…"
          className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
      </div>

      {/* Tablo */}
      <div className="rounded-xl border bg-white overflow-x-auto">
        {loading && logs.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">Yükleniyor…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">Kayıt bulunamadı</div>
        ) : (
          <table className="min-w-full text-xs divide-y divide-slate-100">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-3 py-2.5 font-medium">Tarih</th>
                <th className="px-3 py-2.5 font-medium">Kullanıcı</th>
                <th className="px-3 py-2.5 font-medium">Metod</th>
                <th className="px-3 py-2.5 font-medium">Endpoint</th>
                <th className="px-3 py-2.5 font-medium text-center">Durum</th>
                <th className="px-3 py-2.5 font-medium text-right">Süre (ms)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {paginated.map((l, i) => (
                <tr key={l._id || i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                    {l.createdAt
                      ? new Date(l.createdAt).toLocaleString("tr-TR", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-700 max-w-[120px] truncate">
                    {l.userId === "anonymous" ? <span className="text-slate-400 italic">anonim</span> : l.userId}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${METHOD_COLOR[l.method] || "bg-slate-100 text-slate-600"}`}>
                      {l.method}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600 max-w-[240px] truncate" title={l.endpoint}>
                    {l.endpoint}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center gap-1">
                      <StatusIcon code={l.statusCode} />
                      <span className={l.statusCode >= 400 ? "text-rose-600" : "text-slate-600"}>{l.statusCode}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {l.responseTime != null ? `${l.responseTime}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Sayfalama */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{filtered.length} kayıt — sayfa {page}/{totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              ← Önceki
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              Sonraki →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
