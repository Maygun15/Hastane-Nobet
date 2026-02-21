// src/tabs/RequestBoxTab.jsx
import React, { useEffect, useMemo, useState } from "react";
import { parseRequestText } from "../lib/requestParser.js";

const LS_KEY = "requestBoxV1";
const LS_LAST_PERSON = "requestBoxLastPersonV1";

function readPlannerYM() {
  const year = Number(localStorage.getItem("plannerYear")) || new Date().getFullYear();
  const month1 = Number(localStorage.getItem("plannerMonth1")) || new Date().getMonth() + 1;
  return { year, month1 };
}

/* ----------------------------------------------------------
   Kişi kaynağı öncelik sırası:
   1) props.people
   2) localStorage: "peopleV1" | "personsV1"
   3) Toplu İzin kaynağı: "bulkLeavesV1" | "bulkLeaves" | "topluIzinV1"
   ---------------------------------------------------------- */
function usePeople(external) {
  const BULK_KEYS = ["bulkLeavesV1", "bulkLeaves", "topluIzinV1"];

  const readLocal = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const normalizeArray = (arr) =>
    (arr || [])
      .map((p, i) => {
        // Bazı Excel importları dizi döndürür: [ad, tc, ...]
        if (Array.isArray(p)) {
          const [maybeName, maybeId] = p;
          return {
            id: String(maybeId ?? i + 1),
            name: String(maybeName ?? `Kişi ${i + 1}`),
            service: "",
          };
        }
        // Nesne: esnek alan isimleri
        const id =
          p.id ??
          p.personId ??
          p.tc ??
          p.TC ??
          p.kimlikNo ??
          p.tcKimlikNo ??
          String(i + 1);
        const name =
          p.name ??
          p.fullName ??
          [p.firstName, p.lastName].filter(Boolean).join(" ") ??
          p.personelAdi ??
          p.adSoyad ??
          p.personName ??
          p.AdSoyad ??
          String(p);
        const service =
          p.service ??
          p.serviceId ??
          p.department ??
          p.servis ??
          p.Servis ??
          "";
        return { id: String(id), name: String(name), service: String(service || "") };
      })
      .filter((x) => x.id && x.name);

  // 1) props.people
  if (Array.isArray(external) && external.length) {
    return normalizeArray(external);
  }

  // 2) peopleV1 / personsV1
  const peopleFromLS = readLocal("peopleV1") || readLocal("personsV1");
  if (Array.isArray(peopleFromLS) && peopleFromLS.length) {
    return normalizeArray(peopleFromLS);
  }

  // 2b) Diğer personel anahtarları (Personel sekmesi, importlar)
  const OTHER_PERSON_KEYS = [
    "peopleAll",
    "people",
    "personList",
    "personnel",
    "nurses",
    "staff",
  ];
  for (const key of OTHER_PERSON_KEYS) {
    const val = readLocal(key);
    if (!val) continue;
    if (Array.isArray(val) && val.length) return normalizeArray(val);
    if (val && typeof val === "object") {
      const arr = Array.isArray(val.items)
        ? val.items
        : Array.from(Object.values(val)).flat();
      if (Array.isArray(arr) && arr.length) return normalizeArray(arr);
    }
  }

  // 3) Toplu İzin kaynağı (ilk bulunan anahtar)
  for (const k of BULK_KEYS) {
    const bulk = readLocal(k);
    if (Array.isArray(bulk) && bulk.length) {
      // Toplu izin satırları -> kişiye indirgeme
      const normalized = normalizeArray(
        bulk.map((r) => ({
          id:
            r.personId ??
            r.tc ??
            r.TC ??
            r.id ??
            r.kimlikNo ??
            r.tcKimlikNo,
          name:
            r.personName ??
            r.name ??
            r.fullName ??
            [r.firstName, r.lastName].filter(Boolean).join(" ") ??
            r.personelAdi ??
            r.adSoyad ??
            r.AdSoyad,
        }))
      );
      // benzersizleştir (id öncelikli, yoksa name)
      const map = new Map();
      for (const p of normalized) {
        const key = p.id || p.name.toLowerCase();
        if (!map.has(key)) map.set(key, p);
      }
      return Array.from(map.values());
    }
  }

  // 4) hiçbiri yoksa boş
  return [];
}

