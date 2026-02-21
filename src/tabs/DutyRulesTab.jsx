import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

/**
 * src/tabs/DutyRulesTab.jsx (V2 – hibrit + Excel içe/dışa aktarım)
 *
 * İsteklerin:
 * - Excele Aktar
 * - Excelden Yükle
 * - Kuralları Sıfırla
 * - Düzenlemeye izin
 * - Font: Çalışma alanlarıyla aynı (özel font sınıfı yok; body'den miras alır)
 *
 * Notlar:
 * - Parent { rules, setRules } verirse controlled; vermezse localStorage (dutyRulesV2) ile çalışır.
 * - Excel başlıkları esnek: id | name | value | enabled | order (ilk satır başlık kabul edilir)
 */

const LS_KEY = "dutyRulesV2";

// Kullanışlı başlangıç seti (NAME bazlı anlamlı şablonlar)
const DEFAULT_RULES = [
  { id: "max-per-day",          name: "Aynı gün bir kişiye en fazla",              value: 1,   enabled: true,  order: 0 },
  { id: "max-consec-nights",    name: "Ardışık gece (N) sınırı",                   value: 2,   enabled: true,  order: 1 },
  { id: "target-monthly-hours", name: "Hedef aylık saat",                          value: 168, enabled: false, order: 2 },
  { id: "rest-after-night",     name: "Gece (N) sonrası dinlenme (saat)",          value: 24,  enabled: true,  order: 3 },
];

/* ========================= Yardımcılar ========================= */
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2,8));

function normalizeAndSort(arr = []) {
  const withIndex = (arr || []).map((it, i) => ({
    ...it,
    order: typeof it.order === "number" ? it.order : i,
    enabled: typeof it.enabled === "boolean" ? it.enabled : true,
  }));
  return [...withIndex].sort((a, b) => a.order - b.order);
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "evet" || s === "aktif";
}

/* ========================= Hibrit State ========================= */
function useHybridRules(external, setExternal) {
  const controlled = typeof setExternal === "function" && Array.isArray(external);

  const [inner, setInner] = useState(() => {
    if (controlled) return [];
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const setR = (updater) => {
    if (controlled) {
      setExternal((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const next = typeof updater === "function" ? updater(base) : updater;
        return normalizeAndSort(next);
      });
    } else {
      setInner((prev0) => {
        const base = Array.isArray(prev0) ? prev0 : [];
        const next = typeof updater === "function" ? updater(base) : updater;
        const sorted = normalizeAndSort(next);
        try { localStorage.setItem(LS_KEY, JSON.stringify(sorted)); } catch {}
        return sorted;
      });
    }
  };

  const list = controlled ? (external ?? []) : (inner ?? []);

  useEffect(() => {
    if (!controlled) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(list ?? [])); } catch {}
    }
  }, [controlled, list]);

  return [list, setR, controlled];
}

