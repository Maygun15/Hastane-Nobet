import React, { useEffect, useMemo, useState } from "react";
import { UserCheck, X, Loader2, RefreshCw, AlertCircle, ShieldAlert } from "lucide-react";
import { assignSchedule, getSwapSuggestions } from "../api/apiAdapter.js";
import { fetchScheduleTruth } from "../utils/scheduleTruth.js";

const pad2 = (n) => String(n).padStart(2, "0");

function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

// Bir vardiya dinlenme gerektiriyor mu? (8 saatten uzun veya gece geçen)
function isLongOrNightShift(assignment) {
  const hours = Number(assignment?.hours ?? 0);
  if (hours > 8) return true;
  const code = String(assignment?.shiftCode || '').toUpperCase();
  if (['N', 'V1', 'V2', 'SV', 'GECE'].includes(code)) return true;
  // Saat bazlı kontrol: bitiş ≤ başlangıç → gece geçiyor
  const start = String(assignment?.startHour ?? assignment?.startTime ?? '');
  const end   = String(assignment?.endHour   ?? assignment?.endTime   ?? '');
  if (start && end) {
    const sh = parseInt(start, 10);
    const eh = parseInt(end, 10);
    if (!isNaN(sh) && !isNaN(eh) && eh <= sh) return true;
  }
  return false;
}

// Bir önceki ve bir sonraki günün tarih string'ini döner
function adjacentDate(dateStr, offset) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function slotKeyOf(slot = {}) {
  return String(slot?.key || slot?.rowId || slot?.shiftId || `${slot?.taskLabel || ""}::${slot?.shiftCode || ""}`);
}

