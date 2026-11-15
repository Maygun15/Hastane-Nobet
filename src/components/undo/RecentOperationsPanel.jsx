import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getRecentUndoOperations, undoOperation } from "../../api/apiAdapter.js";
import { isSpecificServiceSelected } from "../../utils/serviceScope.js";

function formatTime(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function operationLabel(type) {
  if (type === "MANUAL_ASSIGNMENT_ADD") return "Manuel ekleme";
  if (type === "MANUAL_ASSIGNMENT_EDIT") return "Manuel düzenleme";
  if (type === "MANUAL_ASSIGNMENT_DELETE") return "Manuel silme";
  if (type === "QUICK_REPLACE") return "Hızlı değiştir";
  return type || "İşlem";
}

function isSpecificRoleSelected(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["all", "all roles", "tümü", "tüm roller"].includes(normalized);
}

export default function RecentOperationsPanel({ scope, onChanged }) {
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [undoingId, setUndoingId] = useState("");
  const [error, setError] = useState("");

  const exactScopeReady = useMemo(() => {
    return Boolean(
      scope?.sectionId &&
        isSpecificServiceSelected(scope?.serviceId) &&
        isSpecificRoleSelected(scope?.role) &&
        Number.isInteger(Number(scope?.year)) &&
        Number.isInteger(Number(scope?.month))
    );
  }, [scope]);

  const load = useCallback(async () => {
    if (!exactScopeReady) {
      setOperations([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await getRecentUndoOperations(scope);
      setOperations(Array.isArray(data?.operations) ? data.operations : []);
    } catch (err) {
      setError(err?.body?.message || err?.message || "Son işlemler alınamadı.");
    } finally {
      setLoading(false);
    }
  }, [exactScopeReady, scope]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handler = () => load();
    window.addEventListener("schedule:saved", handler);
    window.addEventListener("planner:changed", handler);
    window.addEventListener("schedule:invalidated", handler);
    return () => {
      window.removeEventListener("schedule:saved", handler);
      window.removeEventListener("planner:changed", handler);
      window.removeEventListener("schedule:invalidated", handler);
    };
  }, [load]);

  const handleUndo = async (operation) => {
    if (!operation?.id) return;
    const confirmed = window.confirm(
      "Bu işlem yalnız mevcut çizelge aynı kaldıysa geri alınır. Devam edilsin mi?"
    );
    if (!confirmed) return;
    setUndoingId(operation.id);
    try {
      await undoOperation(operation.id, "Manual undo from recent operations panel");
      toast.success("İşlem geri alındı.");
      await load();
      if (typeof onChanged === "function") onChanged();
    } catch (err) {
      const code = err?.body?.code || err?.data?.code || "";
      const message =
        err?.body?.message ||
        err?.data?.message ||
        err?.message ||
        "Geri alma işlemi tamamlanamadı.";
      if (code === "UNDO_CONFLICT") {
        toast.error("Bu işlemden sonra aynı kayıt değiştiği için otomatik geri alma yapılamaz.");
      } else {
        toast.error(message);
      }
    } finally {
      setUndoingId("");
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">Son 10 İşlem</div>
          <div className="text-xs text-slate-500">Bu kapsamda geri alınabilir manuel çizelge işlemleri.</div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={!exactScopeReady || loading}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={14} />
          Yenile
        </button>
      </div>

      {!exactScopeReady && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Son işlemleri görmek için belirli servis, rol, yıl ve ay seçili olmalı.
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {exactScopeReady && !loading && operations.length === 0 && !error && (
        <div className="mt-3 text-xs text-slate-500">Bu kapsamda geri alınabilir işlem bulunamadı.</div>
      )}

      {operations.length > 0 && (
        <div className="mt-3 grid gap-2">
          {operations.map((item) => {
            const available = item.reversible && item.undoStatus === "available";
            return (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {operationLabel(item.operationType)}
                    <span className="ml-2 text-xs font-normal text-slate-500">{formatTime(item.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-600">
                    {item.summary || "Özet yok"}
                    {item.createdByName ? ` · ${item.createdByName}` : ""}
                  </div>
                  {item.undoStatus && item.undoStatus !== "available" && (
                    <div className="mt-1 text-xs text-slate-500">Durum: {item.undoStatus}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleUndo(item)}
                  disabled={!available || undoingId === item.id}
                  className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <RotateCcw size={14} />
                  {undoingId === item.id ? "Geri alınıyor..." : "Geri Al"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
