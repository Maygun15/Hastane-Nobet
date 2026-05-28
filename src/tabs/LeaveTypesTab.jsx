// src/tabs/LeaveTypesTab.jsx
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { LEAVE_RULES as DEFAULT_LEAVE_RULES } from "../constants/rules.js";

const LS_KEY = "leaveTypesV2"; // ana anahtar
const LEGACY_KEYS = ["leaveTypes", "izinTurleri"]; // geriye dönük uyum
const upTR = (s) => (s ?? "").toString().trim().toLocaleUpperCase("tr");
const norm = (s) => (s ?? "").toString().trim();
const toBool = (v) => {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "evet", "yes", "y", "t", "on"].includes(s)) return true;
  if (["0", "false", "hayir", "hayır", "no", "n", "f", "off"].includes(s)) return false;
  return null;
};
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const stripDiacritics = (s) =>
  (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const normalizeHeader = (s) =>
  stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const defaultRule = (code) => DEFAULT_LEAVE_RULES?.[upTR(code)] || null;

function normalizeType(t) {
  const code = upTR(t?.code ?? t?.kisaltma ?? t?.abbr ?? t?.short ?? "");
  const name = norm(t?.name ?? t?.ad ?? t?.title ?? "");
  const def = defaultRule(code);
  const hasCounts = hasOwn(t, "countsAsWorked");
  const hasHours = hasOwn(t, "hoursPerDay");
  const counts = hasCounts ? toBool(t.countsAsWorked) : (def?.countsAsWorked ?? false);
  let hours = hasHours ? toNum(t.hoursPerDay) : def?.hoursPerDay;
  if (!Number.isFinite(hours)) hours = counts ? 8 : 0;
  return {
    ...t,
    code,
    name,
    countsAsWorked: !!counts,
    hoursPerDay: counts ? hours : 0,
  };
}

function normalizeList(items) {
  return (items || []).map(normalizeType).filter((x) => x.code && x.name);
}
const genId = () => {
  try { return crypto.randomUUID(); } catch { return String(Date.now()) + Math.random().toString(36).slice(2, 8); }
};

function sortTR(arr) {
  return [...(arr || [])].sort((a, b) =>
    (a?.code || "").localeCompare(b?.code || "", "tr", { sensitivity: "base" })
  );
}

// Tekilleştir: aynı kodu (TR locale, case-insensitive) 1 kere tut
function dedupeByCode(items) {
  const map = new Map(); // key = upTR(code)
  for (const it of items || []) {
    const codeKey = upTR(it.code);
    if (!codeKey) continue;
    if (!map.has(codeKey)) {
      map.set(codeKey, { ...it, code: upTR(it.code) });
    } else {
      // aynı kod tekrar gelirse son gelen isim kazanır (veya mevcut ismi koru)
      const prev = map.get(codeKey);
      const merged = { ...prev, ...it, code: upTR(it.code) };
      // yeni kayıtta counts/hours yoksa mevcut değerleri koru
      if (!hasOwn(it, "countsAsWorked")) merged.countsAsWorked = prev.countsAsWorked;
      if (!hasOwn(it, "hoursPerDay")) merged.hoursPerDay = prev.hoursPerDay;
      map.set(codeKey, merged);
    }
  }
  return Array.from(map.values());
}

const HEADER_ALIASES = Object.freeze({
  code: ["kod", "kisaltma", "kisalma", "kisa ad", "kisaadi", "kisa adi", "code", "abbr", "short", "short code"],
  name: ["ad", "adi", "tur", "tur adi", "tur adı", "turadi", "tur adi", "name", "title", "izin turu", "izin türü"],
  countsAsWorked: [
    "calisilmis",
    "calisilmis say",
    "calisilmis sayilir",
    "calisilir",
    "calisilan",
    "worked",
    "counts as worked",
    "worked count",
    "worked flag",
  ],
  hoursPerDay: ["saat", "gunluk saat", "günlük saat", "hours", "hours per day", "day hours"],
});

const REJECTION_LABELS = Object.freeze({
  MISSING_CODE: "Kısaltma eksik",
  MISSING_NAME: "Tür adı eksik",
  EMPTY_ROW: "Boş satır",
  UNKNOWN: "Bilinmeyen neden",
});

function resolveHeaderIndexes(headerRow = []) {
  const normalized = headerRow.map(normalizeHeader);
  const findIndex = (field) =>
    normalized.findIndex((value) =>
      HEADER_ALIASES[field].some((alias) => value === normalizeHeader(alias))
    );
  const indexes = {
    code: findIndex("code"),
    name: findIndex("name"),
    countsAsWorked: findIndex("countsAsWorked"),
    hoursPerDay: findIndex("hoursPerDay"),
  };
  const hasExplicitHeader = indexes.code >= 0 || indexes.name >= 0;
  if (!hasExplicitHeader) {
    indexes.code = 0;
    indexes.name = 1;
  }
  return { indexes, hasExplicitHeader };
}

function parseImportedRow(raw = {}, rowNumber = 0) {
  const code = upTR(raw.code ?? "");
  const name = norm(raw.name ?? "");
  if (!code && !name) {
    return { status: "ignored", reason: "EMPTY_ROW", rowNumber };
  }
  if (!code) {
    return { status: "rejected", reason: "MISSING_CODE", rowNumber, raw };
  }
  if (!name) {
    return { status: "rejected", reason: "MISSING_NAME", rowNumber, raw };
  }
  return {
    status: "valid",
    rowNumber,
    item: {
      id: genId(),
      code,
      name,
      ...(raw.countsAsWorked !== undefined ? { countsAsWorked: raw.countsAsWorked } : {}),
      ...(raw.hoursPerDay !== undefined ? { hoursPerDay: raw.hoursPerDay } : {}),
    },
  };
}

function summarizeRejectedRows(rows = []) {
  const summary = {};
  for (const row of rows) {
    const reason = String(row?.reason || "UNKNOWN");
    summary[reason] = Number(summary[reason] || 0) + 1;
  }
  return summary;
}

function buildImportMessage({ totalRows, validRows, added, updated, rejectedSummary }) {
  const rejectedTotal = Object.values(rejectedSummary || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const reasons = Object.entries(rejectedSummary || {})
    .map(([reason, count]) => `${REJECTION_LABELS[reason] || reason}:${count}`)
    .join(", ");
  let message = `${added} eklendi, ${updated} güncellendi. ${totalRows} satır okundu, ${validRows} geçerli.`;
  if (rejectedTotal > 0) {
    message += ` ${rejectedTotal} satır elendi${reasons ? ` (${reasons})` : ""}.`;
  }
  if (added === 0 && updated === 0 && validRows === 0) {
    message += " Zorunlu alanlar: Kısaltma ve Tür Adı.";
  }
  return message;
}

function useHybridLeaveTypes(external, setExternal) {
  const controlled = typeof setExternal === "function" && Array.isArray(external);

  const readUncontrolled = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? normalizeList(arr) : [];
    } catch { return []; }
  };

  const [inner, setInner] = useState(() => (controlled ? [] : readUncontrolled()));

  // Merkezi kaydet + legacy anahtarlara ayna yaz
  const persistAll = (list) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list));
      // legacy 1: { leaveTypes: [...] }
      localStorage.setItem(LEGACY_KEYS[0], JSON.stringify({ leaveTypes: list }));
      // legacy 2: [ ... ] (düz dizi)
      localStorage.setItem(LEGACY_KEYS[1], JSON.stringify(list));
      // Aynı pencere içinde canlı senkron için custom event
      window.dispatchEvent(new Event("leaveTypes:changed"));
    } catch {}
  };

  const setLT = (updater) => {
    if (controlled) {
      const base = Array.isArray(external) ? external : [];
      const nextRaw = typeof updater === "function" ? updater(base) : updater;
      const next = sortTR(dedupeByCode(normalizeList(nextRaw || [])));
      try { window.dispatchEvent(new Event("leaveTypes:changed")); } catch {}
      setExternal(next);
    } else {
      setInner((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const nextRaw = typeof updater === "function" ? updater(base) : updater;
        const next = sortTR(dedupeByCode(normalizeList(nextRaw || [])));
        persistAll(next);
        return next;
      });
    }
  };

  // uncontrolled modda başka sekmeden gelen değişiklikleri dinle
  useEffect(() => {
    if (controlled) return;
    const onStorage = (e) => {
      if (!e) return;
      if ([LS_KEY, ...LEGACY_KEYS].includes(e.key)) {
        // Ana kaynaktan oku
        setInner(readUncontrolled());
      }
    };
    const onLeaveTypesChanged = () => setInner(readUncontrolled());
    window.addEventListener("storage", onStorage);
    window.addEventListener("leaveTypes:changed", onLeaveTypesChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("leaveTypes:changed", onLeaveTypesChanged);
    };
  }, [controlled]);

  const list = controlled ? (external ?? []) : (inner ?? []);
  return [list, setLT, controlled];
}

