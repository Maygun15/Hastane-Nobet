// src/tabs/WorkAreasTab.jsx
import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import IDCard from "../components/IDCard.jsx";
import {
  normalizeWorkAreaMasterList,
  resolvePersonWorkAreaIds,
  resolvePersonWorkAreaNames,
} from "../lib/workAreasModel.js";
const norm = (s) => (s || "").toString().trim().toLocaleUpperCase("tr-TR");
const sortAreaNames = (list) =>
  [...(Array.isArray(list) ? list : [])].sort((a, b) =>
    String(a || "").localeCompare(String(b || ""), "tr", { sensitivity: "base" })
  );
const sortAreaDefs = (list) =>
  [...(Array.isArray(list) ? list : [])].sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""), "tr", { sensitivity: "base" })
  );
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
const badgeToneByCount = (count) => {
  if (count <= 0) return "bg-red-50 text-red-700 border-red-200";
  if (count < 5) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
};

function useAreas(external, setExternal) {
  const list = Array.isArray(external) ? external : [];
  const setAreas = (updater) => {
    if (typeof setExternal !== "function") return;
    setExternal((prev) => (typeof updater === "function" ? updater(prev ?? []) : updater));
  };
  return [list, setAreas];
}

function extractAreaNamesFromPerson(person, masterAreas) {
  return uniq(
    resolvePersonWorkAreaNames(person, masterAreas).flatMap((name) => splitNames(name))
  );
}

function extractAreaKeysFromPerson(person, masterAreas) {
  const names = extractAreaNamesFromPerson(person, masterAreas);
  const ids = resolvePersonWorkAreaIds(person, masterAreas);
  const keys = [
    ...names.map(slugTR),
    ...ids.map(slugTR),
  ].filter(Boolean);
  return new Set(keys);
}

