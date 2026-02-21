import React, { useEffect, useMemo, useState } from "react";
import { X, Save } from "lucide-react";
import { LS } from "../utils/storage.js";
import { getPeople } from "../lib/dataResolver.js";

const SUP_CFG_KEY = "supervisorConfig";
const SUP_POOL_KEY = "supervisorPool";

function daysIn(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
const U = (s) => (s || "").toString().trim().toLocaleUpperCase("tr-TR");

export default function SupervisorSetup({
  open,
  onClose,
  role = "Nurse",
  year = new Date().getFullYear(),
  month0 = new Date().getMonth(),
}) {
  const people = useMemo(() => (getPeople(role) || []).map(p => ({
    id: String(p.id ?? p.pid ?? p.tc ?? p.code ?? p.fullName),
    name: p.fullName || p.name || p.displayName || String(p.id),
  })), [role]);

  const name2id = useMemo(() => new Map(people.map(p => [U(p.name), p.id])), [people]);

  const [primary, setPrimary] = useState("");
  const [assistants, setAssistants] = useState([]);      // id[]
  const [fallbackPool, setFallbackPool] = useState([]);  // id[]
  const [weekdayOnly, setWeekdayOnly] = useState(true);
  const [ensureAssistCount, setEnsureAssistCount] = useState(1);
  const [assistDays, setAssistDays] = useState(new Set());
  const [offDays, setOffDays] = useState(new Set());
  const [search, setSearch] = useState("");

  // config yükle
  useEffect(() => {
    try {
      const cfg = LS.get(SUP_CFG_KEY, null) || {};
      const pool = LS.get(SUP_POOL_KEY, []);
      if (cfg.primary) setPrimary(String(cfg.primary));
      if (Array.isArray(cfg.assistants)) setAssistants(cfg.assistants.map(String));
      if (Array.isArray(cfg.fallbackPool)) setFallbackPool(cfg.fallbackPool.map(String));
      else if (Array.isArray(pool)) setFallbackPool(pool.map(String));
      setWeekdayOnly(cfg.weekdayOnly !== false);
      setEnsureAssistCount(Number(cfg.ensureAssistCount ?? 1) || 1);

      const toSet = (v) => {
        if (!v) return new Set();
        if (Array.isArray(v)) return new Set(v.map(Number));
        if (typeof v === "object") return new Set(Object.keys(v).map(Number));
        return new Set();
      };
      setAssistDays(toSet(cfg.assistDays));
      setOffDays(toSet(cfg.offDays));
    } catch {}
  }, [open]);

  // arama filtresi
  const filtered = useMemo(() => {
    const s = search.trim().toLocaleLowerCase("tr-TR");
    if (!s) return people;
    return people.filter(p => p.name.toLocaleLowerCase("tr-TR").includes(s));
  }, [people, search]);

  const toggleInSet = (set, d) => {
    const s = new Set(set);
    if (s.has(d)) s.delete(d); else s.add(d);
    return s;
  };

  const save = () => {
    const cfg = {
      primary: primary || null,             // ID veya isim (ID kaydediyoruz)
      assistants: assistants || [],
      fallbackPool: fallbackPool || [],
      weekdayOnly,
      ensureAssistCount: Math.max(0, Number(ensureAssistCount) || 0),
      assistDays: Array.from(assistDays),
      offDays: Array.from(offDays),
    };
    LS.set(SUP_CFG_KEY, cfg);
    LS.set(SUP_POOL_KEY, cfg.fallbackPool || []);
    try { window.dispatchEvent(new Event("supervisor:changed")); } catch {}
    onClose?.();
  };

  const dim = daysIn(year, month0);

  // Yardımcı seçimi (checkbox)
  const toggleAssistant = (id) => {
    setAssistants((arr) => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  };
  const togglePool = (id) => {
    setFallbackPool((arr) => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  };

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}>
      {/* overlay */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      {/* modal */}
      <div
        className={`absolute left-1/2 top-10 -translate-x-1/2 w-[900px] max-w-[95vw] rounded-xl border bg-white shadow-xl transition-all ${open ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
      >
        <div className="p-4 border-b flex items-center gap-3">
          <div className="font-semibold">Sorumlu Ayarları</div>
          <span className="text-xs text-slate-500">({role === "Doctor" ? "Doktor" : "Hemşire"})</span>
          <button className="ml-auto h-8 w-8 rounded hover:bg-slate-100 flex items-center justify-center" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 grid grid-cols-12 gap-4">
          {/* Sol: kişi listesi ve arama */}
          <div className="col-span-5">
            <div className="mb-2 text-sm">Personel</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ara..."
              className="w-full h-9 rounded border px-2 mb-2"
            />
            <div className="border rounded-lg h-[420px] overflow-auto">
              {filtered.map(p => (
                <div key={p.id} className="px-3 py-2 flex items-center gap-2 border-b last:border-b-0">
                  <input
                    type="radio"
                    name="primary"
                    checked={primary === p.id}
                    onChange={() => setPrimary(p.id)}
                    title="Asıl Sorumlu"
                  />
                  <div className="flex-1">{p.name}</div>
                  <label className="text-xs inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={assistants.includes(p.id)}
                      onChange={() => toggleAssistant(p.id)}
                    />
                    Yardımcı
                  </label>
                  <label className="text-xs inline-flex items-center gap-1 ml-2">
                    <input
                      type="checkbox"
                      checked={fallbackPool.includes(p.id)}
                      onChange={() => togglePool(p.id)}
                    />
                    Havuz
                  </label>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              İpucu: Bir kişiyi hem “Yardımcı” hem “Havuz” olarak işaretleyebilirsin.
            </div>
          </div>

          {/* Sağ: kurallar */}
          <div className="col-span-7 space-y-4">
            <div className="rounded-lg border p-3">
              <div className="font-medium mb-2">Genel</div>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={weekdayOnly}
                    onChange={(e) => setWeekdayOnly(e.target.checked)}
                  />
                  Sadece hafta içi
                </label>
                <div className="flex items-center gap-2">
                  Yardımcı kişi sayısı (assistDays’de min):
                  <input
                    type="number"
                    min={0}
                    className="h-8 w-16 rounded border px-2 text-center"
                    value={ensureAssistCount}
                    onChange={(e) => setEnsureAssistCount(Number(e.target.value || 0))}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="font-medium mb-2">Gün Ayarları ({year}-{String(month0+1).padStart(2,"0")})</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-sm mb-1">Yardımcı İstenen Günler</div>
                  <DayGrid
                    year={year}
                    month0={month0}
                    selected={assistDays}
                    onToggle={(d) => setAssistDays(s => toggleInSet(s, d))}
                  />
                </div>
                <div>
                  <div className="text-sm mb-1">Primary Yazılmasın (Off Days)</div>
                  <DayGrid
                    year={year}
                    month0={month0}
                    selected={offDays}
                    onToggle={(d) => setOffDays(s => toggleInSet(s, d))}
                  />
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Not: Assist günlerinde, satırdaki ihtiyaç “primary + belirtilen yardımcı sayısı” kadar yükseltilir.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="h-9 px-3 rounded border" onClick={onClose}>Vazgeç</button>
              <button className="h-9 px-3 rounded bg-sky-600 text-white inline-flex items-center gap-2" onClick={save}>
                <Save className="w-4 h-4" /> Kaydet
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Küçük gün ızgarası */
function DayGrid({ year, month0, selected, onToggle }) {
  const dim = daysIn(year, month0);
  return (
    <div className="grid grid-cols-7 gap-1">
      {Array.from({ length: dim }, (_, i) => i + 1).map((d) => {
        const on = selected.has(d);
        return (
          <button
            key={d}
            className={`h-8 rounded border text-sm ${on ? "bg-sky-600 text-white border-sky-600" : "bg-white hover:bg-slate-50"}`}
            onClick={() => onToggle?.(d)}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}
