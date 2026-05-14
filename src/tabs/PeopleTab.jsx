// src/tabs/PeopleTab.jsx
import React, { useRef, useState, useMemo, useEffect } from "react";
import {
  ClipboardList,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Mail,
  PencilLine,
  Phone,
  RefreshCcw,
  ShieldCheck,
  Upload,
  UserPlus2,
  Users,
} from "lucide-react";
import * as XLSX from "xlsx";
import IDCard from "../components/IDCard.jsx";
import { maskPhone, maskTC } from "../utils/format.js";
import { API, getToken, REQUIRE_BACKEND } from "../lib/api.js";
import { useServices } from "../hooks/useServicesModel.js";
import useServiceScope from "../hooks/useServiceScope.js";

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

function formatPhoneDisplay(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
  const parts = [
    digits.slice(0, 3),
    digits.slice(3, 6),
    digits.slice(6, 8),
    digits.slice(8, 10),
  ].filter(Boolean);
  return parts.join(" ");
}

function isValidTC(tc) {
  if (!/^\d{11}$/.test(tc)) return false;

  const digits = tc.split("").map(Number);
  if (digits[0] === 0) return false;

  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  const digit10 = ((odd * 7 - even) % 10);
  if (digit10 !== digits[9]) return false;

  const digit11 = (digits.slice(0, 10).reduce((a, b) => a + b, 0) % 10);
  return digit11 === digits[10];
}

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
  const { items: servicesFromApi } = useServices();
  const scope = useServiceScope();
  const WA = useMemo(() => normalizeWorkAreas(workAreas), [workAreas]);
  const baseServices = useMemo(() => {
    const fromApi = Array.isArray(servicesFromApi) ? servicesFromApi : [];
    if (fromApi.length) return fromApi;
    return Array.isArray(services) ? services : [];
  }, [services, servicesFromApi]);
  const scopedServices = useMemo(() => {
    if (scope.isAdmin) return baseServices;
    const allow = new Set((scope.allowedIds || []).map(String));
    return baseServices.filter((s) =>
      allow.has(String(s?.id ?? s?._id ?? s?.code ?? s?.name ?? ""))
    );
  }, [baseServices, scope.isAdmin, scope.allowedIds]);
  const serviceOptions = useMemo(() => {
    const normalized = normalizeServices(scopedServices);
    return normalized;
  }, [scopedServices]);
  const defaultServiceId = serviceOptions[0]?.id || "";

  const empty = {
    id: undefined,
    role,
    service: defaultServiceId,
    name: "",
    title: role === ROLE.Doctor ? "Uzman" : "Hemşire",
    tc: "",
    phone: "",
    mail: "",
    annualLeaveDays: 15,
    workAreaIds: [], // id listesi (WA’ya göre)
    shiftCodes: [],
  };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editQuery, setEditQuery] = useState("");
  const [showRawTC, setShowRawTC] = useState(false);
  const [showRawPhone, setShowRawPhone] = useState(false);
  const [tcError, setTcError] = useState("");
  const [resetting, setResetting] = useState(false);
  const importRef = useRef(null);

  useEffect(() => {
    if (!form.service && defaultServiceId) {
      setForm((f) => ({ ...f, service: defaultServiceId }));
    }
  }, [defaultServiceId, form.service]);

  useEffect(() => {
    if (!editOpen) return;
    const handleKey = (e) => { if (e.key === "Escape") setEditOpen(false); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [editOpen]);

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
    setShowRawTC(false);
    setShowRawPhone(false);
    setTcError("");
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
        annualLeaveDays: Number(row.annualLeaveDays) >= 0 ? Number(row.annualLeaveDays) : 15,
        meta: {
          role: row.role || "",
          title: row.title || "",
          areas: Array.isArray(row.areas) ? row.areas : [],
          workAreaIds: Array.isArray(row.workAreaIds) ? row.workAreaIds : [],
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
    } catch (err) {
      console.error("Backend sync error:", err?.message || err);
      return { person: null, error: err?.message || "Backend senkron hatası" };
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
    const persistedId = saved?.id || row.personId || id;
    const savedMeta = saved?.meta || {};
    const nextRow = {
      ...row,
      id: persistedId,
      personId: String(persistedId),
      name: saved?.name || row.name,
      service: saved?.serviceId || row.service,
      tc: saved?.tc || row.tc,
      phone: saved?.phone || row.phone,
      mail: saved?.email || row.mail,
      title: savedMeta.title || row.title,
      areas: Array.isArray(savedMeta.areas) ? savedMeta.areas : row.areas,
      workAreaIds: Array.isArray(savedMeta.workAreaIds) ? savedMeta.workAreaIds : row.workAreaIds,
      shiftCodes: Array.isArray(savedMeta.shiftCodes) ? savedMeta.shiftCodes : row.shiftCodes,
      meta: savedMeta,
    };

    setPeople((prev) => {
      const replaceId = editingId ?? id;
      const updatedPeople = sortByKeyTR(
        [...(prev.filter((p) => normId(p.id) !== normId(replaceId))), nextRow],
        "name"
      );
      return updatedPeople;
    });
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
    setShowRawTC(false);
    setShowRawPhone(false);
    setForm({
      ...empty,
      ...p,
      annualLeaveDays: p.annualLeaveDays ?? 15,
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
      let wb, sh, rows;
      try {
        const data = new Uint8Array(evt.target.result);
        wb = XLSX.read(data, { type: "array" });
        sh = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sh, { defval: "" });
      } catch (parseErr) {
        alert("Excel dosyası okunamadı: " + (parseErr?.message || "Geçersiz format"));
        if (importRef.current) importRef.current.value = "";
        return;
      }
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
          const workAreaIdsRaw = (
            r["ÇALIŞMA ALANI IDLERİ"] ||
            r["ÇALIŞMA ALANI IDLERI"] ||
            r["ALAN IDLERİ"] ||
            r["ALAN IDLERI"] ||
            r["WORK AREA IDS"] ||
            r["WORKAREAIDS"] ||
            ""
          ).toString();
          const explicitWorkAreaIds = workAreaIdsRaw
            .split(/,|;/)
            .map((s) => s.trim())
            .filter(Boolean);
          const workAreaIds = explicitWorkAreaIds.length
            ? explicitWorkAreaIds
            : areaNames
                .map((nm) => WA.find((w) => w.name === nm)?.id)
                .filter(Boolean);
          const shiftsRaw = (r["VARDİYE KODLARI"] || r["VARDIYE KODLARI"] || "").toString();
          const shiftCodes = shiftsRaw.split(/,|;/).map((s) => s.trim()).filter(Boolean);
          if (!name) return null;
          const generatedId = Date.now() + idx;
          return {
            id: generatedId,
            personId: String(generatedId),
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
          workAreaIds: Array.isArray(p.workAreaIds) ? p.workAreaIds : [],
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
  const selectedAreaCount = form.workAreaIds.length;
  const selectedShiftCount = Array.isArray(form.shiftCodes) ? form.shiftCodes.length : 0;
  const activeServiceName =
    serviceOptions.find((s) => String(s.id) === String(form.service))?.name || "Servis seçilmedi";
  const roleLabel = role === ROLE.Doctor ? "Doktor" : "Hemşire";
  const fieldClass =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";
  const sectionCardClass = "flex h-full flex-col rounded-2xl border border-slate-200 bg-slate-50/70 p-4";

  return (
    <div className="space-y-4">
      <section className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                <ClipboardList className="h-3.5 w-3.5 text-sky-700" />
                Personel Kayıt Akışı
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <Users className="h-3.5 w-3.5" />
                {people.length} kayıt
              </span>
            </div>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{label}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Personel kimliğini, iletişim bilgisini, çalışma alanı yetkinliklerini ve uygun vardiya kodlarını tek form üzerinden yönetin.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            <button onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 transition hover:bg-slate-100">
              <FileSpreadsheet className="h-4 w-4" />
              Şablon
            </button>
            <button onClick={exportXLSX} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 transition hover:bg-slate-100">
              <Download className="h-4 w-4" />
              Dışa Aktar
            </button>
            <button onClick={() => setEditOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 transition hover:bg-slate-100">
              <PencilLine className="h-4 w-4" />
              Kayıt Seç
            </button>
            <button
              onClick={handleResetAll}
              disabled={resetting}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 transition ${
                resetting
                  ? "cursor-wait border-rose-200 bg-rose-100 text-rose-400"
                  : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
              }`}
            >
              <RefreshCcw className="h-4 w-4" />
              {resetting ? "Sıfırlanıyor..." : "Sıfırla"}
            </button>
            <button onClick={triggerImport} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 font-medium text-white transition hover:bg-sky-700">
              <Upload className="h-4 w-4" />
              Excel'den Yükle
            </button>
            <input ref={importRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={importExcel} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Aktif Kayıt Türü</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{roleLabel}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Formdaki Servis</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{activeServiceName}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Çalışma Alanı Seçimi</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{selectedAreaCount}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Uygun Vardiya Kodu</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{selectedShiftCount}</div>
          </div>
        </div>
      </section>

      <form
        onSubmit={upsert}
        className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
              Kayıt Formu
            </div>
            <h4 className="mt-3 text-xl font-semibold text-slate-950">{editingId ? "Personel kaydını güncelle" : "Yeni personel kaydı oluştur"}</h4>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Önce temel kimlik alanlarını doldurun, ardından çalışma alanı ve vardiya uygunluklarını işaretleyin.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <div className="font-medium text-slate-900">{editingId ? "Düzenleme modu açık" : "Yeni kayıt modu"}</div>
            <div className="mt-1">Kaydettiğiniz bilgi planlama, çizelgeler ve kullanıcı eşleşmeleri tarafından kullanılır.</div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <section className={`${sectionCardClass} min-h-[220px]`}>
              <div className="text-sm font-semibold text-slate-900">Kimlik ve görev bilgisi</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">Servis</label>
                  <select value={form.service} onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))} className={fieldClass}>
                    {serviceOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Unvan</label>
                  <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={fieldClass} placeholder="Unvan" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Yıllık İzin Hakkı (gün)</label>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={form.annualLeaveDays ?? 15}
                    onChange={(e) => setForm((f) => ({ ...f, annualLeaveDays: Math.max(0, Number(e.target.value) || 0) }))}
                    className={fieldClass}
                    placeholder="15"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">T.C. Kimlik No</label>
                  <div className="relative">
                    <input
                      value={showRawTC ? form.tc : (form.tc ? maskTC(form.tc) : "")}
                      readOnly={!showRawTC}
                      onBlur={() => setTcError(form.tc ? (isValidTC(form.tc) ? "" : "Geçersiz TC Kimlik No") : "")}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                        setForm((f) => ({ ...f, tc: raw }));
                        if (tcError) setTcError("");
                      }}
                      maxLength={11}
                      className={`${fieldClass} pr-10`}
                      placeholder="11 hane"
                    />
                    {!!form.tc && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowRawTC((v) => !v);
                          setTcError("");
                        }}
                        aria-label={showRawTC ? "TC gizle" : "TC goster"}
                        title={showRawTC ? "TC gizle" : "TC goster"}
                        className="absolute inset-y-0 right-2 flex items-center text-slate-500 hover:text-slate-700"
                      >
                        {showRawTC ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
                      </button>
                    )}
                  </div>
                  {tcError ? <div className="mt-1 text-xs text-rose-600">{tcError}</div> : null}
                </div>
                <div className="md:col-span-2 xl:col-span-3">
                  <label className="text-xs font-medium text-slate-500">Ad Soyad</label>
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={fieldClass} placeholder="Ad Soyad" />
                </div>
              </div>
          </section>

          <section className={`${sectionCardClass} min-h-[220px]`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Çalışma alanları</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">Personelin görev alabileceği alanları seçin.</p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">{selectedAreaCount} seçili</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 content-start">
              {WA.length === 0 && <span className="text-xs text-slate-400">Önce çalışma alanı ekleyin.</span>}
              {WA.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => toggleArea(a.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                    form.workAreaIds.includes(a.id)
                      ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                  )}
                  title={a.name}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </section>

          <section className={`${sectionCardClass} min-h-[180px]`}>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Phone className="h-4 w-4 text-sky-700" />
                İletişim bilgileri
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-500">Telefon</label>
                  <div className="relative">
                    <input
                      type="tel"
                      value={showRawPhone ? formatPhoneDisplay(form.phone || "") : (form.phone ? maskPhone(form.phone) : "")}
                      readOnly={!showRawPhone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                      className={`${fieldClass} pr-10`}
                      placeholder="Telefon"
                    />
                    {!!form.phone && (
                      <button
                        type="button"
                        onClick={() => setShowRawPhone((v) => !v)}
                        aria-label={showRawPhone ? "Telefonu gizle" : "Telefonu goster"}
                        title={showRawPhone ? "Telefonu gizle" : "Telefonu goster"}
                        className="absolute inset-y-0 right-2 flex items-center text-slate-500 hover:text-slate-700"
                      >
                        {showRawPhone ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Mail</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input value={form.mail} onChange={(e) => setForm((f) => ({ ...f, mail: e.target.value }))} className={`${fieldClass} pl-10`} placeholder="Mail" />
                  </div>
                </div>
              </div>
          </section>

          <section className={`${sectionCardClass} min-h-[180px]`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Vardiya uygunluğu</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Bu personelin atanabileceği vardiya kodlarını işaretleyin.</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">{selectedShiftCount} seçili</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 content-start">
                {(!Array.isArray(workingHours) || workingHours.length === 0) && (
                  <span className="text-xs text-slate-400">Önce “Çalışma Saatleri” sekmesinden kod tanımlayın.</span>
                )}
                {workingHours?.map((vh) => (
                  <button
                    type="button"
                    key={vh.id}
                    onClick={() => toggleShiftCode(vh.code)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      form.shiftCodes?.includes(vh.code)
                        ? "border-amber-600 bg-amber-500 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                    )}
                    title={`${vh.code}${vh.start && vh.end ? ` (${vh.start}–${vh.end})` : ""}`}
                  >
                    {vh.code}
                  </button>
                ))}
              </div>
          </section>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700">
            <UserPlus2 className="h-4 w-4" />
            {editingId ? "Kaydı Güncelle" : "Kaydı Ekle"}
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100">
              İptal
            </button>
          )}
        </div>
      </form>

      {editingId && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          Düzenleme modunda yalnızca seçili kart gösteriliyor. İptal edince tüm liste geri gelir.
        </div>
      )}
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h4 className="text-lg font-semibold text-slate-950">Kayıtlı personel kartları</h4>
            <p className="mt-1 text-sm text-slate-600">Seçili gruptaki personeli kart görünümünde inceleyin ve doğrudan düzenleyin.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
            <Users className="h-4 w-4 text-sky-700" />
            Görünen kayıt: {visiblePeople.length}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visiblePeople.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              serviceOptions={serviceOptions}
              onEdit={() => edit(p)}
              onDelete={() => del(p.id)}
            />
          ))}
          {people.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                <UserPlus2 className="h-6 w-6 text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Henüz personel eklenmemiş</p>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">Soldaki formu doldurup Kaydet'e basın veya Excel'den toplu yükleyin.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Düzenle modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setEditOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
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
                          {maskTC(p.tc)} · {maskPhone(p.phone)} · {p.mail || p.email || "-"}
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

function PersonCard({ person: p, serviceOptions, onEdit, onDelete }) {
  const [creating, setCreating] = useState(false);
  const hasToken = !!getToken();

  const handleCreateUser = async () => {
    if (!hasToken) {
      alert("Kullanıcı oluşturmak için giriş gerekli.");
      return;
    }
    if (!window.confirm(`"${p.name}" için kullanıcı hesabı oluşturulsun mu?\nGeçici şifre: TC numarası (TC yoksa Hastane2026!)`)) return;
    setCreating(true);
    try {
      await API.http.post("/api/users/quick-create", {
        name: p.name,
        tc: p.tc || p.nationalId || "",
        phone: p.phone || "",
        email: p.mail || p.email || "",
        role: "user",
        personId: String(p.id || ""),
      });
      alert(`✅ "${p.name}" için kullanıcı oluşturuldu.`);
    } catch (e) {
      alert(e?.message || "Kullanıcı oluşturulamadı.");
    } finally {
      setCreating(false);
    }
  };

  const svcName = serviceOptions.find((s) => s.id === p.service)?.name || p.service || "";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3 shadow-sm transition hover:border-slate-300 hover:bg-white">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold uppercase tracking-wide text-slate-800">{p.name}</div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="rounded-lg bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">
            Düzenle
          </button>
          <button onClick={onDelete} className="rounded-lg bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">
            Sil
          </button>
        </div>
      </div>
      <IDCard person={p} serviceNames={svcName ? [svcName] : []} />
      {p.annualLeaveDays !== undefined && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1">
          <span className="text-[10px] text-emerald-700 font-medium">Yıllık İzin Hakkı:</span>
          <span className="text-[10px] text-emerald-900 font-semibold">{p.annualLeaveDays} gün</span>
        </div>
      )}
      {hasToken && (
        <button
          onClick={handleCreateUser}
          disabled={creating}
          className={`mt-2 w-full rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:cursor-wait disabled:opacity-60`}
        >
          {creating ? "Oluşturuluyor…" : "Kullanıcı Oluştur"}
        </button>
      )}
    </div>
  );
}