function personMatchesArea(person, area, masterAreas) {
  const key = area.key;
  const keys = extractAreaKeysFromPerson(person, masterAreas);
  if (keys.has(key)) return true;
  const areaText = area.norm;
  const personNames = extractAreaNamesFromPerson(person, masterAreas).map(normText);
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
  const [areas, setAreas] = useAreas(workAreas, setWorkAreas);
  const peopleList = Array.isArray(people) ? people : [];
  const masterWorkAreas = useMemo(
    () => normalizeWorkAreaMasterList(areas),
    [areas]
  );
  const areaDefs = useMemo(
    () =>
      sortAreaDefs(masterWorkAreas.map((item) => ({
        name: item.name,
        key: item.key,
        norm: normText(item.name),
      }))),
    [masterWorkAreas]
  );
  const displayAreas = useMemo(
    () =>
      areaDefs
        .map((area) => ({
          ...area,
          rawIndex: (areas || []).findIndex((name) => norm(name) === norm(area.name)),
        }))
        .filter((area) => area.rawIndex >= 0),
    [areaDefs, areas]
  );
  const peopleByArea = useMemo(() => {
    const map = new Map();
    areaDefs.forEach((a) => map.set(a.key, []));
    areaDefs.forEach((area) => {
      const list = peopleList.filter((p) => personMatchesArea(p, area, masterWorkAreas));
      list.sort((a, b) =>
        (a?.name || a?.fullName || "")
          .toString()
          .localeCompare((b?.name || b?.fullName || "").toString(), "tr", { sensitivity: "base" })
      );
      map.set(area.key, list);
    });
    return map;
  }, [areaDefs, peopleList, masterWorkAreas]);

  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [selectedAreaKey, setSelectedAreaKey] = useState(null);
  const fileRef = useRef(null);
  const filteredDisplayAreas = useMemo(() => {
    const q = normText(query);
    if (!q) return displayAreas;
    return displayAreas.filter((area) => area.norm.includes(q));
  }, [displayAreas, query]);
  const selectedArea =
    filteredDisplayAreas.find((area) => area.key === selectedAreaKey) ||
    displayAreas.find((area) => area.key === selectedAreaKey) ||
    filteredDisplayAreas[0] ||
    displayAreas[0] ||
    null;
  const selectedPeople = selectedArea ? (peopleByArea.get(selectedArea.key) || []) : [];

  /* -------- CRUD -------- */
  const addArea = () => {
    const v = name.trim();
    if (!v) return alert("Alan adı boş olamaz.");
    if (areas.some((a) => norm(a) === norm(v))) return alert("Bu alan zaten var.");
    setAreas((prev) => sortAreaNames([...prev, v]));
    setSelectedAreaKey(slugTR(v));
    setName("");
  };

  const removeArea = (idx) => {
    // Düzenlenen satırı silerken düzenleme modunu kapat
    if (editingIndex === idx) cancelEdit();
    if (selectedArea && idx === selectedArea.rawIndex) {
      setSelectedAreaKey(null);
    }
    setAreas((prev) => prev.filter((_, i) => i !== idx));
  };

  const startEdit = (idx) => {
    setEditingIndex(idx);
    setEditingValue(areas[idx]);
    setSelectedAreaKey(slugTR(areas[idx]));
  };

  const saveEdit = () => {
    const v = editingValue.trim();
    if (!v) return alert("Alan adı boş olamaz.");
    // aynı isim var mı? (kendi satırı hariç)
    if (areas.some((a, i) => i !== editingIndex && norm(a) === norm(v))) {
      return alert("Bu ad zaten mevcut.");
    }
    setAreas((prev) => sortAreaNames(prev.map((a, i) => (i === editingIndex ? v : a))));
    setSelectedAreaKey(slugTR(v));
    cancelEdit();
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue("");
  };

  const resetAreas = () => {
    if (!confirm("Tüm alanları sıfırlamak istiyor musunuz?")) return;
    cancelEdit();
    setSelectedAreaKey(null);
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
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "binary" });
        const sheet = wb.Sheets["CalismaAlanlari"] ?? wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const list = json
          .map((r) => r.ALAN ?? r.alan ?? r.Alan ?? Object.values(r)[0])
          .map(String).map((s) => s.trim()).filter(Boolean);

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
        setAreas(sortAreaNames(cleaned));
        alert("Excel'den yükleme tamam.");
      } catch (err) {
        console.error(err);
        alert(`Excel yüklenemedi: ${err?.message || "Beklenen sayfa: CalismaAlanlari, başlık: ALAN"}`);
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

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <div className="space-y-4">
          <div className="rounded-xl border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50">
              <div className="text-sm font-medium text-slate-700">Mevcut Alanlar</div>
              <div className="text-xs text-slate-500 mt-1">Bir alan seçerek detayını sağ panelde yönetin.</div>
            </div>
            <div className="p-3">
              <div className="mb-3">
                <input
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Alan ara..."
                />
              </div>
              <ol className="space-y-2">
                {filteredDisplayAreas.map((area, i) => {
                  const isSelected = selectedArea?.key === area.key;
                  const listCount = peopleByArea.get(area.key)?.length || 0;
                  const badgeTone = badgeToneByCount(listCount);
                  return (
                    <li key={area.key}>
                      <button
                        type="button"
                        onClick={() => setSelectedAreaKey(area.key)}
                        className={`w-full text-left rounded-lg border px-3 py-3 transition ${
                          isSelected
                            ? "border-sky-500 bg-sky-50 ring-2 ring-sky-100 text-slate-900 shadow-sm"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-medium">
                            {i + 1}. {area.name}
                          </span>
                          <span className={`shrink-0 text-xs px-2 py-1 rounded-full border ${badgeTone}`}>
                            {listCount} kişi
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
                {displayAreas.length === 0 && <li className="text-sm text-gray-500">Henüz alan yok.</li>}
                {displayAreas.length > 0 && filteredDisplayAreas.length === 0 && (
                  <li className="text-sm text-gray-500">Arama ile eşleşen alan bulunamadı.</li>
                )}
              </ol>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <div className="text-sm font-medium text-slate-700 mb-2">Yeni Alan Ekle</div>
            <div className="flex items-center gap-2">
              <input
                className="px-3 py-2 border rounded w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder=""
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

        <div className="space-y-4">
          <div className="rounded-xl border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-700">Seçili Alan</div>
                <div className="text-xs text-slate-500 mt-1">
                  {selectedArea ? "Alan adını düzenleyebilir veya silebilirsiniz." : "Detayları görmek için soldan bir alan seçin."}
                </div>
              </div>
              {selectedArea && (
                <span className={`shrink-0 text-sm font-semibold px-3 py-1 rounded-full border ${badgeToneByCount(selectedPeople.length)}`}>
                  {selectedPeople.length} kişi
                </span>
              )}
            </div>
            <div className="p-4">
              {selectedArea ? (
                <div className="space-y-4">
                  <div className="rounded-lg border bg-slate-50 p-4">
                    {editingIndex === selectedArea.rawIndex ? (
                      <div className="space-y-3">
                        <input
                          className="w-full px-3 py-2 border rounded bg-white"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <button type="button" className="text-sm px-3 py-2 border rounded bg-white" onClick={saveEdit}>
                            Kaydet
                          </button>
                          <button type="button" className="text-sm px-3 py-2 border rounded bg-white" onClick={cancelEdit}>
                            İptal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-xs uppercase tracking-wide text-slate-400">Alan Adı</div>
                          <div className="text-lg font-semibold text-slate-800 mt-1 break-words">{selectedArea.name}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            className="text-sm px-3 py-2 border rounded bg-white"
                            onClick={() => startEdit(selectedArea.rawIndex)}
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            className="text-sm px-3 py-2 border rounded bg-white text-red-600"
                            onClick={() => removeArea(selectedArea.rawIndex)}
                          >
                            Sil
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500">Alan ekledikçe veya soldan seçim yaptıkça detaylar burada görünür.</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50">
              <div className="text-sm font-medium text-slate-700">Seçilen Alanda Çalışanlar</div>
              <div className="text-xs text-slate-500 mt-1">
                {selectedArea ? `${selectedArea.name} alanındaki personel listesi` : "Personel listesini görmek için soldan bir alan seçin."}
              </div>
            </div>
            <div className="p-4">
              {selectedArea ? (
                selectedPeople.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                    {selectedPeople.map((p, idx) => (
                      <IDCard key={getPersonKey(p, idx)} person={p} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Bu alanda kayıtlı kişi yok. Personel kartlarında bu alana ait isim veya ilişki bilgisi bulunmuyor olabilir.
                  </div>
                )
              ) : (
                <div className="text-sm text-gray-500">Henüz seçili alan yok.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
