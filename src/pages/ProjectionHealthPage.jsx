import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Database,
  FileClock,
  RefreshCw,
} from "lucide-react";
import {
  getAssignmentsForMonth,
  getGeneratedSchedule,
  getMonthlySchedule,
} from "../api/apiAdapter.js";
import {
  collectSourceScheduleIds,
  compareScope,
  eventScopeMatches,
  generateProjectionDiagnostics,
  getMaxAssignmentUpdatedAt,
} from "../utils/projectionHealth.js";

const SECTION_OPTIONS = [
  { id: "calisma-cizelgesi", label: "Çalışma Çizelgesi" },
  { id: "aylik-calisma-ve-mesai-saatleri-cizelgesi", label: "Aylık Çalışma ve Mesai" },
  { id: "fazla-mesai-takip", label: "Fazla Mesai Takip" },
  { id: "toplu-izin-listesi", label: "Toplu İzin Listesi" },
];

const ROLE_OPTIONS = [
  { id: "Nurse", label: "Hemşire" },
  { id: "Doctor", label: "Doktor" },
];

const EMPTY_RESULT = {
  monthly: null,
  generated: null,
  assignments: [],
  errors: {},
};

function formatDateTime(value) {
  if (!value) return "Not observed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not observed";
  return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

function formatScope(scope = {}) {
  return [
    scope.sectionId,
    scope.serviceId,
    scope.role,
    scope.year && scope.month ? `${scope.year}-${String(scope.month).padStart(2, "0")}` : null,
  ].filter(Boolean).join(" / ") || "Scope could not be verified";
}

function readReturnedScope(source) {
  if (!source) return null;
  return {
    sectionId: source.sectionId,
    serviceId: source.serviceId,
    role: source.role,
    year: source.year,
    month: source.month,
  };
}

function StatusBadge({ available, unavailable = false }) {
  const text = unavailable ? "Data unavailable" : available ? "Available" : "Not observed";
  const classes = unavailable
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : available
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${classes}`}>
      {text}
    </span>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="grid gap-1 border-t border-slate-100 py-2.5 sm:grid-cols-[155px_minmax(0,1fr)]">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-words text-sm text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>
        {value || "Not observed"}
      </dd>
    </div>
  );
}

function SourcePanel({ icon: Icon, title, status, children, warning }) {
  return (
    <section className="border-b border-slate-200 bg-white py-5 last:border-b-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
            <Icon className="h-4 w-4" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        </div>
        {status}
      </div>
      {warning ? (
        <div className="mb-3 flex gap-2 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warning}</span>
        </div>
      ) : null}
      <dl>{children}</dl>
    </section>
  );
}

export default function ProjectionHealthPage({ activeYM }) {
  const now = new Date();
  const initialYear = activeYM && /^\d{4}-\d{2}$/.test(activeYM)
    ? Number(activeYM.slice(0, 4))
    : now.getFullYear();
  const initialMonth = activeYM && /^\d{4}-\d{2}$/.test(activeYM)
    ? Number(activeYM.slice(5, 7))
    : now.getMonth() + 1;

  const [scope, setScope] = useState({
    sectionId: "",
    serviceId: "",
    role: "",
    year: initialYear,
    month: initialMonth,
  });
  const [result, setResult] = useState(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const requestIdRef = useRef(0);

  const scopeComplete = Boolean(
    scope.sectionId &&
    scope.serviceId.trim() &&
    scope.role &&
    Number(scope.year) &&
    Number(scope.month)
  );

  const requestedScope = useMemo(() => ({
    sectionId: scope.sectionId,
    serviceId: scope.serviceId.trim(),
    role: scope.role,
    year: Number(scope.year),
    month: Number(scope.month),
  }), [scope]);
  const scopeKey = useMemo(
    () => JSON.stringify(requestedScope),
    [requestedScope]
  );

  const loadHealth = useCallback(async () => {
    if (!scopeComplete) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);

    const [monthlyResult, generatedResult, assignmentsResult] = await Promise.allSettled([
      getMonthlySchedule(requestedScope),
      getGeneratedSchedule(requestedScope),
      getAssignmentsForMonth(requestedScope),
    ]);

    if (requestId !== requestIdRef.current) return;

    const errors = {};
    if (monthlyResult.status === "rejected") errors.monthly = monthlyResult.reason;
    if (generatedResult.status === "rejected") errors.generated = generatedResult.reason;
    if (assignmentsResult.status === "rejected") errors.assignments = assignmentsResult.reason;

    setResult({
      monthly: monthlyResult.status === "fulfilled" ? monthlyResult.value : null,
      generated: generatedResult.status === "fulfilled" ? generatedResult.value : null,
      assignments: assignmentsResult.status === "fulfilled" && Array.isArray(assignmentsResult.value)
        ? assignmentsResult.value
        : [],
      errors,
    });
    setLastCheckedAt(new Date().toISOString());
    setLoading(false);
  }, [requestedScope, scopeComplete]);

  useEffect(() => {
    if (!scopeComplete) {
      requestIdRef.current += 1;
      setResult(EMPTY_RESULT);
      setLastCheckedAt(null);
      setLoading(false);
      return;
    }
    setResult(EMPTY_RESULT);
    setLastCheckedAt(null);
    loadHealth();
  }, [loadHealth, scopeComplete, scopeKey]);

  useEffect(() => {
    if (!scopeComplete) return undefined;

    const refreshForEvent = (event) => {
      if (eventScopeMatches(requestedScope, event?.detail)) loadHealth();
    };
    const refreshForStorage = (event) => {
      if (event.key !== "scheduleLastSaved") return;
      let eventScope = null;
      try {
        eventScope = event.newValue ? JSON.parse(event.newValue) : null;
      } catch {
        eventScope = null;
      }
      if (eventScopeMatches(requestedScope, eventScope)) loadHealth();
    };

    window.addEventListener("schedule:saved", refreshForEvent);
    window.addEventListener("schedule:invalidated", refreshForEvent);
    window.addEventListener("planner:changed", refreshForEvent);
    window.addEventListener("storage", refreshForStorage);
    return () => {
      window.removeEventListener("schedule:saved", refreshForEvent);
      window.removeEventListener("schedule:invalidated", refreshForEvent);
      window.removeEventListener("planner:changed", refreshForEvent);
      window.removeEventListener("storage", refreshForStorage);
    };
  }, [loadHealth, requestedScope, scopeComplete]);

  const monthlyReturnedScope = readReturnedScope(result.monthly);
  const generatedReturnedScope = readReturnedScope(result.generated);
  const generatedScopeComparison = result.generated
    ? compareScope(requestedScope, generatedReturnedScope)
    : null;
  const assignmentLatestUpdatedAt = getMaxAssignmentUpdatedAt(result.assignments);
  const assignmentSourceScheduleIds = collectSourceScheduleIds(result.assignments);
  const diagnostics = generateProjectionDiagnostics({
    monthly: result.monthly,
    generated: result.generated,
    assignments: result.assignments,
    assignmentLatestUpdatedAt,
    assignmentSourceScheduleIds,
    generatedScopeComparison,
    errors: result.errors,
  });

  const monthlyId = result.monthly?.id || result.monthly?._id || "";
  const generatedId = result.generated?.id || result.generated?._id || "";
  const assignmentMissingWarning =
    result.monthly && !result.errors.assignments && result.assignments.length === 0
      ? "MonthlySchedule is available, but Assignment Projection records were not observed. Check recommended."
      : null;
  const generatedScopeWarning =
    result.generated && generatedScopeComparison && !generatedScopeComparison.matches
      ? generatedScopeComparison.mismatches.length
        ? "Returned scope differs from the requested scope. Check recommended."
        : "Returned scope could not be fully verified."
      : null;

  const updateScope = (key, value) => {
    setScope((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <Activity className="h-4 w-4" />
            Read-only diagnostics
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Projection Health</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            MonthlySchedule, GeneratedSchedule and Assignment Projection are observed independently.
          </p>
        </div>
        <button
          type="button"
          onClick={loadHealth}
          disabled={!scopeComplete || loading}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <section className="border-y border-slate-200 bg-white py-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Scope selector</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Section</span>
            <select
              value={scope.sectionId}
              onChange={(event) => updateScope("sectionId", event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            >
              <option value="">Select section</option>
              {SECTION_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Service ID</span>
            <input
              value={scope.serviceId}
              onChange={(event) => updateScope("serviceId", event.target.value)}
              placeholder="Enter serviceId"
              className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Role</span>
            <select
              value={scope.role}
              onChange={(event) => updateScope("role", event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            >
              <option value="">Select role</option>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Year</span>
            <input
              type="number"
              min="2000"
              max="2100"
              value={scope.year}
              onChange={(event) => updateScope("year", event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Month</span>
            <select
              value={scope.month}
              onChange={(event) => updateScope("month", event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <option key={month} value={month}>{String(month).padStart(2, "0")}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {!scopeComplete ? (
        <div className="border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-700">
          Please select section, service, role, year and month to run projection health diagnostics.
        </div>
      ) : (
        <>
          <div className="border-y border-slate-200">
            <SourcePanel
              icon={Database}
              title="MonthlySchedule"
              status={<StatusBadge available={Boolean(lastCheckedAt && result.monthly)} unavailable={Boolean(result.errors.monthly)} />}
            >
              <DetailRow label="Schedule ID" value={monthlyId} mono />
              <DetailRow label="Created" value={formatDateTime(result.monthly?.createdAt)} />
              <DetailRow label="Updated" value={formatDateTime(result.monthly?.updatedAt)} />
              <DetailRow label="Requested scope" value={formatScope(requestedScope)} />
              <DetailRow label="Returned scope" value={formatScope(monthlyReturnedScope)} />
            </SourcePanel>

            <SourcePanel
              icon={FileClock}
              title="GeneratedSchedule"
              status={<StatusBadge available={Boolean(lastCheckedAt && result.generated)} unavailable={Boolean(result.errors.generated)} />}
              warning={generatedScopeWarning}
            >
              <DetailRow label="Generated ID" value={generatedId} mono />
              <DetailRow label="Source schedule ID" value={result.generated?.sourceScheduleId} mono />
              <DetailRow label="Created" value={formatDateTime(result.generated?.createdAt)} />
              <DetailRow label="Updated" value={formatDateTime(result.generated?.updatedAt)} />
              <DetailRow label="Requested scope" value={formatScope(requestedScope)} />
              <DetailRow label="Returned scope" value={formatScope(generatedReturnedScope)} />
            </SourcePanel>

            <SourcePanel
              icon={CalendarClock}
              title="Assignment Projection"
              status={<StatusBadge available={Boolean(lastCheckedAt && !result.errors.assignments)} unavailable={Boolean(result.errors.assignments)} />}
              warning={assignmentMissingWarning}
            >
              <DetailRow label="Assignment count" value={result.errors.assignments ? "Data unavailable" : String(result.assignments.length)} />
              <DetailRow label="Latest update" value={formatDateTime(assignmentLatestUpdatedAt)} />
              <DetailRow
                label="Source schedule IDs"
                value={assignmentSourceScheduleIds.length ? assignmentSourceScheduleIds.join(", ") : "Not observed"}
                mono
              />
              <DetailRow label="Requested scope" value={formatScope(requestedScope)} />
            </SourcePanel>
          </div>

          <section className="border-y border-slate-200 bg-white py-5">
            <h2 className="text-base font-semibold text-slate-900">Advisory diagnostics</h2>
            <p className="mt-1 text-sm text-slate-500">
              These observations are advisory and do not trigger any write, sync, rebuild or generation action.
            </p>
            <div className="mt-4 space-y-2">
              {loading && !lastCheckedAt ? (
                <div className="text-sm text-slate-500">Checking selected scope...</div>
              ) : diagnostics.length ? diagnostics.map((diagnostic) => (
                <div key={diagnostic.code} className="flex gap-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <div className="text-sm font-semibold text-amber-900">{diagnostic.label}</div>
                    <div className="mt-0.5 text-sm text-amber-800">{diagnostic.message}</div>
                  </div>
                </div>
              )) : (
                <div className="border-l-2 border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  No advisory divergence was observed from the available metadata. This does not verify synchronization success.
                </div>
              )}
            </div>
          </section>
        </>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <span>Last checked: {lastCheckedAt ? formatDateTime(lastCheckedAt) : "Not observed"}</span>
        <span>{loading ? "Refreshing read-only observations..." : "Read-only"}</span>
      </footer>
    </div>
  );
}
