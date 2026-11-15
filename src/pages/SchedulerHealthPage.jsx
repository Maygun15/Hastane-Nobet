import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FileWarning,
  HeartPulse,
  RefreshCw,
} from "lucide-react";
import { getSchedulerHealth } from "../api/apiAdapter.js";
import { formatDateTime, formatNumber, statusLabel, STATUS_STYLES } from "../utils/schedulerHealth.js";

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

function StatusPill({ status }) {
  const cls = STATUS_STYLES[status] || "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {statusLabel(status)}
    </span>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function Card({ icon: Icon, title, status, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
            <Icon className="h-4 w-4" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        </div>
        <StatusPill status={status} />
      </div>
      {children}
    </section>
  );
}

function findCheck(result, category) {
  return (result?.checks || []).find((item) => item.category === category) || null;
}

export default function SchedulerHealthPage({ activeYM }) {
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
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const scopeComplete = Boolean(
    scope.sectionId &&
    String(scope.serviceId || "").trim() &&
    scope.role &&
    Number(scope.year) &&
    Number(scope.month)
  );

  const requestScope = useMemo(() => ({
    sectionId: scope.sectionId,
    serviceId: String(scope.serviceId || "").trim(),
    role: scope.role,
    year: Number(scope.year),
    month: Number(scope.month),
  }), [scope]);

  const loadHealth = useCallback(async () => {
    if (!scopeComplete) return;
    setLoading(true);
    setError("");
    try {
      const payload = await getSchedulerHealth(requestScope);
      setResult(payload);
    } catch (err) {
      setResult(null);
      setError(err?.body?.message || err?.data?.message || err?.message || "Scheduler health could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [requestScope, scopeComplete]);

  useEffect(() => {
    if (!scopeComplete) {
      setResult(null);
      setError("");
      return;
    }
    loadHealth();
  }, [loadHealth, scopeComplete]);

  const updateScope = (key, value) => setScope((prev) => ({ ...prev, [key]: value }));

  const scheduleCheck = findCheck(result, "Schedule Consistency");
  const hoursCheck = findCheck(result, "Hours Consistency");
  const projectionCheck = findCheck(result, "Projection Health");
  const scopeCheck = findCheck(result, "Scope Integrity");
  const schedulerCheck = findCheck(result, "Scheduler Output Health");
  const metadataCheck = findCheck(result, "Assignment Metadata Health");
  const leavesCheck = findCheck(result, "Leaves Health");

  const schedule = result?.cards?.scheduleConsistency || {};
  const projection = result?.cards?.projectionHealth || {};
  const hours = result?.cards?.hoursConsistency || {};
  const output = result?.cards?.schedulerOutput || {};
  const metadata = result?.cards?.metadataHealth || {};
  const leaves = result?.cards?.leavesHealth || {};

  return (
    <div className="space-y-5">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <HeartPulse className="h-4 w-4" />
              Analizler
            </div>
            <h1 className="mt-2 text-2xl font-bold text-slate-950">Scheduler Health</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Exact scope için MonthlySchedule, GeneratedSchedule ve Assignment Projection sağlığını read-only olarak izler.
            </p>
          </div>
          <button
            type="button"
            onClick={loadHealth}
            disabled={!scopeComplete || loading}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Yenile
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Section</span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={scope.sectionId}
              onChange={(event) => updateScope("sectionId", event.target.value)}
            >
              <option value="">Seçiniz</option>
              {SECTION_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Service ID</span>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={scope.serviceId}
              onChange={(event) => updateScope("serviceId", event.target.value)}
              placeholder="Specific serviceId"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Role</span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={scope.role}
              onChange={(event) => updateScope("role", event.target.value)}
            >
              <option value="">Seçiniz</option>
              {ROLE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Year</span>
            <input
              type="number"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={scope.year}
              onChange={(event) => updateScope("year", event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Month</span>
            <input
              type="number"
              min="1"
              max="12"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={scope.month}
              onChange={(event) => updateScope("month", event.target.value)}
            />
          </label>
        </div>
      </header>

      {!scopeComplete ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Please select section, service, role, year and month to run scheduler health diagnostics.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>
      ) : null}

      {result ? (
        <>
          <Card icon={Activity} title="Runtime Summary" status={result.status}>
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Status" value={statusLabel(result.status)} />
              <Metric label="Errors" value={formatNumber(result?.cards?.runtimeSummary?.errors)} />
              <Metric label="Warnings" value={formatNumber(result?.cards?.runtimeSummary?.warnings)} />
              <Metric label="Last checked" value={formatDateTime(result?.summary?.checkedAt)} />
            </div>
            <p className="mt-3 text-sm text-slate-600">{result?.summary?.message}</p>
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card icon={Database} title="Schedule Consistency" status={scheduleCheck?.status || "GREEN"}>
              <div className="grid gap-3 md:grid-cols-3">
                <Metric label="Monthly" value={formatNumber(schedule?.monthly?.assignmentCount)} />
                <Metric label="Generated" value={formatNumber(schedule?.generated?.assignmentCount)} />
                <Metric label="Assignment" value={formatNumber(schedule?.assignmentProjection?.assignmentCount)} />
              </div>
            </Card>

            <Card icon={Clock} title="Hours Consistency" status={hoursCheck?.status || "GREEN"}>
              <div className="grid gap-3 md:grid-cols-3">
                <Metric label="Monthly hours" value={formatNumber(hours.monthlyHours)} />
                <Metric label="Generated hours" value={formatNumber(hours.generatedHours)} />
                <Metric label="Assignment hours" value={formatNumber(hours.assignmentHours)} />
              </div>
            </Card>

            <Card icon={CheckCircle2} title="Projection Health" status={projectionCheck?.status || "GREEN"}>
              <div className="grid gap-3 md:grid-cols-2">
                <Metric label="Projection count" value={formatNumber(projection.projectionCount)} />
                <Metric label="Latest sync" value={formatDateTime(projection.latestProjectionUpdatedAt)} />
              </div>
              <div className="mt-3 break-words text-xs text-slate-500">
                Source schedule IDs: {(projection.sourceScheduleIds || []).join(", ") || "Not observed"}
              </div>
            </Card>

            <Card icon={FileWarning} title="Scheduler Output" status={schedulerCheck?.status || "GREEN"}>
              <div className="grid gap-3 md:grid-cols-4">
                <Metric label="Generated" value={formatNumber(output.generatedAssignments)} />
                <Metric label="Required" value={formatNumber(output.requiredSlots)} />
                <Metric label="Empty" value={formatNumber(output.emptySlots)} />
                <Metric label="Issues" value={formatNumber(output.issueCount)} />
              </div>
            </Card>

            <Card icon={AlertTriangle} title="Metadata Health" status={metadataCheck?.status || "GREEN"}>
              <div className="grid gap-3 md:grid-cols-2">
                <Metric label="Missing metadata" value={formatNumber(metadata.missingMetadataCount)} />
                <Metric label="Affected shifts" value={(metadata.affectedShiftCodes || []).join(", ") || "None"} />
              </div>
            </Card>

            <Card icon={Database} title="Leaves Health" status={leavesCheck?.status || "GREEN"}>
              <div className="grid gap-3 md:grid-cols-3">
                <Metric label="Scoped docs" value={formatNumber(leaves.scopedDocumentCount)} />
                <Metric label="Legacy docs" value={formatNumber(leaves.legacyDocumentCount)} />
                <Metric label="Duplicate risk" value={leaves.duplicateRisk ? "Yes" : "No"} />
              </div>
            </Card>
          </div>

          <Card icon={CheckCircle2} title="Scope Integrity" status={scopeCheck?.status || "GREEN"}>
            {result?.cards?.scopeIntegrity?.mismatches?.length ? (
              <ul className="space-y-2 text-sm text-slate-700">
                {result.cards.scopeIntegrity.mismatches.map((item, index) => (
                  <li key={`${item.source}-${item.field}-${index}`}>
                    {item.source}: {item.field}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">Exact scope verified for observed datasets.</p>
            )}
          </Card>

          <Card icon={AlertTriangle} title="Recommended Actions" status={result.status === "RED" ? "RED" : result.status === "YELLOW" ? "YELLOW" : "GREEN"}>
            {result.recommendedActions?.length ? (
              <ul className="space-y-3">
                {result.recommendedActions.map((item) => (
                  <li key={item.code} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-1 text-sm text-slate-600">{item.message}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">No action recommended for the selected scope.</p>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
