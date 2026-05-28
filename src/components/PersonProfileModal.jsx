// src/components/PersonProfileModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X, User, Calendar, Clock, Activity } from "lucide-react";
import { http } from "../lib/api.js";
import { useServices } from "../hooks/useServicesModel.js";
import { useAppStore } from "../state/appStore.js";
import { createPlanWorkHourResolver } from "../utils/planWorkCalculator.js";

const IDISH_RE = /^[a-f0-9]{12,}$/i;
const TIMESTAMP_PIPE_RE = /^\d{10,}\|?$/;

function norm(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return norm(value).toUpperCase();
}

function looksLikeRawId(value) {
  const text = norm(value);
  return !!text && (IDISH_RE.test(text) || TIMESTAMP_PIPE_RE.test(text) || (text.length >= 18 && !/\s/.test(text)));
}

function findByIdentity(list = [], raw, extraFields = []) {
  const target = key(raw);
  if (!target) return null;
  const fields = [
    "id",
    "_id",
    "value",
    "key",
    "code",
    "name",
    "label",
    "title",
    "area",
    "serviceId",
    "shiftId",
    "shiftCode",
    "vardiyaKodu",
    "vardiya",
    "taskKey",
    "rowId",
    ...extraFields,
  ];
  return (Array.isArray(list) ? list : []).find((item) =>
    fields.some((field) => key(item?.[field]) === target)
  ) || null;
}

function recordLabel(item, preferred = []) {
  if (!item) return "";
  const fields = [
    ...preferred,
    "name",
    "label",
    "title",
    "area",
    "code",
    "shiftCode",
    "vardiyaKodu",
    "vardiya",
  ];
  for (const field of fields) {
    const value = norm(item?.[field]);
    if (value) return value;
  }
  return "";
}

function shiftCodeOf(item, fallback = "") {
  return norm(item?.code || item?.shiftCode || item?.vardiyaKodu || item?.vardiya || fallback);
}

function SkeletonText({ className = "" }) {
  return (
    <span
      className={`inline-block h-4 rounded bg-slate-200 align-middle animate-pulse ${className || "w-24"}`}
      aria-label="Yükleniyor"
    />
  );
}

export default function PersonProfileModal({ person, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { items: allServices = [] } = useServices();
  const workAreas = useAppStore((s) => s.workAreas);
  const workingHours = useAppStore((s) => s.workingHours);

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
  const resolveShiftHours = useMemo(
    () => createPlanWorkHourResolver(workingHours),
    [workingHours]
  );

  const enrichedAssignments = useMemo(() => {
    return assignments.map((assignment) => {
      const rawService = norm(assignment.serviceId || assignment.service || assignment.service_id);
      const rawShift = norm(
        assignment.shiftId ||
        assignment.shiftCode ||
        assignment.shift ||
        assignment.code ||
        assignment.vardiya
      );
      const rawRole = norm(
        assignment.roleId ||
        assignment.roleLabel ||
        assignment.taskKey ||
        assignment.rowLabel ||
        assignment.area ||
        assignment.rowId ||
        assignment.taskId
      );

      const service = findByIdentity(allServices, rawService, ["service"]);
      const shift = findByIdentity(workingHours, rawShift, ["hoursCode"]);
      const role = findByIdentity(workAreas, rawRole, ["roleId", "taskId"]);

      const serviceLabel = recordLabel(service, ["name"]) || (!looksLikeRawId(rawService) ? rawService : "");
      const shiftCode = shiftCodeOf(shift) || (!looksLikeRawId(rawShift) ? rawShift : "");
      const shiftLabel = recordLabel(shift, ["code", "name", "label"]) || (!looksLikeRawId(rawShift) ? rawShift : "");
      const roleLabel = recordLabel(role, ["label", "name", "area"]) || (!looksLikeRawId(rawRole) ? rawRole : "");

      const explicitHours = Number(assignment.hours);
      const resolvedHours = resolveShiftHours(shiftCode || rawShift, roleLabel || rawRole);
      const hours = Number.isFinite(explicitHours) && explicitHours > 0
        ? explicitHours
        : resolvedHours;

      return {
        ...assignment,
        _serviceRaw: rawService,
        _serviceLabel: serviceLabel,
        _servicePending: !!rawService && !serviceLabel && looksLikeRawId(rawService),
        _shiftRaw: rawShift,
        _shiftCode: shiftCode,
        _shiftLabel: shiftLabel,
        _shiftPending: !!rawShift && !shiftLabel && !shiftCode && looksLikeRawId(rawShift) && workingHours.length === 0,
        _roleRaw: rawRole,
        _roleLabel: roleLabel,
        _rolePending: !!rawRole && !roleLabel && looksLikeRawId(rawRole),
        _resolvedHours: Number.isFinite(hours) ? hours : 0,
        _hoursPending:
          !(Number.isFinite(hours) && hours > 0) &&
          !!rawShift &&
          !shift &&
          looksLikeRawId(rawShift),
      };
    });
  }, [assignments, allServices, workingHours, workAreas, resolveShiftHours]);

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const thisMonthStr = `${thisYear}-${String(thisMonth).padStart(2, "0")}`;

  const totalCount = enrichedAssignments.length;
  const thisMonthCount = enrichedAssignments.filter((a) =>
    (a.date || "").startsWith(thisMonthStr)
  ).length;
  const totalHours = enrichedAssignments.reduce((sum, a) => sum + (Number(a._resolvedHours) || 0), 0);

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
              {enrichedAssignments.length === 0 ? (
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
                      {enrichedAssignments.map((a, i) => (
                        <tr key={a._id || i} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-2.5 text-slate-700 font-medium tabular-nums">{a.date || "-"}</td>
                          <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate" title={a._serviceLabel || a._serviceRaw || "-"}>
                            {a._servicePending ? <SkeletonText /> : (a._serviceLabel || "-")}
                          </td>
                          <td className="px-4 py-2.5">
                            {a._shiftPending ? (
                              <SkeletonText className="w-14" />
                            ) : a._shiftCode || a._shiftLabel ? (
                              <span className="inline-flex items-center rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-xs font-medium text-sky-700">
                                {a._shiftCode || a._shiftLabel}
                              </span>
                            ) : "-"}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 text-xs max-w-xs truncate" title={a._roleLabel || a._roleRaw || "-"}>
                            {a._rolePending ? <SkeletonText /> : (a._roleLabel || "-")}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                            {a._hoursPending ? <SkeletonText className="w-10" /> : (a._resolvedHours || 0)}
                          </td>
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
