// src/tabs/WorkAreasTab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import IDCard from "../components/IDCard.jsx";

const LS_KEY = "workAreas";
const norm = (s) => (s || "").toString().trim().toLocaleUpperCase("tr-TR");
const slugTR = (s = "") =>
  s
    .toString()
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[şŞ]/g, "s")
    .replace(/[ıİI]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const stripDiacritics = (s) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const normText = (s) =>
  stripDiacritics(s).toString().trim().toLocaleUpperCase("tr-TR").replace(/\s+/g, " ");
const splitNames = (s) =>
  s
    .toString()
    .split(/,|;/)
    .map((x) => x.trim())
    .filter(Boolean);
const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

function useHybridAreas(external, setExternal) {
  const controlled = typeof setExternal === "function" && Array.isArray(external);

  const [inner, setInner] = useState(() => {
    if (controlled) return [];
    try {
      const s = localStorage.getItem(LS_KEY);
      return s
        ? JSON.parse(s)
        : [
            "AŞI","CERRAHİ MÜDAHELE","ÇOCUK","ECZANE","EKİP SORUMLUSU","KIRMIZI",
            "KIRMIZI VE SARI ALAN GÖREVLENDİRME","RESÜSİTASYON","SARI",
            "SERVİS SORUMLUSU","SÜPERVİZÖR","TRİAJ","YEŞİL",
          ];
    } catch { return []; }
  });

  const setAreas = (updater) => {
    if (controlled) {
      setExternal((prev) => (typeof updater === "function" ? updater(prev ?? []) : updater));
    } else {
      setInner((prev0) => {
        const next = typeof updater === "function" ? updater(prev0 ?? []) : updater;
        try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }
  };

  const list = controlled ? (external ?? []) : (inner ?? []);

  useEffect(() => {
    if (!controlled) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(list ?? [])); } catch {}
    }
  }, [controlled, list]);

  return [list, setAreas, controlled];
}

function extractAreaNamesFromPerson(person) {
  const out = [];
  const raw =
    person?.areas ??
    person?.meta?.areas ??
    person?.workAreas ??
    person?.workareas ??
    [];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const it of arr) {
    if (typeof it === "string") {
      out.push(...splitNames(it));
    } else if (it && typeof it === "object") {
      const name = it?.name || it?.label || it?.title || it?.id;
      if (name) out.push(...splitNames(name));
    }
  }
  return uniq(out);
}

function extractAreaKeysFromPerson(person) {
  const names = extractAreaNamesFromPerson(person);
  const idsRaw =
    person?.workAreaIds ??
    person?.areaIds ??
    person?.meta?.workAreaIds ??
    person?.meta?.areaIds ??
    [];
  const ids = Array.isArray(idsRaw) ? idsRaw.map((x) => String(x || "")) : [];
  const keys = [
    ...names.map(slugTR),
    ...ids.map(slugTR),
  ].filter(Boolean);
  return new Set(keys);
}

function personMatchesArea(person, area) {
  const key = area.key;
  const keys = extractAreaKeysFromPerson(person);
  if (keys.has(key)) return true;
  const areaText = area.norm;
  const personNames = extractAreaNamesFromPerson(person).map(normText);
  return personNames.some((p) => p === areaText || p.includes(areaText) || areaText.includes(p));
}

function getPersonKey(p, i) {
  return (
    p?.id ||
    p?._id ||
    p?.personId ||
    p?.tc ||
    p?.email ||
    p?.name ||
    p?.fullName ||
    `p-${i}`
  );
}