/* ========================= Ana Bileşen ========================= */
export default function DutyRulesTab({ rules, setRules }) {
  const [list, setR] = useHybridRules(rules, setRules);

  const emptyForm = { id: undefined, name: "", value: "", enabled: true };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const ordered = useMemo(() => normalizeAndSort(list), [list]);

  const fileRef = useRef(null);

  const resetForm = () => { setForm(emptyForm); setEditingId(null); };

  const upsert = (e) => {
    e?.preventDefault?.();
    const name = (form.name || "").trim();
    const value = form.value === "" || form.value === null || Number.isNaN(Number(form.value))
      ? null
      : Number(form.value);
    if (!name) return;

    const id = editingId ?? uid();
    const row = { id, name, value, enabled: !!form.enabled };

    setR((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      // Aynı isim varsa ama farklı id: tekilleştirme – isme göre çoğaltma istemiyorsan aktif kalır
      const without = base.filter((r) => r.id !== id);
      const merged = [...without, row];
      return merged.map((r, i) => ({ ...r, order: i }));
    });

    resetForm();
  };

  const edit = (r) => {
    setEditingId(r.id);
    setForm({ id: r.id, name: r.name || "", value: r.value ?? "", enabled: typeof r.enabled === "boolean" ? r.enabled : true });
  };

  const del = (id) => {
    setR((prev) => (prev || []).filter((r) => r.id !== id).map((r, i) => ({ ...r, order: i })));
    if (editingId === id) resetForm();
  };

  const move = (id, dir) => {
    const arr = [...ordered];
    const i = arr.findIndex((r) => r.id === id);
    if (i < 0) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    const rebased = arr.map((r, k) => ({ ...r, order: k }));
    setR((prev) => (prev || []).map((r) => {
      const f = rebased.find((x) => x.id === r.id);
      return f ? { ...r, order: f.order } : r;
    }));
  };

  const loadDefaults = () => {
    const ok = window.confirm("Varsayılan kural şablonları eklensin mi?");
    if (!ok) return;
    setR((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      const lower = new Set(base.map((x) => (x.name || "").toLowerCase()));
      const fresh = DEFAULT_RULES
        .filter((d) => !lower.has((d.name || "").toLowerCase()))
        .map((d) => ({ ...d, id: uid() }));
      const merged = [...base, ...fresh];
      return merged.map((r, i) => ({ ...r, order: i }));
    });
  };

  const clearAll = () => {
    const ok = window.confirm("Tüm nöbet kuralları silinsin mi?\nBu işlem geri alınamaz.");
    if (!ok) return;
    setR([]);
    resetForm();
  };

  /* ===================== Excel: Dışa Aktar ===================== */
  const exportToExcel = () => {
    const header = [["id", "name", "value", "enabled", "order"]];
    const data = ordered.map((r) => [r.id, r.name, r.value ?? "", r.enabled ? 1 : 0, r.order]);
    const ws = XLSX.utils.aoa_to_sheet([...header, ...data]);
    ws["!cols"] = [ { wch: 36 }, { wch: 40 }, { wch: 10 }, { wch: 8 }, { wch: 8 } ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NobetKurallari");
    XLSX.writeFile(wb, `NobetKurallari_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  /* ===================== Excel: İçe Aktar ===================== */
  const fileInputRef = fileRef; // görünür isim
  const onImportClick = () => fileInputRef.current?.click();

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // aynı dosya tekrar seçilirse tetiklensin
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!aoa || aoa.length < 2) throw new Error("Geçerli veri bulunamadı");

      const header = (aoa[0] || []).map((h) => String(h || "").trim().toLowerCase());
      const idx = (key, fallback) => {
        const i = header.indexOf(key);
        return i >= 0 ? i : fallback;
      };

      // Varsayılan sıralama: id | name | value | enabled | order
      const parsed = aoa.slice(1).map((row) => {
        const id      = String(row[idx("id", 0)] || "").trim() || uid();
        const name    = String(row[idx("name", 1)] || "").trim();
        const rawVal  = row[idx("value", 2)];
        const value   = rawVal === "" || rawVal === null || Number.isNaN(Number(rawVal)) ? null : Number(rawVal);
        const enabled = toBool(row[idx("enabled", 3)]);
        const order   = Number(row[idx("order", 4)])
        ;
        return { id, name, value, enabled, order: Number.isFinite(order) ? order : undefined };
      }).filter((r) => (r.name || "").trim());

      // ID öncelikli birleştirme, yoksa NAME: son gelen kazanır
      const byId = new Map();
      for (const r of parsed) {
        const k = r.id || `name:${(r.name || "").toLowerCase()}`;
        byId.set(k, r);
      }
      const next = normalizeAndSort(Array.from(byId.values()));
      setR(next);
      alert(`Toplam ${next.length} kural içe aktarıldı.`);
    } catch (err) {
      console.error(err);
      alert("Excel içe aktarma başarısız: " + (err?.message || String(err)));
    }
  };

  /* ===================== UI ===================== */
  return (
    <div className="space-y-4 text-sm md:text-base">
      {/* Üst bar */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
        <div className="font-semibold tracking-tight">Nöbet Kuralları</div>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={loadDefaults}
            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
            title="Örnek kural setini ekler (mevcut isimlerle çakışmazsa)."
          >
            Varsayılanları Ekle
          </button>
          <button
            onClick={exportToExcel}
            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
            title="Mevcut kuralları .xlsx olarak dışa aktar."
          >
            Excele Aktar
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onImportFile} />
          <button
            onClick={onImportClick}
            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
            title="Excel dosyasından kuralları içe aktar."
          >
            Excelden Yükle
          </button>
          <button
            onClick={clearAll}
            disabled={!ordered.length}
            className="px-3 py-2 rounded-xl bg-red-50 text-red-700 border border-red-200 disabled:opacity-50"
            title="Tüm kuralları siler."
          >
            Kuralları Sıfırla
          </button>
        </div>
      </div>

      {/* Layout: Sol liste / Sağ form */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {/* SOL: Liste */}
        <div className="md:col-span-3">
          <div className="font-semibold mb-2">Mevcut Kurallar</div>
          <div className="border rounded-2xl overflow-hidden">
            {!ordered.length && (
              <div className="p-3 text-sm text-gray-500">Henüz kural yok.</div>
            )}
            {ordered.map((it, i) => (
              <div key={it.id} className="p-3 flex items-center gap-3 border-b last:border-b-0 hover:bg-gray-50">
                <div className="w-6 text-right text-xs font-semibold">{i + 1}.</div>
                <button onClick={() => edit(it)} className="flex-1 text-left" title="Düzenlemek için tıklayın">
                  <div className="flex items-center gap-2">
                    <span>{it.name}</span>
                    {it.value !== null && it.value !== undefined && it.value !== "" && (
                      <span className="text-xs text-gray-600">= {it.value}</span>
                    )}
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${it.enabled ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-600"}`}>
                      {it.enabled ? "Aktif" : "Pasif"}
                    </span>
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  <button onClick={() => move(it.id, "up")} className="px-2 py-1 text-xs bg-slate-100 rounded" title="Yukarı">↑</button>
                  <button onClick={() => move(it.id, "down")} className="px-2 py-1 text-xs bg-slate-100 rounded" title="Aşağı">↓</button>
                  <button onClick={() => del(it.id)} className="px-2 py-1 text-xs bg-slate-100 rounded" title="Sil">Sil</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SAĞ: Ekle/Düzenle */}
        <div className="md:col-span-2">
          <div className="font-semibold mb-2">Ekle / Düzenle</div>
          <form onSubmit={upsert} className="flex flex-col gap-2 bg-white border rounded-2xl p-3">
            <label className="text-sm">Kural İsmi</label>
            <input
              className="border rounded-xl px-3 py-2"
              placeholder="Örn: Aynı gün bir kişiye en fazla"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />

            <label className="text-sm">Değer (opsiyonel / sayı)</label>
            <input
              type="number"
              className="border rounded-xl px-3 py-2"
              placeholder="Örn: 1, 2, 168..."
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />

            <label className="inline-flex items-center gap-2 text-sm mt-1">
              <input
                type="checkbox"
                checked={!!form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              Kural aktif
            </label>

            <div className="flex gap-2 pt-1">
              <button type="submit" className="px-3 py-2 border rounded-xl bg-emerald-600 text-white">
                {editingId ? "Güncelle" : "Ekle"}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} className="px-3 py-2 border rounded-xl bg-slate-100">
                  İptal
                </button>
              )}
            </div>

            <div className="text-xs text-gray-500 pt-2">
              Not: Bu ekran şablon amaçlıdır. Planlayıcı entegrasyonunda anahtarları (örn. <code>maxPerDayPerPerson</code>) haritalayacağız.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