function personOptionKey(person = {}) {
  const id = String(person?.id || "").trim();
  const name = String(person?.name || "").trim();
  return id || (name ? `name:${name}` : "");
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
        .filter((person) => person.name)
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
  preferredPerson = null,
  preferredAssignments = [],
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
  const [recommendedCandidates, setRecommendedCandidates] = useState([]);
  const [samePositionAlternatives, setSamePositionAlternatives] = useState([]);
  const [recommendationText, setRecommendationText] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [pendingAutoSearch, setPendingAutoSearch] = useState(false);

  const [assigning, setAssigning] = useState("");
  const [assignError, setAssignError] = useState("");
  const [assignedIds, setAssignedIds] = useState(new Set());
  const [overrideDialog, setOverrideDialog] = useState(null); // { candidate, message, conflictType }

  useEffect(() => {
    if (!open) return;
    setSelectedDay("");
    setSelectedTaskLabel("");
    setSelectedSlotKey("");
    setDepartingPersonId("");
    setResultSlot(null);
    setResultCurrentPerson(null);
    setCandidates([]);
    setRecommendedCandidates([]);
    setSamePositionAlternatives([]);
    setRecommendationText("");
    setSearchError("");
    setAssignError("");
    setAssignedIds(new Set());
    setOverrideDialog(null);
    setPendingAutoSearch(false);
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

  const fallbackPreferredPeople = useMemo(() => {
    if (!selectedDate || !selectedSlot) return [];
    const wantedTask = String(selectedSlot?.taskLabel || selectedTaskLabel || "").trim();
    const wantedShift = String(selectedSlot?.shiftCode || "").trim().toUpperCase();
    const matched = (Array.isArray(preferredAssignments) ? preferredAssignments : []).filter((item) => {
      const itemDate = String(item?.date || item?.day || "").slice(0, 10);
      if (itemDate !== selectedDate) return false;
      const itemTask = String(item?.roleLabel || item?.rowLabel || item?.label || item?.area || "").trim();
      const itemShift = String(item?.shiftCode || item?.shift || item?.code || "").trim().toUpperCase();
      if (wantedTask && itemTask !== wantedTask) return false;
      if (wantedShift && itemShift !== wantedShift) return false;
      return true;
    });
    const seen = new Set();
    return matched
      .map((item) => ({
        id: String(item?.personId || preferredPerson?.id || "").trim(),
        name: String(item?.personName || item?.name || preferredPerson?.name || "").trim(),
      }))
      .filter((person) => person.name)
      .filter((person) => {
        const key = personOptionKey(person);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [preferredAssignments, preferredPerson, selectedDate, selectedSlot, selectedTaskLabel]);

  const departingPeople = useMemo(() => {
    if (initialSelection?.autoSearch) {
      const person = initialSelection?.personName
        ? { id: String(initialSelection.personId || ""), name: String(initialSelection.personName) }
        : preferredPerson?.name
        ? { id: String(preferredPerson.id || ""), name: String(preferredPerson.name) }
        : null;
      if (person) return [person];
    }
    const slotPeople = Array.isArray(selectedSlot?.people) ? selectedSlot.people : [];
    if (slotPeople.length > 0) return slotPeople;
    if (fallbackPreferredPeople.length > 0) return fallbackPreferredPeople;
    if (selectedSlot && preferredPerson?.name) {
      return [{ id: String(preferredPerson.id || ""), name: String(preferredPerson.name) }];
    }
    return [];
  }, [selectedSlot, fallbackPreferredPeople, initialSelection, preferredPerson]);
  const departingPerson = useMemo(
    () => departingPeople.find((person) => personOptionKey(person) === departingPersonId) || null,
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
    if (match) {
      setDepartingPersonId(personOptionKey(match));
    } else if (departingPeople.length === 1) {
      setDepartingPersonId(personOptionKey(departingPeople[0]));
    }
  }, [open, initialSelection, departingPeople, departingPersonId]);

  useEffect(() => {
    if (!open || initialSelection || !departingPeople.length || departingPersonId) return;
    const preferredId = String(preferredPerson?.id || "").trim();
    const preferredName = String(preferredPerson?.name || "").trim();
    const exact = departingPeople.find((person) => {
      if (preferredId && person.id && person.id === preferredId) return true;
      if (preferredName && person.name === preferredName) return true;
      return false;
    });
    const picked = exact || (departingPeople.length === 1 ? departingPeople[0] : null);
    if (!picked) return;
    setDepartingPersonId(personOptionKey(picked));
    setPendingAutoSearch(true);
  }, [open, initialSelection, departingPeople, departingPersonId, preferredPerson]);

  const handleSearch = async () => {
    if (!canSearch || !selectedSlot || !departingPerson) return;
    setSearchLoading(true);
    setSearchError("");
    setAssignError("");
    setAssignedIds(new Set());
    setCandidates([]);
    setRecommendedCandidates([]);
    setSamePositionAlternatives([]);
    setRecommendationText("");
    try {
      const result = await getSwapSuggestions({
        personId: String(departingPerson.id || "").trim() || undefined,
        currentPersonName: departingPerson.name,
        date: selectedDate,
        shiftId: selectedSlot.rowId || selectedSlot.shiftId || selectedSlot.shiftCode,
        roleLabel: selectedSlot.taskLabel,
        serviceId: selectedSlot.serviceId || serviceId || undefined,
        role: scheduleRole || undefined,
        sectionId,
        limit: 100,
      });
      setResultSlot(result?.slot || null);
      setResultCurrentPerson(result?.currentPerson || null);
      setCandidates(Array.isArray(result?.candidates) ? result.candidates : []);
      setRecommendedCandidates(Array.isArray(result?.recommendedCandidates) ? result.recommendedCandidates : []);
      setSamePositionAlternatives(Array.isArray(result?.samePositionAlternatives) ? result.samePositionAlternatives : []);
      setRecommendationText(String(result?.recommendationText || "").trim());
      if (result?.message) {
        setSearchError(result.message);
      } else if (!result?.candidates?.length) {
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

  useEffect(() => {
    if (!open || !pendingAutoSearch) return;
    if (!canSearch || searchLoading || candidates.length > 0 || searchError) return;
    setPendingAutoSearch(false);
    handleSearch();
  }, [open, pendingAutoSearch, canSearch, searchLoading, candidates.length, searchError]);

  const groupedCandidates = useMemo(() => {
    const recommendedIds = new Set(
      (Array.isArray(recommendedCandidates) ? recommendedCandidates : [])
        .map((item) => item.id)
        .filter(Boolean)
    );
    const samePositionIds = new Set(
      (Array.isArray(samePositionAlternatives) ? samePositionAlternatives : [])
        .map((item) => item.id)
        .filter(Boolean)
    );
    const others = (Array.isArray(candidates) ? candidates : []).filter(
      (item) => !recommendedIds.has(item.id) && !samePositionIds.has(item.id)
    );
    return {
      recommended: Array.isArray(recommendedCandidates) ? recommendedCandidates : [],
      samePosition: Array.isArray(samePositionAlternatives) ? samePositionAlternatives : [],
      others,
    };
  }, [candidates, recommendedCandidates, samePositionAlternatives]);

  const handleAssign = async (candidate, forceOverride = false) => {
    if (!selectedDate || !selectedSlot || !departingPerson) return;
    setAssignError("");

    // ── Dinlenme Hali Kontrolü (force ile atlanır) ──────────────────
    if (!forceOverride) {
      const prevDate = adjacentDate(selectedDate, -1);
      const nextDate = adjacentDate(selectedDate, +1);

      const candidateAssignments = (truthAssignments || []).filter(
        (a) => String(a.personId || a.personName || '') === String(candidate.id || candidate.name || '')
          || String(a.personName || '') === String(candidate.name || '')
      );

      const prevLong = candidateAssignments.find(
        (a) => String(a.date || '').slice(0, 10) === prevDate && isLongOrNightShift(a)
      );
      const nextAssignment = candidateAssignments.find(
        (a) => String(a.date || '').slice(0, 10) === nextDate
      );
      const todayIsLong = isLongOrNightShift({ shiftCode: selectedSlot.shiftCode, hours: selectedSlot.hours });

      if (prevLong) {
        setAssignError(
          `⛔ ${candidate.name} dün (${prevDate}) uzun/gece nöbeti yaptı — dinlenme hali bitmeden atama yapılamaz.`
        );
        return;
      }
      if (todayIsLong && nextAssignment) {
        setAssignError(
          `⛔ ${candidate.name} bu uzun/gece nöbetinin ardından ertesi gün (${nextDate}) zaten atanmış — dinlenme hali ihlal edilir.`
        );
        return;
      }
    }
    // ───────────────────────────────────────────────────────────────

    setAssigning(candidate.id);
    const assignPayload = {
      sectionId,
      serviceId: selectedSlot.serviceId || serviceId,
      role: scheduleRole,
      date: selectedDate,
      rowId: selectedSlot.rowId || selectedSlot.shiftId || selectedSlot.shiftCode,
      shiftId: selectedSlot.rowId || selectedSlot.shiftId || selectedSlot.shiftCode,
      shiftCode: selectedSlot.shiftCode,
      replacePersonId: departingPerson.id,
      replacePersonName: departingPerson.name,
      replaceShiftId: selectedSlot.rowId || selectedSlot.shiftId || selectedSlot.shiftCode,
      replaceShiftCode: selectedSlot.shiftCode,
      replaceRoleLabel: selectedSlot.taskLabel,
      personId: candidate.id,
      personName: candidate.name,
      roleLabel: selectedSlot.taskLabel,
      ...(forceOverride ? { force: true, overrideReason: "admin_manual_override" } : {}),
    };

    try {
      await assignSchedule(assignPayload);
      setAssignedIds((prev) => new Set([...prev, candidate.id]));
      setOverrideDialog(null);
      window.dispatchEvent(new CustomEvent('schedule:changed', { detail: { source: 'quickReplace', date: selectedDate } }));
      onAssigned?.();
    } catch (err) {
      if (err?.status === 409 && !forceOverride) {
        // Kapasite doluysa force da işe yaramaz — doğrudan hata göster
        const isCapacity = err?.data?.errors?.[0]?.type === 'SHIFT_CAPACITY';
        if (isCapacity) {
          setAssignError(err?.message || "Bu satır dolu.");
        } else {
          setOverrideDialog({
            candidate,
            message: err?.data?.message || err?.message || "Kural ihlali tespit edildi.",
            conflictType: err?.data?.conflictType || "RULE_VIOLATION",
          });
        }
      } else {
        setAssignError(err?.message || "Yerine atama başarısız.");
      }
    } finally {
      setAssigning("");
    }
  };

  if (!open) return null;

  const isInitialLoading = !!initialSelection?.autoSearch && truthLoading && !searchError && candidates.length === 0;

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

        {isInitialLoading && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500">
            <Loader2 size={28} className="animate-spin text-blue-400" />
            <span className="text-sm">Adaylar yükleniyor…</span>
          </div>
        )}

        <div className={`px-5 py-4 space-y-4 overflow-y-auto flex-1 ${isInitialLoading ? "hidden" : ""}`}>
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
                  <option key={personOptionKey(person)} value={personOptionKey(person)}>
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

          {recommendationText ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {recommendationText}
            </div>
          ) : null}

          {resultSlot && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <div><span className="font-medium">Tarih:</span> {resultSlot.date}</div>
              <div><span className="font-medium">Görev:</span> {resultSlot.taskLabel || "-"}</div>
              <div><span className="font-medium">Vardiya:</span> {resultSlot.shiftCode || "-"}</div>
              <div><span className="font-medium">Ayrılan Kişi:</span> {resultCurrentPerson?.name || departingPerson?.name || "-"}</div>
            </div>
          )}

          {candidates.length > 0 && (
            <div className="space-y-4">
              {[
                { key: "recommended", title: "Önerilenler", items: groupedCandidates.recommended },
                { key: "same-position", title: "Aynı Pozisyon İçin Yakın Alternatifler", items: groupedCandidates.samePosition },
                { key: "others", title: "Diğer Değerlendirilebilir Adaylar", items: groupedCandidates.others },
              ].map((group) => (
                group.items.length > 0 ? (
                  <div key={group.key} className="space-y-2">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{group.title}</p>
                    {group.items.map((candidate) => {
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
                          ) : candidate.eligible === false ? (
                            <span className="text-xs text-amber-700 font-medium">
                              {candidate.recommendationTier === "same_position_blocked" ? "Yakın alternatif" : "Uygun değil"}
                            </span>
                          ) : (
                            <button
                              className="ml-3 px-3 py-1 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors"
                              onClick={() => handleAssign(candidate)}
                              disabled={assigning === candidate.id || candidate.eligible === false}
                            >
                              {assigning === candidate.id ? <Loader2 size={11} className="animate-spin" /> : "Ata"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null
              ))}
            </div>
          )}

          {assignError && <div className="text-sm text-rose-600">{assignError}</div>}

          {overrideDialog && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <ShieldAlert size={16} className="text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Kural İhlali Tespit Edildi</p>
                  <p className="text-sm text-amber-700 mt-1">{overrideDialog.message}</p>
                </div>
              </div>
              <p className="text-sm text-slate-700">Yine de zorla atamak istiyor musunuz?</p>
              <div className="flex gap-2">
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors"
                  onClick={() => handleAssign(overrideDialog.candidate, true)}
                  disabled={!!assigning}
                >
                  {assigning ? <Loader2 size={12} className="animate-spin" /> : null}
                  Evet, Zorla Ata
                </button>
                <button
                  className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                  onClick={() => setOverrideDialog(null)}
                  disabled={!!assigning}
                >
                  Vazgeç
                </button>
              </div>
            </div>
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
