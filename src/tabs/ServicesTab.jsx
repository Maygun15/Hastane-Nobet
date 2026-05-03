// src/tabs/ServicesTab.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useServicesModel, { useServices } from "../hooks/useServicesModel.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { PERMISSIONS } from "../constants/roles.js";
import * as XLSX from "xlsx";

/* ---------------- helpers ---------------- */
function slugCode(s = "") {
  return s
    .toString()
    .trim()
    .toUpperCase()
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ş/g, "S")
    .replace(/İ/g, "I")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function useDebounced(fn, delay = 300) {
  const t = useRef();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => clearTimeout(t.current), []);
  return useCallback((...args) => {
    clearTimeout(t.current);
    t.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]);
}
const toBool = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return true;
  const yes = ["1", "true", "evet", "aktif", "active", "yes", "x"];
  const no = ["0", "false", "hayir", "hayır", "pasif", "inactive", "no"];
  if (yes.includes(s)) return true;
  if (no.includes(s)) return false;
  return true;
};

/* ---------------- Modal (Ekle/Düzenle) ---------------- */
function ServiceModal({ open, onClose, onSubmit, existingCodes, initial }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setCode(initial?.code || "");
      setAuto(!initial);
    } else {
      setName("");
      setCode("");
      setAuto(true);
    }
  }, [open, initial]);

  if (!open) return null;

  const codeUpper = (code || "").toUpperCase();
  const codeExists =
    codeUpper &&
    existingCodes.has(codeUpper) &&
    codeUpper !== (initial?.code || "").toUpperCase();

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-lg font-semibold">
            {initial ? "Servisi Düzenle" : "Yeni Servis"}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Ad</label>
            <input
              className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="Örn. Genel Cerrahi"
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (auto) setCode(slugCode(v));
              }}
            />
          </div>

          <div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-sm text-slate-600 mb-1">Kod</label>
                <input
                  className={`w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 ${
                    codeExists
                      ? "border-red-400 focus:ring-red-300"
                      : "focus:ring-sky-400"
                  }`}
                  placeholder="GENEL_CERRAHI"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setAuto(false);
                  }}
                />
                {codeExists && (
                  <div className="text-xs text-red-600 mt-1">
                    Bu kod zaten kullanılıyor.
                  </div>
                )}
              </div>
              <button
                className="h-10 px-3 border rounded-lg"
                onClick={() => {
                  setCode(slugCode(name));
                  setAuto(true);
                }}
              >
                Kod üret
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="border rounded-xl px-4 py-2" onClick={onClose}>
            Vazgeç
          </button>
          <button
            className="rounded-xl bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-50"
            disabled={!name.trim() || !code.trim() || codeExists}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                code: code.trim().toUpperCase(),
              })
            }
          >
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Kart (Personel benzeri) ---------------- */
function ServiceCard({ row, canManage, onEdit, onDelete, onToggle }) {
  const Status = (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border " +
        (row.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600")
      }
    >
      {row.active ? "Aktif" : "Pasif"}
    </span>
  );

  return (
    <div className="relative rounded-xl border bg-white shadow-sm">
      {/* başlık */}
      <div className="px-4 pt-3 pb-2 flex items-start justify-between">
        <div className="text-[13px] font-semibold tracking-wide uppercase text-slate-800">
          {row.name}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-[12px] px-2 py-1 border rounded hover:bg-slate-50 disabled:opacity-50"
            disabled={!canManage}
            onClick={onEdit}
          >
            Düzenle
          </button>
          <button
            className="text-[12px] px-2 py-1 border rounded hover:bg-red-50 text-red-600 disabled:opacity-50"
            disabled={!canManage}
            onClick={onDelete}
          >
            Sil
          </button>
        </div>
      </div>
      <div className="mx-4 h-1 rounded-full bg-rose-500/80" />

      {/* içerik */}
      <div className="p-4">
        <div className="grid grid-cols-[140px_1fr] gap-y-2 text-[12px]">
          <div className="text-slate-500">KOD</div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border bg-yellow-50 text-yellow-800 px-2 py-0.5 font-mono">
              {row.code}
            </span>
          </div>

          <div className="text-slate-500">DURUM</div>
          <div className="flex items-center gap-2">
            {Status}
            {canManage && (
              <button
                className="text-[12px] px-2 py-0.5 border rounded hover:bg-slate-50"
                onClick={onToggle}
              >
                {row.active ? "Pasifleştir" : "Aktifleştir"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Ana Sekme ---------------- */
export default function ServicesTab() {
  const { user } = useAuth();
  const m = useServicesModel();
  const { refresh } = useServices();

  // 🔐 Yetki: Admin veya Authorized görüntüleyebilir.
  // Admin (veya SERVICES_WRITE izni olan) düzenleyebilir.
  const role = String(user?.role || "").toUpperCase();
  const perms = new Set(user?.permissions || []);

  const canManage =
    role === "ADMIN" || perms.has(PERMISSIONS.SERVICES_WRITE);

  const canView =
    canManage || role === "AUTHORIZED" || perms.has(PERMISSIONS.SERVICES_READ);

  useEffect(() => {
    if (canView) refresh();
  }, [canView, refresh]);

  if (!canView) {
    return (
      <div className="p-4 text-sm text-slate-600">
        Bu sayfa için yetkiniz yok.
      </div>
    );
  }

  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState("all"); // all | active | passive
  const [sortKey, setSortKey] = useState("name"); // name | code | active
  const [asc, setAsc] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  // render tetikleyici (mutasyonlardan sonra hemen yenile)
  const [rev, setRev] = useState(0);
  const bump = () => setRev((v) => v + 1);

  const debouncedUpdate = useDebounced((id, patch) => {
    m.update(id, patch);
    bump();
  }, 250);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let data = m.list() || [];

    if (q)
      data = data.filter(
        (s) =>
          (s.name || "").toLowerCase().includes(q) ||
          (s.code || "").toLowerCase().includes(q)
      );
    if (onlyActive === "active") data = data.filter((s) => s.active);
    if (onlyActive === "passive") data = data.filter((s) => !s.active);

    data = [...data].sort((a, b) => {
      const A = (a[sortKey] ?? "").toString().toLowerCase();
      const B = (b[sortKey] ?? "").toString().toLowerCase();
      if (A < B) return asc ? -1 : 1;
      if (A > B) return asc ? 1 : -1;
      return 0;
    });

    return data;
  }, [m, query, onlyActive, sortKey, asc, rev]);

  const existingCodes = useMemo(
    () => new Set((m.list() || []).map((s) => (s.code || "").toUpperCase())),
    [m, rev]
  );

  const fileRef = useRef(null);

  const handleQuickSeed = () => {
    const add = (name, code) => m.add({ name, code, active: true });
    add("Kardiyoloji", "KARDIYOLOJI");
    add("Genel Cerrahi", "GENEL_CERRAHI");
    add("Acil Servis", "ACIL");
    add("Radyoloji", "RADYOLOJI");
    add("Biyokimya Lab.", "BIYOKIMYA");
    add("Ortopedi", "ORTOPEDI");
    bump();
  };

  /* -------- Excel/CSV içe aktarma -------- */
  function downloadTemplate() {
    const csv = [
      "Ad,Kod,Aktif",
      "Kardiyoloji,KARDIYOLOJI,1",
      "Genel Cerrahi,GENEL_CERRAHI,1",
      "Radyoloji,RADYOLOJI,1",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "servis_sablon.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportToExcel() {
    const data = (m.list() || []).map((s) => ({
      Ad: s.name || "",
      Kod: s.code || "",
      Aktif: s.active ? 1 : 0,
    }));
    const ws = XLSX.utils.json_to_sheet(data, { header: ["Ad", "Kod", "Aktif"] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Servisler");
    XLSX.writeFile(wb, "servisler.xlsx");
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idx = {
      name: header.findIndex((h) => ["ad", "isim", "name"].includes(h)),
      code: header.findIndex((h) => ["kod", "code"].includes(h)),
      active: header.findIndex((h) => ["aktif", "active", "durum"].includes(h)),
    };
    return lines
      .slice(1)
      .map((line) => {
        const cols = line.split(",");
        return {
          name: (cols[idx.name] ?? "").trim(),
          code: (cols[idx.code] ?? "").trim(),
          active: toBool(cols[idx.active]),
        };
      })
      .filter((r) => r.name || r.code);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let rowsFromFile = [];
      const ext = file.name.toLowerCase().split(".").pop();

      if (ext === "csv" || file.type.includes("csv") || file.type.startsWith("text/")) {
        const text = await file.text();
        rowsFromFile = parseCSV(text);
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (aoa.length) {
          const header = (aoa[0] || []).map((v) => String(v || "").trim().toLowerCase());
          const idx = {
            name: header.findIndex((h) => ["ad", "isim", "name"].includes(h)),
            code: header.findIndex((h) => ["kod", "code"].includes(h)),
            active: header.findIndex((h) => ["aktif", "active", "durum"].includes(h)),
          };
          rowsFromFile = aoa
            .slice(1)
            .map((row) => ({
              name: String(row[idx.name] ?? "").trim(),
              code: String(row[idx.code] ?? "").trim(),
              active: toBool(row[idx.active]),
            }))
            .filter((r) => r.name || r.code);
        }
      }

      if (!rowsFromFile.length) {
        alert("Geçerli bir satır bulunamadı.");
        return;
      }

      const all = m.list();
      const mapByCode = new Map(
        all.map((it) => [String(it.code || "").toUpperCase(), it])
      );
      const ensureUnique = (targetCode) => {
        let c = (targetCode || "").toUpperCase();
        if (!c) c = slugCode("SERVIS");
        if (!mapByCode.has(c)) return c;
        let i = 2;
        while (mapByCode.has(`${c}_${i}`)) i++;
        return `${c}_${i}`;
      };

      let added = 0,
        updated = 0;
      rowsFromFile.forEach((r) => {
        const name = r.name?.trim();
        let code = (r.code?.trim().toUpperCase()) || slugCode(name);
        const active = toBool(r.active);
        if (!name) return;

        const existing = mapByCode.get(code);
        if (existing) {
          m.update(existing.id, { name, active, code });
          updated++;
        } else {
          code = ensureUnique(code);
          const created = m.add({ name, code, active });
          mapByCode.set(code, created);
          added++;
        }
      });

      bump();
      alert(`Excelden yükleme tamamlandı.\nEklendi: ${added}\nGüncellendi: ${updated}`);
    } catch (err) {
      console.error(err);
      alert("Dosya okunurken bir hata oluştu. Lütfen şablona uygun dosya yükleyin.");
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="Ara (ad/kod)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <select
          className="border rounded px-3 py-2"
          value={onlyActive}
          onChange={(e) => setOnlyActive(e.target.value)}
        >
          <option value="all">Tümü</option>
          <option value="active">Sadece Aktif</option>
          <option value="passive">Sadece Pasif</option>
        </select>

        <div className="flex items-center gap-2">
          <select
            className="border rounded px-3 py-2"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
          >
            <option value="name">Ada göre</option>
            <option value="code">Koda göre</option>
            <option value="active">Duruma göre</option>
          </select>
          <button
            className="border rounded px-2 py-2"
            onClick={() => setAsc((v) => !v)}
            title="Sıralama yönü"
          >
            {asc ? "A→Z" : "Z→A"}
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button className="px-3 py-2 rounded border" onClick={downloadTemplate}>
            Şablon
          </button>
          <button className="px-3 py-2 rounded border" onClick={exportToExcel}>
            Excele Aktar
          </button>
          {canManage && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,text/csv"
                className="hidden"
                onChange={handleFile}
              />
              <button
                className="px-3 py-2 rounded border"
                onClick={() => fileRef.current?.click()}
              >
                Excelden Yükle
              </button>
              <button
                className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Ekle
              </button>
            </>
          )}
        </div>
      </div>

      {/* Boş durum */}
      {rows.length === 0 && (
        <div className="border rounded-xl p-4 text-sm text-slate-600 flex items-center justify-between">
          <span>Henüz servis bulunamadı.</span>
          {canManage && (
            <button onClick={handleQuickSeed} className="px-3 py-2 rounded border">
              Hızlı Başlat
            </button>
          )}
        </div>
      )}

      {/* Kartlar */}
      {rows.length > 0 && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const rowId = row._id || row.id;
            return (
              <ServiceCard
                key={rowId}
                row={row}
                canManage={canManage}
                onEdit={() => {
                  setEditing(row);
                  setModalOpen(true);
                }}
                onDelete={() => {
                  if (confirm(`“${row.name || row.code}” silinsin mi?`)) {
                    m.remove(rowId);
                    bump();
                  }
                }}
                onToggle={() => {
                  m.toggle(rowId);
                  bump();
                }}
              />
            );
          })}
        </div>
      )}

      {!canManage && (
        <div className="text-xs text-slate-500">
          Not: Düzenleme yalnızca yetkisi olan kullanıcılar tarafından yapılabilir.
        </div>
      )}

      {/* Modal */}
      <ServiceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        existingCodes={existingCodes}
        initial={editing}
        onSubmit={(payload) => {
          if (editing) {
            const id = editing._id || editing.id;
            m.update(id, payload);
          } else {
            m.add({ ...payload, active: true });
          }
          setModalOpen(false);
          setEditing(null);
          bump();
        }}
      />
    </div>
  );
}
