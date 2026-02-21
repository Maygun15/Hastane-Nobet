// src/tabs/LeaveTypesTab.jsx
import React, { useEffect, useRef, useState } from "react";
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
      setExternal((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const nextRaw = typeof updater === "function" ? updater(base) : updater;
        const next = sortTR(dedupeByCode(normalizeList(nextRaw || [])));
        // Controlled modda localStorage yazmayız; üst seviye yönetir
        // Ama yine de aynı pencere için sinyal göndermek iyi olur:
        try { window.dispatchEvent(new Event("leaveTypes:changed")); } catch {}
        return next;
      });
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
    window.addEventListener("storage", onStorage);
    window.addEventListener("leaveTypes:changed", () => setInner(readUncontrolled()));
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("leaveTypes:changed", () => setInner(readUncontrolled()));
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
        alert("Aynı kısaltma zaten mevcut.");
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
    const lines = (text || "").replace(/\r/g, "").split("\n").filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idxCode = header.indexOf("kod") >= 0 ? header.indexOf("kod") : 0;
    const idxName = header.indexOf("ad") >= 0 ? header.indexOf("ad") : 1;
    const idxWorked = header.findIndex((h) => h.includes("calis") || h.includes("çalış") || h.includes("worked") || h.includes("cs"));
    const idxHours = header.findIndex((h) => h.includes("saat") || h.includes("hour"));
    const rows = lines.slice(1).map((ln) => ln.split(","));
    return rows.map((r) => ({
      id: genId(),
      code: upTR(r[idxCode] ?? ""),
      name: norm(r[idxName] ?? ""),
      countsAsWorked: idxWorked >= 0 ? toBool(r[idxWorked]) : undefined,
      hoursPerDay: idxHours >= 0 ? toNum(r[idxHours]) : undefined,
    })).filter((x) => x.code && x.name);
  };

  const importExcel = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      let parsed = [];
      if (ext === "csv" || (f.type && f.type.includes("csv"))) {
        const txt = await f.text();
        parsed = parseCSV(txt);
      } else {
        const data = new Uint8Array(await f.arrayBuffer());
        const wb = XLSX.read(data, { type: "array" });
        const sh = wb.Sheets["IzinTurleri"] ?? wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" });
        // başlık tespiti (esnek)
        let startIdx = 1;
        let idxWorked = -1;
        let idxHours = -1;
        if (rows.length && rows[0].length) {
          const h0 = rows[0].map((x) => norm(x).toLowerCase());
          if (!(h0.includes("kod") && h0.includes("ad"))) {
            // ilk satır başlık değilse datayı 0'dan al
            startIdx = 0;
          }
          idxWorked = h0.findIndex((h) => h.includes("calis") || h.includes("çalış") || h.includes("worked") || h.includes("cs"));
          idxHours = h0.findIndex((h) => h.includes("saat") || h.includes("hour"));
        }
        parsed = rows.slice(startIdx).map((r) => ({
          id: genId(),
          code: upTR(r[0]),
          name: norm(r[1]),
          countsAsWorked: idxWorked >= 0 ? toBool(r[idxWorked]) : undefined,
          hoursPerDay: idxHours >= 0 ? toNum(r[idxHours]) : undefined,
        })).filter((x) => x.code && x.name);
      }

      if (!parsed.length) {
        alert("Şablon: 'KOD, AD' (ilk iki sütun).");
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
            if (norm(old.name) !== norm(it.name)) {
              map.set(k, { ...old, name: it.name }); // update name
              updated++;
            }
          } else {
            map.set(k, { id: genId(), code: k, name: it.name });
            added++;
          }
        }
        return sortTR(Array.from(map.values()));
      });

      alert(`${added} eklendi, ${updated} güncellendi.`);
    } catch (err) {
      console.error(err);
      alert("Dosya yüklenirken hata oluştu.");
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
    <div className="space-y-4">
      {/* Üst butonlar */}
      <div className="flex items-center justify-end gap-2">
        <button onClick={exportExcel} className="px-3 py-2 text-sm border rounded">Excele Aktar</button>
        <label className="px-3 py-2 text-sm border rounded cursor-pointer">
          Excel/CSV'den Yükle
          <input
            ref={importRef}
            type="file"
            accept=".xls,.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={importExcel}
          />
        </label>
        <button type="button" onClick={clearAll} className="px-3 py-2 text-sm border rounded text-red-600">
          İzin Türlerini Sıfırla
        </button>
      </div>

      <h3 className="font-medium">İzin Türleri</h3>

      {/* Form */}
      <form onSubmit={upsert} className="bg-white rounded-2xl shadow-sm p-4 grid md:grid-cols-6 gap-3 items-end">
        <input
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          className="w-full border rounded p-2 font-mono"
          placeholder="Kısaltma (örn: R, İ, Üİ, SÜ, AN...)"
        />
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="md:col-span-2 w-full border rounded p-2"
          placeholder="Tür adı (örn: Rapor, İzin, Ücretsiz İzin, Sü... )"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={!!form.countsAsWorked}
            onChange={(e) => setForm((f) => ({ ...f, countsAsWorked: e.target.checked }))}
          />
          Çalışılmış say
        </label>
        <input
          type="number"
          step="0.5"
          min="0"
          value={form.hoursPerDay}
          onChange={(e) => setForm((f) => ({ ...f, hoursPerDay: e.target.value }))}
          disabled={!form.countsAsWorked}
          className="w-full border rounded p-2"
          placeholder="Saat"
        />
        <div className="flex gap-2">
          <button type="submit" className="px-3 py-2 text-sm border rounded bg-emerald-600 text-white">
            {editingId ? "Güncelle" : "Ekle"}
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="px-3 py-2 text-sm border rounded bg-slate-100">
              İptal
            </button>
          )}
        </div>
      </form>

      {/* Liste */}
      <div className="bg-white rounded-2xl shadow-sm p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-500">
            <tr className="border-b">
              <th className="py-2 pr-2 text-left">Kısaltma</th>
              <th className="py-2 pr-2 text-left">Tür Adı</th>
              <th className="py-2 pr-2 text-left">Çalışılmış</th>
              <th className="py-2 pr-2 text-left">Saat</th>
              <th className="py-2 pr-2 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {(!list || list.length === 0) && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">Henüz izin türü yok.</td>
              </tr>
            )}
            {(list ?? []).map((t) => (
              <tr key={t.id} className="border-t">
                <td className="py-2 pr-2 font-mono">{t.code}</td>
                <td className="py-2 pr-2">{t.name}</td>
                <td className="py-2 pr-2">{t.countsAsWorked ? "Evet" : "Hayır"}</td>
                <td className="py-2 pr-2">{Number.isFinite(Number(t.hoursPerDay)) ? Number(t.hoursPerDay) : 0}</td>
                <td className="py-2 pr-2 text-right">
                  <button onClick={() => edit(t)} className="text-xs px-2 py-1 border rounded bg-slate-100">Düzenle</button>
                  <button onClick={() => del(t.id)} className="text-xs px-2 py-1 border rounded bg-slate-100 ml-1">Sil</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