export default function RequestBoxTab({ people: peopleProp }) {
  const people = usePeople(peopleProp);
  const services = useMemo(() => {
    const set = new Set();
    for (const p of people) if (p.service) set.add(p.service);
    return Array.from(set.values());
  }, [people]);

  const [list, setList] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [type, setType] = useState("NOTE"); // NOTE | OFF | SHIFT
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Açık liste (listbox) seçimi
  const [personId, setPersonId] = useState(() => {
    try {
      return localStorage.getItem(LS_LAST_PERSON) || "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list));
    } catch {}
  }, [list]);

  useEffect(() => {
    try {
      if (personId) localStorage.setItem(LS_LAST_PERSON, personId);
    } catch {}
  }, [personId]);

  const selectedPerson =
    people.find((p) => String(p.id) === String(personId)) || null;
  const filteredPeople = useMemo(() => {
    return people.filter((p) => {
      if (serviceFilter && p.service !== serviceFilter) return false;
      if (searchTerm && !p.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [people, serviceFilter, searchTerm]);

  const add = () => {
    const t = text.trim();
    if (!t && !selectedPerson && !date) return; // tamamen boş eklenmesin
    const { year, month1 } = readPlannerYM();
    const analysis = parseRequestText({
      text: t,
      type,
      date,
      defaultYear: year,
      defaultMonth: month1,
    });

    setList((prev) => [
      ...prev,
      {
        id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
        type,
        text: t || "",
        personId: selectedPerson?.id ?? null,
        personName: selectedPerson?.name ?? null,
        date: date || null, // YYYY-MM-DD
        active: true,
        createdAt: new Date().toISOString(),
        analysis,
      },
    ]);

    setText("");
    // seri giriş için kişi ve tarihi bırakıyoruz
  };

  const toggle = (id) =>
    setList((prev) => prev.map((x) => (x.id === id ? { ...x, active: !x.active } : x)));
  const del = (id) => setList((prev) => prev.filter((x) => x.id !== id));
  const move = (i, dir) =>
    setList((prev) => {
      const arr = [...prev];
      const j = dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });

  return (
    <div className="space-y-4">
      {/* Üst bar */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="border rounded-xl px-3 py-2"
          title="İstek türü"
        >
          <option value="NOTE">Not/Mazeret (NOTE)</option>
          <option value="OFF">Boş Gün İsteği (OFF)</option>
          <option value="SHIFT">Vardiya Tercihi (SHIFT)</option>
        </select>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-500">Kişi:</label>
          {people.length ? (
            <>
              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="border rounded-xl px-3 py-2 min-w-[140px]"
                title="Servis filtrele"
              >
                <option value="">Tüm servisler</option>
                {services.map((svc) => (
                  <option key={svc} value={svc}>
                    {svc}
                  </option>
                ))}
              </select>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Ara…"
                className="border rounded-xl px-3 py-2 min-w-[140px]"
              />
              <select
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className="border rounded-xl px-3 py-2 min-w-[220px]"
                title="Kişi seç"
              >
                <option value="">(Seçiniz)</option>
                {filteredPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.service ? ` — ${p.service}` : ""}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="text-xs text-gray-400">Kişi listesi boş</span>
          )}
        </div>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-xl px-3 py-2"
          title="Tarih (opsiyonel)"
        />

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="İstek/mazeret metni…"
          className="flex-1 min-w-[220px] border rounded-xl px-3 py-2"
          onKeyDown={(e) => e.key === "Enter" && add()}
        />

        <button onClick={add} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50">
          Ekle
        </button>
      </div>

      {/* İki kolon: solda açık kişi listesi, sağda kayıtlar */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {/* Sol — her zaman açık kişi listesi */}
        <div className="md:col-span-2">
          <div className="font-semibold mb-2">Kişi</div>
          <div className="bg-white border rounded-2xl p-3">
            {people.length === 0 ? (
              <div className="text-sm text-gray-500">
                Kişi listesi boş. People tab’ından ekleyebilir veya
                <code className="mx-1">peopleV1</code>/<code>personsV1</code> ya da
                <code className="mx-1">bulkLeavesV1</code> anahtarını doldurabilirsiniz.
              </div>
            ) : (
              <select
                size={Math.min(10, Math.max(6, people.length))}
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className="w-full border rounded-xl p-2"
              >
                <option value="">(Kişi seçiniz)</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <div className="mt-2 text-xs text-gray-500">
              İpucu: Listeden bir kişi seçildiğinde üst formda otomatik kullanılır.
            </div>
          </div>
        </div>

        {/* Sağ — istek listesi */}
        <div className="md:col-span-3">
          <div className="font-semibold mb-2">Kayıtlar</div>
          <div className="border rounded-2xl overflow-hidden">
            {!list.length && <div className="p-4 text-gray-500">Henüz kayıt yok.</div>}
            {list.map((it, i) => (
              <div key={it.id} className="p-4 border-b last:border-b-0 flex items-start gap-3">
                <div className="w-6 text-right text-xs font-semibold mt-1">{i + 1}.</div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-700 border-gray-200">
                      {it.type}
                    </span>
                    {it.personName && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200">
                        {it.personName}
                      </span>
                    )}
                    {it.date && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                        {it.date}
                      </span>
                    )}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        it.active
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      {it.active ? "Aktif" : "Pasif"}
                    </span>
                  </div>

                  {it.text && <div className="mt-1 text-gray-800 break-words">{it.text}</div>}

                  {Array.isArray(it.analysis?.segments) && it.analysis?.segments.length > 0 && (
                    <div className="mt-2 text-xs text-slate-600 space-y-1">
                      {it.analysis.segments.map((seg, idx) => (
                        <div key={idx}>
                          {seg.startDay ? `${seg.startDay}${seg.endDay && seg.endDay !== seg.startDay ? `-${seg.endDay}` : ""}` : "Belirsiz gün"}
                          {seg.month ? ` ${formatMonth(seg.month)}` : ""} {seg.year || ""} →
                          {" "}{seg.intent === "avoid" ? "Kaçın" : "Tercih"}
                          {seg.shift ? ` (${seg.shift})` : ""}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => toggle(it.id)}
                      className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-gray-50"
                    >
                      {it.active ? "Pasifleştir" : "Etkinleştir"}
                    </button>
                    <button
                      onClick={() => del(it.id)}
                      className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-red-50 text-red-600"
                    >
                      Sil
                    </button>
                    <button
                      onClick={() => move(i, "up")}
                      className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-gray-50"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, "down")}
                      className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-gray-50"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs text-gray-500 mt-2">
            Not: Kişi ve tarih alanları opsiyoneldir; yalnızca metinle de kayıt oluşturabilirsiniz.
          </div>
        </div>
      </div>
    </div>
  );
}

const MONTH_LABELS = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function formatMonth(m) {
  return MONTH_LABELS[m] || `Ay ${m}`;
}
