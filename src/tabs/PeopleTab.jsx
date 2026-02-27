// src/tabs/PeopleTab.jsx
import React, { useRef, useState, useMemo } from "react";
import * as XLSX from "xlsx";
import IDCard from "../components/IDCard.jsx";
import { API, getToken, REQUIRE_BACKEND } from "../lib/api.js";
import { services as DEFAULT_SERVICES, SERVICE as DEFAULT_SERVICE } from "../constants/enums.js";

/* --- yardımcılar --- */
const cn = (...c) => c.filter(Boolean).join(" ");
const sortByKeyTR = (arr, key) =>
  [...arr].sort((a, b) =>
    (a?.[key] || "")
      .toString()
      .localeCompare((b?.[key] || "").toString(), "tr", { sensitivity: "base" })
  );
const ROLE = { Doctor: "Doctor", Nurse: "Nurse" };

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

const clean = (s) => (s ?? "").toString().trim();
const isMongoId = (id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const normId = (v) => String(v ?? "");
const normalizeServices = (input) => {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const s of arr) {
    const id = String(s?.id ?? s?._id ?? s?.code ?? s?.name ?? "").trim();
    const name = String(s?.name ?? s?.label ?? s?.title ?? s?.code ?? s?.id ?? "").trim();
    const code = String(s?.code ?? s?.id ?? s?._id ?? s?.name ?? "").trim();
    if (!id || !name) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name, code });
  }
  return out;
};

const resolveServiceId = (value, options, fallback) => {
  const raw = (value ?? "").toString().trim();
  if (!raw) return fallback || "";
  const q = raw.toLocaleLowerCase("tr-TR");
  const byId = options.find((s) => String(s.id).toLocaleLowerCase("tr-TR") === q);
  if (byId) return byId.id;
  const byName = options.find((s) => String(s.name).toLocaleLowerCase("tr-TR") === q);
  if (byName) return byName.id;
  const byCode = options.find((s) => String(s.code || "").toLocaleLowerCase("tr-TR") === q);
  return byCode ? byCode.id : raw;
};

