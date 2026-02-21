// src/tabs/WorkAreasTab.jsx
import React, { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";

const LS_KEY = "workAreasV1";
const norm = (s) => (s || "").toString().trim().toLocaleUpperCase("tr-TR");

export default function WorkAreasTab() {
  const [areas, setAreas] = useState(() => {
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

  const [name, setName] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(areas)); } catch {}
  }, [areas]);

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
    </div>
  );
}
