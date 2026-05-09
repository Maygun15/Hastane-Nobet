import React, { useEffect, useMemo, useState } from "react";
import { UserCheck, X, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { assignSchedule, getSwapSuggestions, unassignSchedule } from "../api/apiAdapter.js";
import { fetchScheduleTruth } from "../utils/scheduleTruth.js";

const pad2 = (n) => String(n).padStart(2, "0");

function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

function slotKeyOf(slot = {}) {
  return String(slot?.key || slot?.rowId || slot?.shiftId || `${slot?.taskLabel || ""}::${slot?.shiftCode || ""}`);
}

function buildSlotGroups(assignments = [], defs = [], selectedDate = "") {
  if (!selectedDate) return [];
  const defMap = new Map(
    (Array.isArray(defs) ? defs : []).map((def) => [
      String(def?.id || def?.rowId || def?.shiftCode || "").trim(),
      def,
    ])
  );
  const groups = new Map();

  for (const item of Array.isArray(assignments) ? assignments : []) {
    const date = String(item?.date || item?.day || "").slice(0, 10);
    if (date !== selectedDate) continue;

    const rowId = String(item?.rowId || item?.shiftId || "").trim();
    const shiftId = String(item?.shiftId || item?.rowId || "").trim();
    const def = defMap.get(rowId) || defMap.get(shiftId) || null;
    const taskLabel = String(item?.roleLabel || def?.label || "").trim();
    const shiftCode = String(item?.shiftCode || def?.shiftCode || def?.code || "").trim();
    const key = String(rowId || shiftId || `${taskLabel}::${shiftCode}`).trim();
    if (!key) continue;

    const current = groups.get(key) || {
      key,
      rowId: rowId || shiftId,
      shiftId: shiftId || rowId,
      taskLabel,
      shiftCode,
      serviceId: String(item?.serviceId || "").trim(),
      people: [],
    };
    current.taskLabel = current.taskLabel || taskLabel;
    current.shiftCode = current.shiftCode || shiftCode;
    current.serviceId = current.serviceId || String(item?.serviceId || "").trim();
    current.people.push({
      id: String(item?.personId || "").trim(),
      name: String(item?.personName || item?.name || "").trim(),
    });
    groups.set(key, current);
  }

  return Array.from(groups.values())
    .map((slot) => ({
      ...slot,
      people: slot.people
        .filter((person) => person.id && person.name)
        .sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" })),
    }))
    .filter((slot) => slot.taskLabel || slot.shiftCode)
    .sort((a, b) => {
      const taskCmp = String(a.taskLabel || "").localeCompare(String(b.taskLabel || ""), "tr", { sensitivity: "base" });
      if (taskCmp !== 0) return taskCmp;
      return String(a.shiftCode || "").localeCompare(String(b.shiftCode || ""), "tr", { sensitivity: "base" });
    });
}

export default function QuickReplacePanel({
  open,
  onClose,
  sectionId = "calisma-cizelgesi",
  serviceId = "",
  scheduleRole = "",
  year,
  month,
  onAssigned,
  initialSelection = null,
}) {
  const month0 = Math.max(0, Math.min(11, Number(month) - 1 || 0));
  const totalDays = daysInMonth(year, month0 + 1);

  const [truthDefs, setTruthDefs] = useState([]);
  const [truthAssignments, setTruthAssignments] = useState([]);
  const [truthLoading, setTruthLoading] = useState(false);

  const [selectedDay, setSelectedDay] = useState("");
  const [selectedTaskLabel, setSelectedTaskLabel] = useState("");
  const [selectedSlotKey, setSelectedSlotKey] = useState("");
  const [departingPersonId, setDepartingPersonId] = useState("");

  const [resultSlot, setResultSlot] = useState(null);
  const [resultCurrentPerson, setResultCurrentPerson] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [assigning, setAssigning] = useState("");
  const [assignError, setAssignError] = useState("");
  const [assignedIds, setAssignedIds] = useState(new Set());

  useEffect(() => {
    if (!open) return;
    setSelectedDay("");
    setSelectedTaskLabel("");
    setSelectedSlotKey("");
    setDepartingPersonId("");
    setResultSlot(null);
    setResultCurrentPerson(null);
    setCandidates([]);
    setSearchError("");
    setAssignError("");
    setAssignedIds(new Set());
  }, [open]);

  useEffect(() => {
    if (!open || !initialSelection) return;
    const day = Number(String(initialSelection?.date || "").slice(8, 10));
    if (Number.isFinite(day) && day > 0) setSelectedDay(String(day));
  }, [open, initialSelection]);

  useEffect(() => {
    if (!open || !sectionId) return;
    let active = true;
    setTruthLoading(true);
    fetchScheduleTruth({
      sectionId,
      serviceId,
      role: scheduleRole,
      year,
      month,
      options: { preferScheduleReadModel: true },
    })
      .then((truth) => {
        if (!active) return;
        setTruthDefs(Array.isArray(truth?.defs) ? truth.defs : []);
        setTruthAssignments(Array.isArray(truth?.assignments) ? truth.assignments : []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setTruthLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, sectionId, serviceId, scheduleRole, year, month]);

  const selectedDate = useMemo(() => {
    if (!selectedDay) return "";
    return `${year}-${pad2(month0 + 1)}-${pad2(Number(selectedDay))}`;
  }, [year, month0, selectedDay]);

  const daySlots = useMemo(
    () => buildSlotGroups(truthAssignments, truthDefs, selectedDate),
    [truthAssignments, truthDefs, selectedDate]
  );

  const taskOptions = useMemo(() => {
    return Array.from(new Set(daySlots.map((slot) => String(slot.taskLabel || "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "tr", { sensitivity: "base" })
    );
  }, [daySlots]);

  const slotOptions = useMemo(() => {
    return daySlots.filter((slot) => {
      if (!selectedTaskLabel) return true;
      return String(slot.taskLabel || "") === String(selectedTaskLabel || "");
    });
  }, [daySlots, selectedTaskLabel]);

  const selectedSlot = useMemo(
    () => slotOptions.find((slot) => slotKeyOf(slot) === selectedSlotKey) || null,
    [slotOptions, selectedSlotKey]
  );

  const departingPeople = useMemo(() => selectedSlot?.people || [], [selectedSlot]);
  const departingPerson = useMemo(
    () => departingPeople.find((person) => person.id === departingPersonId) || null,
    [departingPeople, departingPersonId]
  );

  const canSearch = !!selectedDate && !!selectedSlot && !!departingPerson;

  useEffect(() => {
    if (!open || !initialSelection || !selectedDate || !slotOptions.length) return;
    const wantedTask = String(initialSelection?.taskLabel || "").trim();
    if (wantedTask && !selectedTaskLabel) {
      const exists = taskOptions.find((label) => label === wantedTask);
      if (exists) {
        setSelectedTaskLabel(exists);
        return;
      }
    }
    if (!selectedTaskLabel && wantedTask) return;

    const wantedRowId = String(initialSelection?.rowId || initialSelection?.shiftId || "").trim();
    const wantedShiftCode = String(initialSelection?.shiftCode || "").trim().toUpperCase();
    if (!selectedSlotKey) {
      const match = slotOptions.find((slot) => {
        const slotRowId = String(slot?.rowId || slot?.shiftId || "").trim();
        const slotShiftCode = String(slot?.shiftCode || "").trim().toUpperCase();
        if (wantedRowId && slotRowId && slotRowId === wantedRowId) return true;
        if (wantedShiftCode && slotShiftCode && slotShiftCode === wantedShiftCode) return true;
        return false;
      });
      if (match) {
        setSelectedSlotKey(slotKeyOf(match));
        return;
      }
    }
  }, [open, initialSelection, selectedDate, slotOptions, selectedSlotKey, selectedTaskLabel, taskOptions]);

  useEffect(() => {
    if (!open || !initialSelection || !departingPeople.length) return;
    if (departingPersonId) return;
    const wantedPersonId = String(initialSelection?.personId || "").trim();
    const wantedPersonName = String(initialSelection?.personName || "").trim();
    const match = departingPeople.find((person) => {
      if (wantedPersonId && person.id === wantedPersonId) return true;
      if (wantedPersonName && person.name === wantedPersonName) return true;
      return false;
    });
    if (match) setDepartingPersonId(match.id);
  }, [open, initialSelection, departingPeople, departingPersonId]);

  const handleSearch = async () => {
    if (!canSearch || !selectedSlot || !departingPerson) return;
    setSearchLoading(true);
    setSearchError("");
    setAssignError("");
    setAssignedIds(new Set());
    setCandidates([]);
    try {
      const result = await getSwapSuggestions({
        personId: departingPerson.id,
        currentPersonName: departingPerson.name,
        date: selectedDate,
        shiftId: selectedSlot.rowId || selectedSlot.shiftId || selectedSlot.shiftCode,
        roleLabel: selectedSlot.taskLabel,
        serviceId: selectedSlot.serviceId || serviceId || undefined,
        role: scheduleRole || undefined,
        sectionId,
        limit: 12,
      });
      setResultSlot(result?.slot || null);
      setResultCurrentPerson(result?.currentPerson || null);
      setCandidates(Array.isArray(result?.candidates) ? result.candidates : []);
      if (!result?.candidates?.length) {
        setSearchError("Bu slot için uygun aday bulunamadı.");
      }
    } catch (err) {
      setSearchError(err?.message || "Aday arama başarısız.");
    } finally {
      setSearchLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !initialSelection?.autoSearch) return;
    if (!canSearch || searchLoading || candidates.length > 0 || searchError) return;
    handleSearch();
  }, [open, initialSelection, canSearch, searchLoading, candidates.length, searchError]);

  const handleAssign = async (candidate) => {
    if (!selectedDate || !selectedSlot || !departingPerson) return;
    setAssigning(candidate.id);
    setAssignError("");
    const unassignPayload = {
      sectionId,
      serviceId: selectedSlot.serviceId || serviceId,
      role: scheduleRole,
      date: selectedDate,
      shiftId: selectedSlot.rowId || selectedSlot.shiftId || selectedSlot.shiftCode,
      shiftCode: selectedSlot.shiftCode,
      personId: departingPerson.id,
      personName: departingPerson.name,
      roleLabel: selectedSlot.taskLabel,
    };
    const assignPayload = {
      sectionId,
      serviceId: selectedSlot.serviceId || serviceId,
      role: scheduleRole,
      date: selectedDate,
      shiftId: selectedSlot.rowId || selectedSlot.shiftId || selectedSlot.shiftCode,
      shiftCode: selectedSlot.shiftCode,
      personId: candidate.id,
      personName: candidate.name,
      roleLabel: selectedSlot.taskLabel,
    };

    try {
      await unassignSchedule(unassignPayload);
      try {
        await assignSchedule(assignPayload);
      } catch (assignErr) {
        try {
          await assignSchedule(unassignPayload);
        } catch {
          // best-effort rollback only
        }
        throw assignErr;
      }
      setAssignedIds((prev) => new Set([...prev, candidate.id]));
      onAssigned?.();
    } catch (err) {
      setAssignError(err?.message || "Yerine atama başarısız.");
    } finally {
      setAssigning("");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UserCheck className="text-blue-500" size={18} />
            <h2 className="font-semibold text-slate-800 text-sm">Hızlı Yerine Atama</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tarih</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={selectedDay}
                onChange={(e) => {
                  setSelectedDay(e.target.value);
                  setSelectedTaskLabel("");
                  setSelectedSlotKey("");
                  setDepartingPersonId("");
                  setResultSlot(null);
                  setResultCurrentPerson(null);
                  setCandidates([]);
                }}
              >
                <option value="">— gün seçin —</option>
                {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {`${pad2(d)}.${pad2(month0 + 1)}.${year}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Görev</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={selectedTaskLabel}
                onChange={(e) => {
                  setSelectedTaskLabel(e.target.value);
                  setSelectedSlotKey("");
                  setDepartingPersonId("");
                  setResultSlot(null);
                  setResultCurrentPerson(null);
                  setCandidates([]);
                }}
                disabled={!selectedDate || truthLoading}
              >
                <option value="">— görev seçin —</option>
                {taskOptions.map((taskLabel) => (
                  <option key={taskLabel} value={taskLabel}>
                    {taskLabel}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Vardiya {truthLoading && <Loader2 size={11} className="inline animate-spin ml-1" />}
              </label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={selectedSlotKey}
                onChange={(e) => {
                  setSelectedSlotKey(e.target.value);
                  setDepartingPersonId("");
                  setResultSlot(null);
                  setResultCurrentPerson(null);
                  setCandidates([]);
                }}
                disabled={!selectedTaskLabel || truthLoading}
              >
                <option value="">— vardiya seçin —</option>
                {slotOptions.map((slot) => (
                  <option key={slot.key} value={slot.key}>
                    {slot.shiftCode || "—"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ayrılan Kişi</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={departingPersonId}
                onChange={(e) => {
                  setDepartingPersonId(e.target.value);
                  setResultSlot(null);
                  setResultCurrentPerson(null);
                  setCandidates([]);
                }}
                disabled={!selectedSlot}
              >
                <option value="">— kişi seçin —</option>
                {departingPeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            className="flex items-center gap-2 w-full justify-center px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors"
            onClick={handleSearch}
            disabled={!canSearch || searchLoading}
          >
            {searchLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Aday Ara
          </button>

          {searchError && (
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {searchError}
            </div>
          )}

          {resultSlot && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <div><span className="font-medium">Tarih:</span> {resultSlot.date}</div>
              <div><span className="font-medium">Görev:</span> {resultSlot.taskLabel || "-"}</div>
              <div><span className="font-medium">Vardiya:</span> {resultSlot.shiftCode || "-"}</div>
              <div><span className="font-medium">Ayrılan Kişi:</span> {resultCurrentPerson?.name || departingPerson?.name || "-"}</div>
            </div>
          )}

          {candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Uygun Adaylar</p>
              {candidates.map((candidate) => {
                const done = assignedIds.has(candidate.id);
                return (
                  <div
                    key={candidate.id}
                    className={`flex items-center justify-between rounded-lg px-3 py-3 text-sm border ${
                      done ? "bg-green-50 border-green-200" : "bg-white border-slate-200 hover:bg-slate-50"
                    } transition-colors`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 truncate">{candidate.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {candidate.title ? <span>{candidate.title}</span> : null}
                        {candidate.service ? <span>{candidate.service}</span> : null}
                        <span>Bu ay {candidate.monthlyShiftCount} nöbet</span>
                      </div>
                      {Array.isArray(candidate.warnings) && candidate.warnings.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {candidate.warnings.map((warning) => (
                            <span key={warning} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              {warning}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {done ? (
                      <span className="text-xs text-green-600 font-medium">Atandı ✓</span>
                    ) : (
                      <button
                        className="ml-3 px-3 py-1 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors"
                        onClick={() => handleAssign(candidate)}
                        disabled={assigning === candidate.id}
                      >
                        {assigning === candidate.id ? <Loader2 size={11} className="animate-spin" /> : "Ata"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {assignError && <div className="text-sm text-rose-600">{assignError}</div>}
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
