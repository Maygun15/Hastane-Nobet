import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, FileText } from "lucide-react";
import { http } from "../lib/api.js";

const METHOD_COLOR = {
  GET:    "bg-sky-100 text-sky-700",
  POST:   "bg-emerald-100 text-emerald-700",
  PUT:    "bg-amber-100 text-amber-700",
  PATCH:  "bg-amber-100 text-amber-700",
  DELETE: "bg-rose-100 text-rose-700",
};

function EmptyState({ query }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
        <FileText className="w-6 h-6 text-slate-400" />
      </div>
      <p className="text-sm font-medium text-slate-600">
        {query ? "Eşleşen kayıt bulunamadı" : "Henüz kayıt yok"}
      </p>
      <p className="text-xs text-slate-400 mt-1">
        {query
          ? `"${query}" için sonuç yok — aramayı temizleyin`
          : "API işlemleri burada görünecek"}
      </p>
    </div>
  );
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await http.get("/api/audit-logs?limit=300");
      const items = Array.isArray(data?.logs) ? data.logs : Array.isArray(data) ? data : [];
      setLogs(items);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!query) return logs;
    const q = query.toLocaleLowerCase("tr-TR");
    return logs.filter(
      (l) =>
        String(l.user || l.userId || "").toLowerCase().includes(q) ||
        String(l.endpoint || "").toLowerCase().includes(q),
    );
  }, [logs, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">İşlem Günlüğü</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            API işlem geçmişi — kayıtlar 90 gün saklanır
          </p>
        </div>
        <button
          onClick={() => { load(); setPage(1); }}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="Kullanıcı veya endpoint ile ara…"
          className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-x-auto">
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Yükleniyor…</div>
        ) : filtered.length === 0 ? (
          <EmptyState query={query} />
        ) : (
          <table className="min-w-full text-xs divide-y divide-slate-100">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Tarih</th>
                <th className="px-4 py-2.5 font-medium">Kullanıcı</th>
                <th className="px-4 py-2.5 font-medium">İşlem</th>
                <th className="px-4 py-2.5 font-medium">Açıklama</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {paginated.map((l, i) => (
                <tr key={l._id || i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                    {l.timestamp
                      ? new Date(l.timestamp).toLocaleString("tr-TR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 max-w-[160px] truncate" title={l.user || l.userId}>
                    {l.user ? (
                      <span className="font-medium text-slate-700">{l.user}</span>
                    ) : (
                      <span className="text-slate-400 italic">anonim</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          METHOD_COLOR[l.method] || "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {l.method}
                      </span>
                      <span
                        className="font-mono text-slate-600 truncate max-w-[200px]"
                        title={l.endpoint}
                      >
                        {l.endpoint}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={l.statusCode >= 400 ? "text-rose-600" : "text-slate-600"}>
                      {l.description || "—"}
                    </span>
                    {l.responseTime != null && (
                      <span className="ml-1.5 text-slate-400 text-[10px]">
                        · {l.responseTime}ms
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {filtered.length} kayıt — sayfa {page}/{totalPages}
          </span>
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
