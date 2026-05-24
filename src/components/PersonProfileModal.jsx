// src/components/PersonProfileModal.jsx
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, User, Calendar, Clock, Activity } from "lucide-react";
import { http } from "../lib/api.js";

export default function PersonProfileModal({ person, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!person?._id && !person?.id) return;
    const id = person._id || person.id;
    setLoading(true);
    http
      .get(`/api/personnel/${id}/profile`)
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        toast.error(err?.message || "Profil yüklenemedi");
      })
      .finally(() => setLoading(false));
  }, [person]);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const assignments = data?.assignments || [];

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const thisMonthStr = `${thisYear}-${String(thisMonth).padStart(2, "0")}`;

  const totalCount = assignments.length;
  const thisMonthCount = assignments.filter((a) =>
    (a.date || "").startsWith(thisMonthStr)
  ).length;
  const totalHours = assignments.reduce((sum, a) => sum + (Number(a.hours) || 0), 0);

  const personName =
    data?.person?.name ||
    person?.name ||
    person?.fullName ||
    "Personel";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <User className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold text-slate-900">{personName}</div>
              <div className="text-xs text-slate-500">Personel Profili</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
              Yükleniyor...
            </div>
          ) : (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
                  <div className="flex justify-center items-center mb-1">
                    <Calendar className="h-4 w-4 text-sky-600" />
                  </div>
                  <div className="text-2xl font-bold text-slate-900">{totalCount}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Toplam Nöbet</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
                  <div className="flex justify-center items-center mb-1">
                    <Activity className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="text-2xl font-bold text-slate-900">{thisMonthCount}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Bu Ay</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
                  <div className="flex justify-center items-center mb-1">
                    <Clock className="h-4 w-4 text-amber-600" />
                  </div>
                  <div className="text-2xl font-bold text-slate-900">{totalHours}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Toplam Saat</div>
                </div>
              </div>

              {/* Assignments table */}
              {assignments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Calendar className="h-10 w-10 mb-3 opacity-30" />
                  <div className="text-sm">Nöbet kaydı bulunamadı</div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Tarih</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Servis</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Vardiya</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Görev</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Saat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {assignments.map((a, i) => (
                        <tr key={a._id || i} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-2.5 text-slate-700 font-medium tabular-nums">{a.date || "-"}</td>
                          <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate" title={a.serviceId || "-"}>{a.serviceId || "-"}</td>
                          <td className="px-4 py-2.5">
                            {a.shiftCode ? (
                              <span className="inline-flex items-center rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-xs font-medium text-sky-700">
                                {a.shiftCode}
                              </span>
                            ) : "-"}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 text-xs max-w-xs truncate" title={a.roleLabel || a.taskKey || "-"}>{a.roleLabel || a.taskKey || "-"}</td>
                          <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{a.hours || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-100 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
