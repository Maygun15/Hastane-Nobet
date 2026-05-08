// src/components/QuickReplacePanel.jsx
// Acil vardiya değiştirme: gün → vardiya → ayrılan kişi → aday listesi → tek tıkla ata
import React, { useEffect, useMemo, useState } from "react";
import { UserCheck, X, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { assignSchedule, getSwapSuggestions } from "../api/apiAdapter.js";
import { fetchScheduleTruth } from "../utils/scheduleTruth.js";

const pad2 = (n) => String(n).padStart(2, "0");

function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

export default function QuickReplacePanel({
  open,
  onClose,
  sectionId = "calisma-cizelgesi",
  serviceId = "",
  scheduleRole = "",
  year,
  month,
  people = [],
  onAssigned,
}) {
  const month0 = Math.max(0, Math.min(11, Number(month) - 1 || 0));
  const totalDays = daysInMonth(year, month0 + 1);

  const [shiftDefs, setShiftDefs] = useState([]);
  const [defsLoading, setDefsLoading] = useState(false);

  const [selectedDay, setSelectedDay] = useState("");
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [departingPersonId, setDepartingPersonId] = useState("");

  const [candidates, setCandidates] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [assigning, setAssigning] = useState("");
  const [assignError, setAssignError] = useState("");
  const [assignedIds, setAssignedIds] = useState(new Set());

  // Reset state when panel opens
  useEffect(() => {
    if (!open) return;
    setSelectedDay("");
    setSelectedShiftId("");
    setDepartingPersonId("");
    setCandidates([]);
    setSearchError("");
    setAssignError("");
    setAssignedIds(new Set());
  }, [open]);

  // Load shift defs for the current month
  useEffect(() => {
    if (!open || !sectionId) return;
    let active = true;
    setDefsLoading(true);
    fetchScheduleTruth({ sectionId, serviceId, role: scheduleRole, year, month })
      .then((truth) => {
        if (!active) return;
        setShiftDefs(Array.isArray(truth?.defs) ? truth.defs : []);
      })
      .catch(() => {})
      .finally(() => { if (active) setDefsLoading(false); });
    return () => { active = false; };
  }, [open, sectionId, serviceId, scheduleRole, year, month]);

  const sortedPeople = useMemo(() => {
    return [...people]
      .filter((p) => p?.id && (p.name || p.fullName))
      .map((p) => ({ id: String(p.id), name: String(p.name || p.fullName || p.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
  }, [people]);

  const selectedDate = useMemo(() => {
    if (!selectedDay) return "";
    return `${year}-${pad2(month0 + 1)}-${pad2(Number(selectedDay))}`;
  }, [year, month0, selectedDay]);

  const canSearch = !!selectedDate && !!selectedShiftId && !!departingPersonId;

  const handleSearch = async () => {
    if (!canSearch) return;
    setSearchLoading(true);
    setSearchError("");
    setCandidates([]);
    setAssignError("");
    setAssignedIds(new Set());
    try {
      const result = await getSwapSuggestions({
        personId: departingPersonId,
        date: selectedDate,
        shiftId: selectedShiftId,
        serviceId: serviceId || undefined,
        limit: 10,
      });
      setCandidates(Array.isArray(result?.suggestions) ? result.suggestions : []);
      if (!result?.suggestions?.length) {
        setSearchError("Bu vardiya için uygun aday bulunamadı.");
      }
    } catch (err) {
      setSearchError(err?.message || "Aday arama başarısız.");
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAssign = async (candidate) => {
    if (!selectedDate || !selectedShiftId) return;
    setAssigning(candidate.personId);
    setAssignError("");
    try {
      await assignSchedule({
        sectionId,
        serviceId,
        role: scheduleRole,
        date: selectedDate,
        shiftId: selectedShiftId,
        shiftCode: selectedShiftId,
        personId: candidate.personId,
        personName: candidate.personName,
      });
      setAssignedIds((prev) => new Set([...prev, candidate.personId]));
      onAssigned?.();
    } catch (err) {
      if (err?.status === 409 && err?.body?.canForce) {
        setAssignError(`${candidate.personName}: Kural ihlali — override diyaloğundan kaydediniz.`);
      } else {
        setAssignError(err?.message || "Atama başarısız.");
      }
    } finally {
      setAssigning("");
    }
  };

  const selectedShiftLabel = useMemo(() => {
    const def = shiftDefs.find((d) => (d.id || d.rowId) === selectedShiftId || d.shiftCode === selectedShiftId);
    return def?.label || selectedShiftId;
  }, [shiftDefs, selectedShiftId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UserCheck className="text-blue-500" size={18} />
            <h2 className="font-semibold text-slate-800 text-sm">Hızlı Yerine Atama</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Step 1: Day */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Gün</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={selectedDay}
                onChange={(e) => { setSelectedDay(e.target.value); setCandidates([]); }}
              >
                <option value="">— gün seçin —</option>
                {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {/* Step 2: Shift */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Vardiya {defsLoading && <Loader2 size={11} className="inline animate-spin ml-1" />}
              </label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={selectedShiftId}
                onChange={(e) => { setSelectedShiftId(e.target.value); setCandidates([]); }}
              >
                <option value="">— vardiya seçin —</option>
                {shiftDefs.map((def) => {
                  const id = def.id || def.rowId || def.shiftCode;
                  return (
                    <option key={id} value={id}>
                      {def.label || def.shiftCode || id}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Step 3: Departing person */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ayrılan / Değiştirilen Kişi</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={departingPersonId}
              onChange={(e) => { setDepartingPersonId(e.target.value); setCandidates([]); }}
            >
              <option value="">— kişi seçin —</option>
              {sortedPeople.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Search button */}
          <button
            className="flex items-center gap-2 w-full justify-center px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors"
            onClick={handleSearch}
            disabled={!canSearch || searchLoading}
          >
            {searchLoading
              ? <Loader2 size={14} className="animate-spin" />
              : <RefreshCw size={14} />}
            Aday Ara
          </button>

          {/* Search error */}
          {searchError && (
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {searchError}
            </div>
          )}

          {/* Candidate list */}
          {candidates.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                Uygun Adaylar — {selectedDate} / {selectedShiftLabel}
              </p>
              {candidates.map((c) => {
                const done = assignedIds.has(c.personId);
                return (
                  <div
                    key={c.personId}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${done ? "bg-green-50" : "bg-slate-50 hover:bg-slate-100"} transition-colors`}
                  >
                    <div>
                      <span className="font-medium text-slate-800">{c.personName}</span>
                      {c.serviceId && (
                        <span className="ml-2 text-xs text-slate-500">{c.serviceId}</span>
                      )}
                      <span className="ml-2 text-xs text-slate-400">{c.shiftCount} nöbet</span>
                    </div>
                    {done ? (
                      <span className="text-xs text-green-600 font-medium">Atandı ✓</span>
                    ) : (
                      <button
                        className="px-3 py-1 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors"
                        onClick={() => handleAssign(c)}
                        disabled={assigning === c.personId}
                      >
                        {assigning === c.personId
                          ? <Loader2 size={11} className="animate-spin" />
                          : "Ata"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Assign error */}
          {assignError && (
            <div className="text-sm text-rose-600">{assignError}</div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-200 transition-colors"
            onClick={onClose}
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