export default function LeaveTypesTab({ leaveTypes, setLeaveTypes }) {
  const [list, setLT, controlled] = useHybridLeaveTypes(leaveTypes, setLeaveTypes);
  const [form, setForm] = useState({ id: undefined, code: "", name: "", countsAsWorked: false, hoursPerDay: 8 });
  const [editingId, setEditingId] = useState(null);
  const importRef = useRef(null);

  const reset = () => { setForm({ id: undefined, code: "", name: "", countsAsWorked: false, hoursPerDay: 8 }); setEditingId(null); };

  const upsert = (e) => {
    e?.preventDefault?.();
    const code = upTR(form.code);
    const name = norm(form.name);
    if (!code || !name) return;

    const id = editingId ?? genId();
    const countsAsWorked = !!form.countsAsWorked;
    const hoursRaw = toNum(form.hoursPerDay);
    const hoursPerDay = countsAsWorked ? (Number.isFinite(hoursRaw) ? hoursRaw : 8) : 0;
    const row = { id, code, name, countsAsWorked, hoursPerDay };
    setLT((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      const codeKey = upTR(code);
      const conflict = base.find((t) => upTR(t.code) === codeKey && t.id !== id);
      if (conflict) {
        // farklı id ile aynı kod varsa: güncelleme kabul edilmesin
        toast.error("Aynı kısaltma zaten mevcut.");
        return base;
      }
      const without = base.filter((t) => t.id !== id);
      return [...without, row];
    });
    reset();
  };

  const edit = (r) => {
    setEditingId(r.id);
    setForm({
      id: r.id,
      code: r.code || "",
      name: r.name || "",
      countsAsWorked: !!r.countsAsWorked,
      hoursPerDay: Number.isFinite(Number(r.hoursPerDay)) ? Number(r.hoursPerDay) : 8,
    });
  };
  const del = (id) => { setLT((prev) => (prev || []).filter((t) => t.id !== id)); if (editingId === id) reset(); };

  const exportExcel = () => {
    const header = ["KOD", "AD", "CALISILMIS", "SAAT"];
    const rows = (list || []).map((t) => [t.code, t.name, t.countsAsWorked ? "EVET" : "HAYIR", t.hoursPerDay ?? 0]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "IzinTurleri");
    XLSX.writeFile(wb, "izin_turleri.xlsx");
  };

  const triggerImport = () => importRef.current?.click();

  const parseCSV = (text) => {
    const lines = (text || "").replace(/\r/g, "").split("\n").filter((line) => line.trim());
    if (!lines.length) return { parsed: [], totalRows: 0, rejectedRows: [] };
    const delimiter = lines[0].includes(";") ? ";" : ",";
    const headerRow = lines[0].split(delimiter);
    const { indexes } = resolveHeaderIndexes(headerRow);
    const parsed = [];
    const rejectedRows = [];
    const rows = lines.slice(1).map((ln) => ln.split(delimiter));
    rows.forEach((r, idx) => {
      const result = parseImportedRow(
        {
          code: r[indexes.code],
          name: r[indexes.name],
          countsAsWorked: indexes.countsAsWorked >= 0 ? toBool(r[indexes.countsAsWorked]) : undefined,
          hoursPerDay: indexes.hoursPerDay >= 0 ? toNum(r[indexes.hoursPerDay]) : undefined,
        },
        idx + 2
      );
      if (result.status === "valid") parsed.push(result.item);
      if (result.status === "rejected") rejectedRows.push(result);
    });
    return { parsed, totalRows: rows.length, rejectedRows };
  };

  const importExcel = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      let parsed = [];
      let totalRows = 0;
      let rejectedRows = [];
      if (ext === "csv" || (f.type && f.type.includes("csv"))) {
        const txt = await f.text();
        const csvResult = parseCSV(txt);
        parsed = csvResult.parsed;
        totalRows = csvResult.totalRows;
        rejectedRows = csvResult.rejectedRows;
      } else {
        const data = new Uint8Array(await f.arrayBuffer());
        const wb = XLSX.read(data, { type: "array" });
        const sh = wb.Sheets["IzinTurleri"] ?? wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" });
        const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
        const { indexes, hasExplicitHeader } = resolveHeaderIndexes(headerRow);
        const startIdx = hasExplicitHeader ? 1 : 0;
        totalRows = Math.max(0, rows.length - startIdx);
        rows.slice(startIdx).forEach((r, idx) => {
          const result = parseImportedRow(
            {
              code: r[indexes.code],
              name: r[indexes.name],
              countsAsWorked: indexes.countsAsWorked >= 0 ? toBool(r[indexes.countsAsWorked]) : undefined,
              hoursPerDay: indexes.hoursPerDay >= 0 ? toNum(r[indexes.hoursPerDay]) : undefined,
            },
            idx + startIdx + 1
          );
          if (result.status === "valid") parsed.push(result.item);
          if (result.status === "rejected") rejectedRows.push(result);
        });
      }

      if (!parsed.length) {
        const rejectedSummary = summarizeRejectedRows(rejectedRows);
        toast.info(buildImportMessage({ totalRows, validRows: 0, added: 0, updated: 0, rejectedSummary }));
        return;
      }

      // merge: aynı koda sahip olanlar güncellensin, olmayanlar eklensin
      let added = 0, updated = 0;
      setLT((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const map = new Map(base.map((t) => [upTR(t.code), t]));
        for (const it of parsed) {
          const k = upTR(it.code);
          if (map.has(k)) {
            const old = map.get(k);
            const merged = normalizeType({ ...old, ...it, code: k });
            const changed =
              norm(old.name) !== norm(merged.name) ||
              !!old.countsAsWorked !== !!merged.countsAsWorked ||
              Number(old.hoursPerDay ?? 0) !== Number(merged.hoursPerDay ?? 0);
            if (changed) {
              map.set(k, merged);
              updated++;
            }
          } else {
            map.set(k, normalizeType({ id: genId(), ...it, code: k }));
            added++;
          }
        }
        return sortTR(Array.from(map.values()));
      });
      const rejectedSummary = summarizeRejectedRows(rejectedRows);
      toast.success(buildImportMessage({ totalRows, validRows: parsed.length, added, updated, rejectedSummary }));
    } catch (err) {
      console.error(err);
      toast.error("Dosya yüklenirken hata oluştu.");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const clearAll = () => {
    const ok = window.confirm("Tüm izin türleri silinsin mi?");
    if (!ok) return;
    setLT([]);
    if (!controlled) {
      try {
        localStorage.removeItem(LS_KEY);
        for (const k of LEGACY_KEYS) localStorage.removeItem(k);
        window.dispatchEvent(new Event("leaveTypes:changed"));
      } catch {}
    }
    reset();
  };

  return (
    <div className="px-8 py-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">İzin Türleri</h2>
          <p className="text-sm text-slate-500 mt-1">İzin türü tanımlarını yönetin; Excel ile toplu içe/dışa aktarın.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={exportExcel} className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50">Excele Aktar</button>
          <label className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50 cursor-pointer">
            Excel'den Yükle
            <input
              ref={importRef}
              type="file"
              accept=".xls,.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={importExcel}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm("Kritik işlem: Tüm izin türleri sıfırlanacak. Devam edilsin mi?")) return;
              clearAll();
            }}
            className="px-3 py-2 text-sm border border-red-200 rounded-lg text-red-600 hover:bg-red-50"
          >
            İzin Türlerini Sıfırla
          </button>
        </div>
      </div>

      {/* İki sütun: Yeni Ekle | Mevcut Liste */}
      <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-6 items-start">
        {/* Yeni İzin Türü Ekle */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="text-sm font-medium text-slate-700">
              {editingId ? "İzin Türünü Düzenle" : "Yeni İzin Türü Ekle"}
            </div>
            <div className="text-xs text-slate-500 mt-1">Kısaltma, tür adı ve saatlik değeri girin.</div>
          </div>
          <form onSubmit={upsert} className="p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Kısaltma</label>
              <input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="örn: R, İ, Üİ, SÜ, AN..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Tür Adı</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="örn: Rapor, İzin, Ücretsiz İzin..."
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.countsAsWorked}
                onChange={(e) => setForm((f) => ({ ...f, countsAsWorked: e.target.checked }))}
                className="rounded"
              />
              Çalışılmış say
            </label>
            {form.countsAsWorked && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Günlük Saat</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={form.hoursPerDay}
                  onChange={(e) => setForm((f) => ({ ...f, hoursPerDay: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Saat"
                />
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                {editingId ? "Güncelle" : "Ekle"}
              </button>
              {editingId && (
                <button type="button" onClick={reset} className="px-4 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50">
                  İptal
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Mevcut İzin Türleri */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="text-sm font-medium text-slate-700">Mevcut İzin Türleri</div>
            <div className="text-xs text-slate-500 mt-1">{list?.length ?? 0} izin türü tanımlanmış.</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-3 py-2 text-left">Kısaltma</th>
                  <th className="px-3 py-2 text-left">Tür Adı</th>
                  <th className="px-3 py-2 text-left">Çalışılmış</th>
                  <th className="px-3 py-2 text-center">Saat</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {(!list || list.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-400">Henüz izin türü yok.</td>
                  </tr>
                )}
                {(list ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-mono font-medium">{t.code}</td>
                    <td className="px-3 py-2">{t.name}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border ${t.countsAsWorked ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                        {t.countsAsWorked ? "Evet" : "Hayır"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono tabular-nums">
                      {Number.isFinite(Number(t.hoursPerDay)) ? Number(t.hoursPerDay) : 0}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => edit(t)} className="text-xs px-2 py-1 border border-slate-200 rounded-lg bg-white hover:bg-slate-50">Düzenle</button>
                        <button onClick={() => del(t.id)} className="text-xs px-2 py-1 border border-red-200 rounded-lg text-red-600 hover:bg-red-50">Sil</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