export default function WorkAreasTab({ workAreas, setWorkAreas, people = [] }) {
  const [areas, setAreas] = useHybridAreas(workAreas, setWorkAreas);
  const peopleList = Array.isArray(people) ? people : [];
  const areaDefs = useMemo(
    () =>
      (areas || []).map((name) => ({
        name,
        key: slugTR(name),
        norm: normText(name),
      })),
    [areas]
  );
  const peopleByArea = useMemo(() => {
    const map = new Map();
    areaDefs.forEach((a) => map.set(a.key, []));
    areaDefs.forEach((area) => {
      const list = peopleList.filter((p) => personMatchesArea(p, area));
      list.sort((a, b) =>
        (a?.name || a?.fullName || "")
          .toString()
          .localeCompare((b?.name || b?.fullName || "").toString(), "tr", { sensitivity: "base" })
      );
      map.set(area.key, list);
    });
    return map;
  }, [areaDefs, peopleList]);

  const [name, setName] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const fileRef = useRef(null);

  /* -------- CRUD -------- */
  const addArea = () => {
    const v = name.trim();
    if (!v) return alert("Alan adı boş olamaz.");
    if (areas.some((a) => norm(a) === norm(v))) return alert("Bu alan zaten var.");
    setAreas((prev) => [...prev, v]);
    setName("");
  };

  const removeArea = (idx) => {
    // Düzenlenen satırı silerken düzenleme modunu kapat
    if (editingIndex === idx) cancelEdit();
    setAreas((prev) => prev.filter((_, i) => i !== idx));
  };

  const startEdit = (idx) => {
    setEditingIndex(idx);
    setEditingValue(areas[idx]);
  };

  const saveEdit = () => {
    const v = editingValue.trim();
    if (!v) return alert("Alan adı boş olamaz.");
    // aynı isim var mı? (kendi satırı hariç)
    if (areas.some((a, i) => i !== editingIndex && norm(a) === norm(v))) {
      return alert("Bu ad zaten mevcut.");
    }
    setAreas((prev) => prev.map((a, i) => (i === editingIndex ? v : a)));
    cancelEdit();
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue("");
  };

  const resetAreas = () => {
    if (!confirm("Tüm alanları sıfırlamak istiyor musunuz?")) return;
    cancelEdit();
    setAreas([]);
  };

  /* -------- Excel -------- */
  const exportExcel = () => {
    const rows = areas.map((a) => ({ ALAN: a }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CalismaAlanlari");
    XLSX.writeFile(wb, "calisma_alanlari.xlsx");
  };

  const importExcel = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "binary" });
        const sheet = wb.Sheets["CalismaAlanlari"] ?? wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const list = json
          .map((r) => r.ALAN ?? r.alan ?? r.Alan ?? Object.values(r)[0])
          .map(String).map((s) => s.trim()).filter(Boolean);

        // başlık/tekrar temizliği
        const cleaned = [];
        const seen = new Set();
        for (const v of list) {
          const key = norm(v);
          if (key && key !== "ALAN" && !seen.has(key)) {
            seen.add(key);
            cleaned.push(v);
          }
        }
        cancelEdit();
        setAreas(cleaned);
        alert("Excel'den yükleme tamam.");
      } catch (err) {
        console.error(err);
        alert("Excel yüklenemedi. (Beklenen sayfa: CalismaAlanlari, başlık: ALAN)");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsBinaryString(f);
  };

  return (
    <div className="space-y-4">
      {/* Üst sağ butonlar */}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="px-3 py-2 text-sm border rounded" onClick={exportExcel}>
          Excele Aktar
        </button>
        <label className="px-3 py-2 text-sm border rounded cursor-pointer">
          Excelden Yükle
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importExcel} />
        </label>
        <button type="button" className="px-3 py-2 text-sm border rounded text-red-600" onClick={resetAreas}>
          Alanları Sıfırla
        </button>
      </div>

      <h3 className="font-medium">Çalışma Alanları</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Sol: liste */}
        <div>
          <div className="text-sm mb-2 text-gray-500">Mevcut Alanlar</div>
          <ol className="space-y-1">
            {areas.map((a, i) => (
              <li key={a + i} className="flex items-center justify-between px-3 py-2 rounded border bg-white">
                <div className="flex-1 min-w-0">
                  {editingIndex === i ? (
                    <input
                      className="w-full px-2 py-1 border rounded"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      autoFocus
                    />
                  ) : (
                    <span className="truncate">
                      <b>{i + 1}.</b> {a}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3">
                  {editingIndex === i ? (
                    <>
                      <button type="button" className="text-sm px-2 py-1 border rounded" onClick={saveEdit}>
                        Kaydet
                      </button>
                      <button type="button" className="text-sm px-2 py-1 border rounded" onClick={cancelEdit}>
                        İptal
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="text-sm px-2 py-1 border rounded" onClick={() => startEdit(i)}>
                        Düzenle
                      </button>
                      <button type="button" className="text-sm px-2 py-1 border rounded" onClick={() => removeArea(i)}>
                        Sil
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
            {areas.length === 0 && <li className="text-sm text-gray-500">Henüz alan yok.</li>}
          </ol>
        </div>

        {/* Sağ: ekle */}
        <div>
          <div className="text-sm mb-2 text-gray-500">Ekle</div>
          <div className="flex items-center gap-2">
            <input
              className="px-3 py-2 border rounded w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="" /* örnek yok */
            />
            <button type="button" className="px-3 py-2 text-sm border rounded" onClick={addArea}>
              Ekle
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Not: Excel içe/dışa aktarma için başlık <b>ALAN</b> kullanılır. İlk sütun değerleri alan adı olarak okunur.
          </div>
        </div>
      </div>

      {/* Alan bazlı personel kartları */}
      <div className="pt-2 space-y-3">
        <h3 className="font-medium">Alanlarda Çalışanlar</h3>
        <div className="space-y-3">
          {areaDefs.map((area) => {
            const list = peopleByArea.get(area.key) || [];
            return (
              <details key={area.key} className="rounded-lg border bg-white">
                <summary className="cursor-pointer select-none px-3 py-2 flex items-center justify-between">
                  <span className="font-medium">{area.name}</span>
                  <span className="text-xs text-slate-500">{list.length} kişi</span>
                </summary>
                <div className="p-3 border-t">
                  {list.length ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {list.map((p, idx) => (
                        <IDCard key={getPersonKey(p, idx)} person={p} />
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">Bu alanda kayıtlı kişi yok.</div>
                  )}
                </div>
              </details>
            );
          })}
          {areaDefs.length === 0 && (
            <div className="text-sm text-gray-500">Alan ekledikçe burada personel kartları görünür.</div>
          )}
        </div>
      </div>
    </div>
  );
}