// workAreas -> {id,name}[] (string veya obje kabul)
function normalizeWorkAreas(input) {
  const arr = Array.isArray(input) ? input : [];
  const mapped = arr
    .map((a) => {
      const name =
        typeof a === "string"
          ? clean(a)
          : clean(a?.name || a?.label || a?.title || a?.id);
      const id =
        typeof a === "object" && a?.id ? String(a.id) : slugTR(name);
      return name ? { id, name } : null;
    })
    .filter(Boolean);
  // uniq by id (case-insensitive)
  const seen = new Set();
  const out = [];
  for (const it of mapped) {
    const k = it.id.toLocaleLowerCase("tr-TR");
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return sortByKeyTR(out, "name");
}

export default function PeopleTab({
  label,
  role,
  people = [],
  setPeople,
  workAreas = [], // string[] veya {id,name}[]
  workingHours = [], // [{id, code, ...}]
  services = [], // [{id,name,code,...}] veya string[]
}) {
  const WA = useMemo(() => normalizeWorkAreas(workAreas), [workAreas]);
  const serviceOptions = useMemo(() => {
    const normalized = normalizeServices(services);
    if (normalized.length) return normalized;
    return (DEFAULT_SERVICES || []).map((s) => ({ id: s.id, name: s.name }));
  }, [services]);
  const defaultServiceId = serviceOptions[0]?.id || DEFAULT_SERVICE?.acil || "acil";

  const empty = {
    id: undefined,
    role,
    service: defaultServiceId,
    name: "",
    title: role === ROLE.Doctor ? "Uzman" : "Hemşire",
    tc: "",
    phone: "",
    mail: "",
    workAreaIds: [], // id listesi (WA’ya göre)
    shiftCodes: [],
  };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editQuery, setEditQuery] = useState("");
  const [resetting, setResetting] = useState(false);
  const importRef = useRef(null);

  const toggleArea = (areaId) =>
    setForm((f) => {
      const has = f.workAreaIds.includes(areaId);
      return {
        ...f,
        workAreaIds: has
          ? f.workAreaIds.filter((x) => x !== areaId)
          : [...f.workAreaIds, areaId],
      };
    });

  const toggleShiftCode = (code) =>
    setForm((f) => {
      const has = f.shiftCodes?.includes(code);
      return {
        ...f,
        shiftCodes: has
          ? f.shiftCodes.filter((c) => c !== code)
          : [...(f.shiftCodes || []), code],
      };
    });

  const reset = () => {
    setForm(empty);
    setEditingId(null);
  };
  const resetUi = () => {
    reset();
    setEditOpen(false);
    setEditQuery("");
  };

  // KAYDET / GÜNCELLE
  const syncOneToBackend = async (row, editingId) => {
    const token = getToken();
    if (!token) return { person: null, error: "Giriş gerekli" };
    try {
      const payload = {
        name: row.name || "",
        serviceId: row.service || "",
        meta: {
          role: row.role || "",
          title: row.title || "",
          areas: Array.isArray(row.areas) ? row.areas : [],
          shiftCodes: Array.isArray(row.shiftCodes) ? row.shiftCodes : [],
        },
        tc: row.tc || "",
        phone: row.phone || "",
        email: row.mail || "",
      };
      if (editingId && isMongoId(editingId)) {
        const res = await API.http.put(`/api/personnel/${editingId}`, payload);
        return { person: res?.person || null, error: null };
      }
      const res = await API.http.post(`/api/personnel`, payload);
      return { person: res?.person || null, error: null };
    } catch (e) {
      console.warn("Backend sync error:", e?.message || e);
      return { person: null, error: e?.message || "Backend senkron hatası" };
    }
  };

  const upsert = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (REQUIRE_BACKEND && !getToken()) {
      alert("Kaydetmek için giriş yapın.");
      return;
    }

    const id = editingId ?? Date.now();

    // id -> isim eşle (kart ve form geri-dolumu için isimleri de tut)
    const areaNames = (form.workAreaIds || [])
      .map((aid) => WA.find((w) => w.id === aid)?.name)
      .filter(Boolean);

    const row = {
      ...form,
      id,
      name: form.name.trim(),
      workAreaIds: Array.isArray(form.workAreaIds) ? form.workAreaIds : [],
      areas: areaNames, // <<< KRİTİK
    };

    const { person: saved, error } = await syncOneToBackend(row, editingId);
    if (REQUIRE_BACKEND && !saved) {
      alert(error || "Sunucuya kaydedilemedi.");
      return;
    }
    const nextId = saved?.id || id;
    const nextRow = {
      ...row,
      id: nextId,
      name: saved?.name || row.name,
      service: saved?.serviceId || row.service,
      meta: saved?.meta || row.meta,
    };

    setPeople((prev) =>
      sortByKeyTR(
        [...(prev.filter((p) => normId(p.id) !== normId(id))), nextRow],
        "name"
      )
    );
    reset();
    try { window.dispatchEvent(new Event("personnel:changed")); } catch {}
  };

  // KİŞİ DÜZENLE
  const edit = (p) => {
    // Eski format: p.areas (isim listesi) olabilir → WA üzerinden id'lere çevir
    const names = Array.isArray(p.areas) ? p.areas.map(clean) : [];
    const idsFromNames = names
      .map((nm) => WA.find((w) => w.name === nm)?.id)
      .filter(Boolean);

    const existingIds =
      (Array.isArray(p.workAreaIds) && p.workAreaIds.length && p.workAreaIds) ||
      (Array.isArray(p.areaIds) && p.areaIds.length && p.areaIds) ||
      idsFromNames ||
      [];

    setEditingId(p.id);
    setForm({
      ...empty,
      ...p,
      workAreaIds: existingIds,
    });
  };

  const del = async (id) => {
    if (!id) return;
    if (REQUIRE_BACKEND && !getToken()) {
      alert("Silmek için giriş yapın.");
      return;
    }
    if (isMongoId(String(id))) {
      try {
        await API.http.delete(`/api/personnel/${id}`);
      } catch (e) {
        alert("Sunucudan silinemedi. Tekrar deneyin.");
        return;
      }
    }
    setPeople((prev) => sortByKeyTR(prev.filter((p) => normId(p.id) !== normId(id)), "name"));
    try { window.dispatchEvent(new Event("personnel:changed")); } catch {}
  };

  const editList = useMemo(() => {
    const q = editQuery.trim().toLocaleLowerCase("tr-TR");
    if (!q) return sortByKeyTR(people, "name");
    return sortByKeyTR(people.filter((p) => {
      const hay = [
        p.name,
        p.tc,
        p.phone,
        p.mail,
        p.title,
      ]
        .filter(Boolean)
        .map((v) => v.toString().toLocaleLowerCase("tr-TR"))
        .join(" ");
      return hay.includes(q);
    }), "name");
  }, [people, editQuery]);

  /* --- Excel dışa aktarma ve şablon --- */
  const exportXLSX = () => {
    const wsData = [
      [
        "ROL",
        "SERVIS",
        "UNVANI",
        "T.C. KİMLİK NO",
        "AD SOYAD",
        "TELEFON NUMARASI",
        "MAİL ADRESİ",
        "ÇALIŞMA ALANLARI",
        "VARDİYE KODLARI",
      ],
      ...people.map((p) => {
        // Önce doğrudan p.areas (isim listesi) varsa onu kullan
        const areaNames =
          Array.isArray(p.areas) && p.areas.length
            ? p.areas
            : (p.workAreaIds || p.areaIds || [])
                .map((id) => WA.find((w) => w.id === id)?.name)
                .filter(Boolean);
        return [
          p.role,
          p.service,
          p.title,
          p.tc,
          p.name,
          p.phone,
          p.mail,
          areaNames.join(", "),
          (p.shiftCodes || []).join(", "),
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, label.toUpperCase());
    XLSX.writeFile(wb, `${label.replace(/\s/g, "_").toUpperCase()}.xlsx`);
  };

  const downloadTemplate = () => {
    const wsData = [
      [
        "ROL",
        "SERVIS",
        "UNVANI",
        "T.C. KİMLİK NO",
        "AD SOYAD",
        "TELEFON NUMARASI",
        "MAİL ADRESİ",
        "ÇALIŞMA ALANLARI",
        "VARDİYE KODLARI",
      ],
      [
        role,
        defaultServiceId,
        role === ROLE.Doctor ? "Uzman" : "Hemşire",
        "",
        "Ad Soyad",
        "",
        "",
        "Alan1, Alan2",
        "KOD1, KOD2",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SABLON");
    XLSX.writeFile(
      wb,
      `${label.replace(/\s/g, "_").toUpperCase()}_SABLON.xlsx`
    );
  };

  /* --- Excel içe aktarma --- */
  const triggerImport = () => importRef.current?.click();
  const importExcel = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const wb = XLSX.read(data, { type: "array" });
      const sh = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sh, { defval: "" });
      const parsed = rows
        .map((r, idx) => {
          const rrole = (r["ROL"] || role).toString().trim();
          if (rrole !== role) return null;
          const serviceRaw = (r["SERVIS"] || r["SERVİS"] || defaultServiceId);
          const service = resolveServiceId(serviceRaw, serviceOptions, defaultServiceId);
          const title = (r["UNVANI"] || r["UNVAN"] || (role === ROLE.Doctor ? "Uzman" : "Hemşire"))
            .toString()
            .trim();
          const tc = (r["T.C. KİMLİK NO"] || r["TC"] || "").toString().trim();
          const name = (r["AD SOYAD"] || r["NAME"] || "").toString().trim();
          const phone = (r["TELEFON NUMARASI"] || r["TELEFON"] || "").toString().trim();
          const mail = (r["MAİL ADRESİ"] || r["MAIL"] || "").toString().trim();
          const areasRaw = (r["ÇALIŞMA ALANLARI"] || r["ALANLAR"] || "").toString();
          const areaNames = areasRaw.split(/,|;/).map((s) => s.trim()).filter(Boolean);
          const workAreaIds = areaNames
            .map((nm) => WA.find((w) => w.name === nm)?.id)
            .filter(Boolean);
          const shiftsRaw = (r["VARDİYE KODLARI"] || r["VARDIYE KODLARI"] || "").toString();
          const shiftCodes = shiftsRaw.split(/,|;/).map((s) => s.trim()).filter(Boolean);
          if (!name) return null;
          return {
            id: Date.now() + idx,
            role,
            service,
            title,
            tc,
            name,
            phone,
            mail,
            workAreaIds,
            areas: areaNames, // excelden gelen isimleri de kaydet
            shiftCodes,
          };
        })
        .filter(Boolean);
      if (!parsed.length) {
        alert(
          "Excel başlıkları: ROL,SERVIS,UNVANI,T.C. KİMLİK NO,AD SOYAD,TELEFON NUMARASI,MAİL ADRESİ,ÇALIŞMA ALANLARI,VARDİYE KODLARI"
        );
        return;
      }
      const ok = window.confirm(
        `Excel'den yükleme mevcut kayıtları silecek ve ${parsed.length} yeni kayıt ekleyecek. Emin misiniz?`
      );
      if (!ok) {
        if (importRef.current) importRef.current.value = "";
        return;
      }
      // Backend'e bulk gönder
      const token = getToken();
      if (REQUIRE_BACKEND && !token) {
        alert("Backend senkron için giriş gerekli.");
        if (importRef.current) importRef.current.value = "";
        return;
      }
      const bulkItems = parsed.map((p) => ({
        name: p.name || "",
        serviceId: p.service || "",
        meta: {
          role: p.role || "",
          title: p.title || "",
          areas: Array.isArray(p.areas) ? p.areas : [],
          shiftCodes: Array.isArray(p.shiftCodes) ? p.shiftCodes : [],
        },
        tc: p.tc || "",
        phone: p.phone || "",
        email: p.mail || "",
      }));
      const qs = new URLSearchParams({ replaceAll: "1", role: String(role || "") }).toString();
      API.http
        .post(`/api/personnel/bulk?${qs}`, bulkItems)
        .then((data) => {
          const count = data?.count ?? bulkItems.length;
          setPeople(sortByKeyTR(parsed, "name"));
          if (importRef.current) importRef.current.value = "";
          alert(`${parsed.length} kayıt yüklendi. Backend: ${count} kayıt işlendi.`);
          try { window.dispatchEvent(new Event("personnel:changed")); } catch {}
        })
        .catch((err) => {
          alert(err?.message || "Backend senkron başarısız");
          if (importRef.current) importRef.current.value = "";
        });
    };
    r.readAsArrayBuffer(f);
  };

  const handleResetAll = async () => {
    const ok = window.confirm(
      `${label} listesindeki tüm kayıtlar silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?`
    );
    if (!ok) return;

    const token = getToken();
    if (REQUIRE_BACKEND && !token) {
      alert("Backend senkron için giriş gerekli.");
      return;
    }

    setResetting(true);
    try {
      const qs = new URLSearchParams({
        replaceAll: "1",
        role: String(role || ""),
        clear: "1",
      }).toString();
      await API.http.post(`/api/personnel/bulk?${qs}`, { items: [], replaceAll: true, role, clear: true });
      setPeople([]);
      resetUi();
      alert("Liste sıfırlandı.");
      try { window.dispatchEvent(new Event("personnel:changed")); } catch {}
    } catch (err) {
      alert(err?.message || "Liste sıfırlanamadı.");
    } finally {
      setResetting(false);
    }
  };

  const visiblePeople = editingId
    ? people.filter((p) => p.id === editingId)
    : sortByKeyTR(people, 'name');

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
        <div className="font-semibold">{label}</div>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={downloadTemplate}
            className="px-3 py-2 rounded-xl bg-slate-100"
          >
            Şablon
          </button>
          <button
            onClick={exportXLSX}
            className="px-3 py-2 rounded-xl bg-slate-100"
          >
            Dışa Aktar
          </button>
          <button
            onClick={() => setEditOpen(true)}
            className="px-3 py-2 rounded-xl bg-slate-100"
          >
            Düzenle
          </button>
          <button
            onClick={handleResetAll}
            disabled={resetting}
            className={`px-3 py-2 rounded-xl border ${
              resetting
                ? "bg-rose-100 text-rose-400 border-rose-200 cursor-wait"
                : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
            }`}
          >
            {resetting ? "Sıfırlanıyor..." : "Sıfırla"}
          </button>
          <button
            onClick={triggerImport}
            className="px-3 py-2 rounded-xl bg-sky-600 text-white"
          >
            Excel'den Yükle
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".xls,.xlsx"
            className="hidden"
            onChange={importExcel}
          />
        </div>
      </div>

      {/* Form */}
      <form
        onSubmit={upsert}
        className="bg-white rounded-2xl shadow-sm p-4 grid md:grid-cols-3 gap-3 items-end"
      >
        <div>
          <label className="text-xs text-slate-500">Servis</label>
          <select
            value={form.service}
            onChange={(e) =>
              setForm((f) => ({ ...f, service: e.target.value }))
            }
            className="w-full border rounded p-2"
          >
            {serviceOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-500">Unvan</label>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full border rounded p-2"
            placeholder="Unvan"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500">T.C. Kimlik No</label>
          <input
            value={form.tc}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                tc: e.target.value.replace(/\D/g, "").slice(0, 11),
              }))
            }
            className="w-full border rounded p-2"
            placeholder="11 hane"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500">Ad Soyad</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border rounded p-2"
            placeholder="Ad Soyad"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500">Telefon</label>
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="w-full border rounded p-2"
            placeholder="Telefon"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500">Mail</label>
          <input
            value={form.mail}
            onChange={(e) => setForm((f) => ({ ...f, mail: e.target.value }))}
            className="w-full border rounded p-2"
            placeholder="Mail"
          />
        </div>

        <div className="md:col-span-3 border rounded p-2">
          <div className="text-xs text-slate-500 mb-1">Çalışma Alanları</div>
          <div className="flex flex-wrap gap-2">
            {WA.length === 0 && (
              <span className="text-xs text-slate-400">
                Önce çalışma alanı ekleyin.
              </span>
            )}
            {WA.map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => toggleArea(a.id)}
                className={cn(
                  "px-2 py-1 rounded-full text-xs border",
                  form.workAreaIds.includes(a.id)
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white border-slate-200"
                )}
                title={a.name}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>

        <div className="md:col-span-3 border rounded p-2">
          <div className="text-xs text-slate-500 mb-1">Vardiya Kodları</div>
          <div className="flex flex-wrap gap-2">
            {(!Array.isArray(workingHours) || workingHours.length === 0) && (
              <span className="text-xs text-slate-400">
                Önce “Çalışma Saatleri” sekmesinden kod tanımlayın.
              </span>
            )}
            {workingHours?.map((vh) => (
              <button
                type="button"
                key={vh.id}
                onClick={() => toggleShiftCode(vh.code)}
                className={cn(
                  "px-2 py-1 rounded-full text-xs border",
                  form.shiftCodes?.includes(vh.code)
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-white border-slate-200"
                )}
                title={`${vh.code}${
                  vh.start && vh.end ? ` (${vh.start}–${vh.end})` : ""
                }`}
              >
                {vh.code}
              </button>
            ))}
          </div>
        </div>

        <div className="md:col-span-3 flex gap-2">
          <button
            type="submit"
            className="px-3 py-2 rounded-lg text-white bg-emerald-600"
          >
            {editingId ? "Güncelle" : "Ekle"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={reset}
              className="px-3 py-2 rounded-lg bg-slate-100"
            >
              İptal
            </button>
          )}
        </div>
      </form>

      {/* Liste */}
      {editingId && (
        <div className="text-xs text-slate-500">
          Düzenleme modunda yalnızca seçili kart gösteriliyor. İptal edince tüm liste geri gelir.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visiblePeople.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold uppercase tracking-wide text-slate-800">
                {p.name}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => edit(p)}
                  className="text-xs bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded"
                >
                  Düzenle
                </button>
                <button
                  onClick={() => del(p.id)}
                  className="text-xs bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded"
                >
                  Sil
                </button>
              </div>
            </div>
            <IDCard person={p} />
          </div>
        ))}
        {people.length === 0 && (
          <div className="text-sm text-slate-500">Henüz kayıt yok.</div>
        )}
      </div>

      {/* Düzenle modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="font-semibold">Kişi Düzenle</div>
              <button
                className="px-3 py-1 rounded-lg border"
                onClick={() => setEditOpen(false)}
              >
                Kapat
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="İsim / TC / Telefon / Mail ara"
                value={editQuery}
                onChange={(e) => setEditQuery(e.target.value)}
              />
              <div className="max-h-[50vh] overflow-auto border rounded-lg">
                {editList.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">Kayıt bulunamadı.</div>
                ) : (
                  <ul className="divide-y">
                    {editList.map((p) => (
                      <li
                        key={p.id}
                        className="px-4 py-3 hover:bg-slate-50 cursor-pointer"
                        onClick={() => {
                          edit(p);
                          setEditOpen(false);
                          setEditQuery("");
                        }}
                      >
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-slate-500">
                          {p.tc || "-"} · {p.phone || "-"} · {p.mail || "-"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex items-center justify-between">
                <button
                  className="text-xs text-slate-600 underline"
                  onClick={() => {
                    reset();
                    setEditOpen(false);
                    setEditQuery("");
                  }}
                >
                  Düzenleme modunu kapat (tüm kartları göster)
                </button>
                <div className="text-xs text-slate-500">
                  Toplam: {editList.length}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
