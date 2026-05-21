// src/tabs/UsersTab.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import {
  Building2,
  KeyRound,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { maskTC } from "../utils/format.js";
import useServicesModel from "../hooks/useServicesModel.js";
import { API, http, getToken, REQUIRE_BACKEND } from "../lib/api.js";

/* ---------------- küçük yardımcılar ---------------- */
function Badge({ children, tone = "slate" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-rose-100 text-rose-700",
  }[tone] || "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] ${cls}`}>
      {children}
    </span>
  );
}

/* ---------------- Servis atama modali (hook sırası SABİT) ---------------- */
function AssignServicesModal({ open, initialIds = [], onClose, onSave }) {
  const m = useServicesModel();
  const [sel, setSel] = useState(() => new Set((initialIds || []).map(String)));
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const all = m.list?.() || [];
    const s = q.trim().toLowerCase();
    let rows = all;
    if (s) {
      rows = rows.filter(
        (r) =>
          String(r.name || "").toLowerCase().includes(s) ||
          String(r.code || "").toLowerCase().includes(s)
      );
    }
    return [...rows].sort(
      (a, b) => Number(b.active) - Number(a.active) || (a.name || "").localeCompare(b.name || "")
    );
  }, [m, q]);

  useEffect(() => {
    if (open) {
      setSel(new Set((initialIds || []).map(String)));
      setQ("");
    }
  }, [open, initialIds]);

  if (!open) return null;

  const toggle = (id) => {
    const k = String(id);
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="font-semibold">Servis ata</div>
          <input
            className="h-9 rounded-lg border px-3 text-sm"
            placeholder="Ara (ad/kod)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="max-h-[52vh] overflow-auto p-2">
          {list.length === 0 ? (
            <div className="p-4 text-sm text-slate-600">Servis bulunamadı.</div>
          ) : (
            <ul className="divide-y">
              {list.map((s) => {
                const id = String(s.id ?? s._id ?? s.code ?? s.name);
                const checked = sel.has(id);
                return (
                  <li key={id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={checked}
                      onChange={() => toggle(id)}
                    />
                    <div className="flex-1">
                      <div className="text-[13px] font-medium">{s.name || s.code}</div>
                      <div className="text-[11px] text-slate-500">{s.code}</div>
                    </div>
                    <Badge tone={s.active ? "green" : "slate"}>{s.active ? "aktif" : "pasif"}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button className="px-3 h-9 rounded-lg border" onClick={onClose}>İptal</button>
          <button
            className="px-4 h-9 rounded-lg bg-sky-600 text-white hover:bg-sky-700"
            onClick={() => onSave(Array.from(sel))}
          >
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Hızlı kullanıcı ekleme ---------------- */
function QuickAddModal({ open, onClose, onSave }) {
  const [form, setForm] = useState({ name: "", tc: "", phone: "", email: "", role: "user" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setMsg("Ad Soyad zorunlu.");
    setSaving(true);
    setMsg("");
    try {
      await API.http.post("/api/users/quick-create", form);
      setMsg("✅ Kullanıcı oluşturuldu.");
      setForm({ name: "", tc: "", phone: "", email: "", role: "user" });
      onSave?.();
    } catch (e) {
      setMsg(`❌ ${e?.message || "Kaydedilemedi"}`);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="font-semibold">Hızlı Kullanıcı Ekle</div>
          <button className="px-3 py-1 rounded-lg border text-sm" onClick={onClose}>Kapat</button>
        </div>
        <form onSubmit={save} className="px-5 py-4 space-y-3">
          {[
            { label: "Ad Soyad *", key: "name", type: "text" },
            { label: "TC Kimlik No", key: "tc", type: "text", maxLength: 11 },
            { label: "Telefon", key: "phone", type: "tel" },
            { label: "E-posta", key: "email", type: "email" },
          ].map(({ label, key, type, maxLength }) => (
            <div key={key}>
              <label className="text-xs text-slate-500">{label}</label>
              <input
                type={type}
                className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                value={form[key]}
                onChange={f(key)}
                maxLength={maxLength}
              />
            </div>
          ))}
          <div>
            <label className="text-xs text-slate-500">Rol</label>
            <select
              className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
              value={form.role}
              onChange={f("role")}
            >
              <option value="user">Standart</option>
              <option value="staff">Yetkili</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {msg && <div className="text-sm">{msg}</div>}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 rounded-lg bg-sky-600 text-white text-sm disabled:opacity-50"
            >
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({ open, user, onClose, onSave }) {
  const [form, setForm] = useState({ name: "", tc: "", phone: "", email: "", personId: null });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [personelList, setPersonelList] = useState([]);

  useEffect(() => {
    if (!open || !user) return;
    setForm({
      name: user.name || "",
      tc: user.tc || "",
      phone: user.phone || "",
      email: user.email || "",
      personId: user.personId || null,
    });
    setMsg("");
    setSaving(false);
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    http.get("/api/personnel?limit=200")
      .then((r) => setPersonelList(Array.isArray(r?.people) ? r.people : Array.isArray(r?.items) ? r.items : []))
      .catch(() => {});
  }, [open]);

  if (!open || !user) return null;

  const setField = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    const userId = String(user.id || user._id || "");
    if (!userId) {
      setMsg("❌ Geçersiz kullanıcı id.");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      await API.http.req(`/api/users/${userId}/identity`, {
        method: "PATCH",
        body: { name: form.name, tc: form.tc },
      });
      await API.http.req(`/api/users/${userId}/profile`, {
        method: "PATCH",
        body: { phone: form.phone, email: form.email },
      });
      if (form.personId !== user.personId) {
        await API.http.req(`/api/users/${userId}/link-person`, {
          method: "PUT",
          body: { personId: form.personId || null },
        });
      }
      setMsg("✅ Güncellendi.");
      await onSave?.();
    } catch (err) {
      setMsg(`❌ ${err?.message || "Güncellenemedi"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="font-semibold">Kullanıcı Bilgilerini Düzenle</div>
          <button className="px-3 py-1 rounded-lg border text-sm" onClick={onClose}>Kapat</button>
        </div>
        <form onSubmit={handleSave} className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs text-slate-500">Ad Soyad</label>
            <input className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.name} onChange={setField("name")} />
          </div>
          <div>
            <label className="text-xs text-slate-500">TC Kimlik No</label>
            <input className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.tc} onChange={setField("tc")} maxLength={11} />
          </div>
          <div>
            <label className="text-xs text-slate-500">Telefon</label>
            <input className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.phone} onChange={setField("phone")} />
          </div>
          <div>
            <label className="text-xs text-slate-500">E-posta</label>
            <input className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.email} onChange={setField("email")} />
          </div>
          <div className="space-y-1">
            <label className="text-[12px] font-medium text-slate-600">Personel Bağlantısı</label>
            <select
              className="w-full rounded-lg border px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={form.personId || ""}
              onChange={(e) => setForm((u) => ({ ...u, personId: e.target.value || null }))}
            >
              <option value="">— Bağlantısız —</option>
              {personelList.map((p) => (
                <option key={p._id || p.id} value={p._id || p.id}>
                  {p.name || p.fullName} {p.serviceId ? `(${p.serviceId})` : ""}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400">Kullanıcıyı bir personel kaydına bağlar</p>
          </div>
          {msg && <div className="text-sm">{msg}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="px-3 h-9 rounded-lg border" onClick={onClose}>İptal</button>
            <button type="submit" disabled={saving} className="px-4 h-9 rounded-lg bg-sky-600 text-white disabled:opacity-50">
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Kullanıcılar sekmesi ---------------- */
export default function UsersTab() {
  const [list, setList] = useState([]);
  const [personnel, setPersonnel] = useState([]);
  const [q, setQ] = useState("");
  const [assignFor, setAssignFor] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editingContact, setEditingContact] = useState(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [backendError, setBackendError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef(null);

  const hasBackend = REQUIRE_BACKEND ? true : !!getToken();

  const servicesModel = useServicesModel();
  const servicesById = useMemo(() => {
    const map = new Map();
    (servicesModel.list?.() || []).forEach((s) => {
      map.set(String(s.id ?? s._id ?? s.code ?? s.name), s);
    });
    return map;
  }, [servicesModel]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    let L = list || [];
    if (s) {
      L = L.filter((u) => {
        const K = [u.name, u.email, u.phone, u.tc, u.role, u.status]
          .map((v) => String(v || "").toLowerCase());
        return K.some((x) => x.includes(s));
      });
    }
    return L;
  }, [list, q]);

  const linkedPersonIds = useMemo(
    () => new Set((list || []).map((u) => u.personId).filter(Boolean).map(String)),
    [list]
  );
  const unlinkedPersonnel = useMemo(
    () =>
      (personnel || []).filter((p) => !linkedPersonIds.has(String(p.id || p._id || ""))),
    [personnel, linkedPersonIds]
  );
  const activeCount = useMemo(
    () => (rows || []).filter((u) => (u.status || (u.active === false ? "pending" : "active")) === "active").length,
    [rows]
  );
  const bulkCreateDisabled = unlinkedPersonnel.length === 0 || !hasBackend;

  const refresh = async () => {
    if (REQUIRE_BACKEND && !getToken()) {
      setBackendError("Backend oturumu gerekli. Lütfen giriş yapın.");
      setList([]);
      return;
    }
    if (!hasBackend) {
      setBackendError("Backend gerekli. Lütfen giriş yapın.");
      setList([]);
      return;
    }
    try {
      setBackendError("");
      const data = await API.http.get('/api/users');
      setList(Array.isArray(data) ? data : []);
      return;
    } catch (e) {
      console.error('Users fetch error:', e);
      setBackendError(e?.message || 'Backend kullanıcı listesi alınamadı');
      return;
    }
  };

  useEffect(() => {
    refresh();
  }, [hasBackend]);

  useEffect(() => {
    API.http.get('/api/personnel?size=500')
      .then((d) => setPersonnel(Array.isArray(d?.items) ? d.items : []))
      .catch(() => {});
  }, []);

  // Modal ESC ile kapanma
  const anyModalOpen = Boolean(assignFor) || quickAddOpen || Boolean(editUser);
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== "Escape") return;
      if (editUser) { setEditUser(null); return; }
      if (quickAddOpen) { setQuickAddOpen(false); return; }
      if (assignFor) { setAssignFor(null); return; }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editUser, quickAddOpen, assignFor]);

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = anyModalOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [anyModalOpen]);

  const downloadTemplate = async () => {
    try {
      setImportMsg("");
      const res = await fetch(`${API.base}/api/users/export.xlsx`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kullanicilar.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e?.message || "Şablon indirilemedi");
    }
  };

  const handleImport = async (file) => {
    if (!file) return;
    if (!hasBackend) {
      toast.error("Backend gerekli. Lütfen giriş yapın.");
      return;
    }
    setImporting(true);
    setImportMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API.base}/api/users/import.xlsx`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
        body: fd,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || `HTTP ${res.status}`);
      }
      setImportMsg(`✅ İçe aktarıldı. Upsert: ${data?.upserts ?? 0}`);
      await refresh();
    } catch (e) {
      setImportMsg(`❌ ${e?.message || "İçe aktarım hatası"}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };


  const roleBadge = (role) => {
    const r = String(role || "").toUpperCase();
    if (r === "ADMIN") return <Badge tone="red">ADMIN</Badge>;
    if (r === "AUTHORIZED" || r === "STAFF") return <Badge tone="amber">{r}</Badge>;
    return <Badge>STANDARD</Badge>;
  };

  const formatServiceNames = (ids = []) => {
    const arr = Array.isArray(ids) ? ids : [];
    const names = arr
      .map((id) => {
        const s = servicesById.get(String(id));
        if (!s) return null;
        return (s.name || s.code || "").trim() || null;
      })
      .filter(Boolean);
    return names.length ? names.join(", ") : "-";
  };

  const handleActivate = async (u) => {
    if (!hasBackend) {
      toast.error("Backend gerekli. Lütfen giriş yapın.");
      return;
    }

    // ID belirleme ve doğrulama
    const userId = String(u._id || u.id || "");
    if (userId.length !== 24) {
      toast.error("Geçersiz kullanıcı id.");
      return;
    }

    // Doğru endpoint: /api/users/:id/activate
    try {
      await API.http.post(`/api/users/${userId}/activate`);
      toast.success("Kullanıcı aktifleştirildi.");
      refresh();
    } catch (e) {
      toast.error(e?.message || "Aktifleştirme başarısız");
    }
  };

  const handleSetRole = async (u, role) => {
    if (!hasBackend) {
      toast.error("Backend gerekli. Lütfen giriş yapın.");
      return;
    }
    const userId = String(u._id || u.id || "");
    if (userId.length !== 24) {
      toast.error("Geçersiz kullanıcı id.");
      return;
    }
    const roleMap = { ADMIN: 'admin', AUTHORIZED: 'staff', STAFF: 'staff', STANDARD: 'user', USER: 'user', admin: 'admin', authorized: 'staff', staff: 'staff', standard: 'user', user: 'user' };
    const roleOut = roleMap[role] || roleMap[String(role || '').toUpperCase()] || 'user';
    try {
      await API.http.req(`/api/users/${userId}/role`, { method: 'PATCH', body: { role: roleOut } });
      toast.success("Rol güncellendi.");
      refresh();
    } catch (e) {
      toast.error(e?.message || "Rol güncellenemedi");
    }
  };

  const handleSuspend = async (u) => {
    if (!hasBackend) {
      toast.error("Backend gerekli. Lütfen giriş yapın.");
      return;
    }
    const userId = String(u._id || u.id || "");
    if (userId.length !== 24) {
      toast.error("Geçersiz kullanıcı id.");
      return;
    }
    try {
      await API.http.post(`/api/users/${userId}/deactivate`);
      toast.success("Kullanıcı askıya alındı.");
      refresh();
    } catch (e) {
      toast.error(e?.message || "Askıya alma başarısız");
    }
  };

  const handleResetPassword = async (u) => {
    if (!hasBackend) {
      toast.error("Backend gerekli. Lütfen giriş yapın.");
      return;
    }
    const identifier = u.email || u.phone || u.tc;
    if (!identifier) {
      toast.error("E-posta/telefon/TC bilgisi yok.");
      return;
    }
    if (!window.confirm(`"${u.name || u.email || u.tc}" için şifre sıfırlansın mı?`)) return;
    try {
      const r = await API.http.post('/api/users/reset-password', { identifier });
      if (r?.tempPassword) {
        toast.success(`Geçici şifre: ${r.tempPassword}`);
      } else {
        toast.success("Şifre sıfırlandı. E-posta gönderildi.");
      }
    } catch (e) {
      toast.error(e?.message || "Şifre sıfırlanamadı");
    }
  };

  const handleBulkFromPersonnel = async () => {
    const unlinked = unlinkedPersonnel;
    if (!unlinked.length) {
      toast.error("Tüm personelin zaten kullanıcısı var.");
      return;
    }

    const ok = window.confirm(
      `${unlinked.length} personel için otomatik kullanıcı oluşturulsun mu?\nGeçici şifre: TC numarası (TC yoksa Hastane2026!)`
    );
    if (!ok) return;

    try {
      const res = await API.http.post("/api/users/bulk-from-personnel", {
        personIds: unlinked.map((p) => p.id || p._id),
      });
      toast.success(`${res.created || 0} kullanıcı oluşturuldu. ${res.skipped || 0} atlandı.`);
      refresh();
    } catch (e) {
      toast.error(e?.message || "Hata oluştu.");
    }
  };

  const handleLinkPerson = async (user, nextPersonId) => {
    if (!hasBackend) {
      toast.error("Backend gerekli. Lütfen giriş yapın.");
      return;
    }
    const userId = String(user?.id || user?._id || "");
    if (!userId) {
      toast.error("Geçersiz kullanıcı id.");
      return;
    }
    const payloadId = nextPersonId ? String(nextPersonId) : null;

    // Optimistik güncelle
    setList((prev) =>
      (prev || []).map((u) =>
        String(u.id || u._id) === userId ? { ...u, personId: payloadId } : u
      )
    );

    try {
      await API.http.req(`/api/users/${userId}/link-person`, {
        method: "PUT",
        body: { personId: payloadId },
      });
    } catch (e) {
      // rollback
      setList((prev) =>
        (prev || []).map((u) =>
          String(u.id || u._id) === userId ? { ...u, personId: user?.personId || null } : u
        )
      );
      toast.error(e?.message || "Personel bağlanamadı.");
      return;
    }
  };

  const openContactEditor = (u) => {
    const userId = String(u?.id || u?._id || "");
    if (!userId) return;
    setEditingContact({
      userId,
      phone: String(u?.phone || ""),
      email: String(u?.email || ""),
      saving: false,
    });
  };

  const closeContactEditor = () => setEditingContact(null);

  const updateContactDraft = (key, value) => {
    setEditingContact((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const saveContactEditor = async (u) => {
    const userId = String(u?.id || u?._id || "");
    if (!hasBackend) {
      toast.error("Backend gerekli. Lütfen giriş yapın.");
      return;
    }
    if (!editingContact || editingContact.userId !== userId) return;
    setEditingContact((prev) => (prev ? { ...prev, saving: true } : prev));
    try {
      await API.http.req(`/api/users/${userId}/profile`, {
        method: "PATCH",
        body: {
          phone: String(editingContact.phone || "").trim() || undefined,
          email: String(editingContact.email || "").trim() || undefined,
        },
      });
      toast.success("İletişim bilgileri güncellendi.");
      await refresh();
      setEditingContact(null);
    } catch (e) {
      toast.error(e?.message || "İletişim bilgileri güncellenemedi");
      setEditingContact((prev) => (prev ? { ...prev, saving: false } : prev));
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[30px] border border-slate-200 bg-white px-5 py-5 shadow-sm md:px-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_340px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                <UserCog className="h-3.5 w-3.5 text-sky-700" />
                Kullanıcı Yönetimi
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                Yetki ve Erişim
              </span>
            </div>
            <div className="mt-4 flex items-start gap-4">
              <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm md:flex">
                <UserCog className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Kullanıcılar</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  Sisteme giriş yapabilen hesapları, rollerini, servis erişimlerini ve personel bağlantılarını buradan yönetin.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                    <Users className="h-4 w-4 text-sky-700" />
                    {rows.length} kullanıcı
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                    <ShieldCheck className="h-4 w-4 text-emerald-700" />
                    {activeCount} aktif hesap
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                    <Building2 className="h-4 w-4 text-violet-700" />
                    {unlinkedPersonnel.length} personel bağ bekliyor
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Hızlı İşlem</div>
              <div className="mt-2 text-sm font-medium text-slate-800">Yeni kullanıcı ekleyin veya personelden toplu hesap oluşturun.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Güvenlik Notu</div>
              <div className="mt-2 text-sm font-medium text-slate-800">Rol, servis ve şifre işlemleri doğrudan erişim kapsamını etkiler.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="h-10 px-3 rounded-xl bg-slate-950 text-white text-sm hover:bg-slate-800"
              onClick={() => setQuickAddOpen(true)}
            >
              + Kullanıcı Ekle
            </button>
            <button
              className={`h-10 px-3 rounded-xl text-sm transition ${
                bulkCreateDisabled
                  ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              }`}
              onClick={handleBulkFromPersonnel}
              disabled={bulkCreateDisabled}
              title={
                !hasBackend
                  ? "Backend oturumu gerekli"
                  : unlinkedPersonnel.length === 0
                      ? "Kullanıcısı olmayan personel kalmadı"
                      : "Personel kayıtlarından toplu giriş hesabı oluştur"
              }
            >
              Personelden Oluştur ({unlinkedPersonnel.length})
            </button>
            <button className="h-10 px-3 rounded-xl border text-sm hover:bg-slate-50" onClick={downloadTemplate}>
              Excel Şablon İndir
            </button>
            <button
              className="h-10 px-3 rounded-xl border text-sm hover:bg-slate-50"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
            >
              {importing ? "İçe aktarılıyor..." : "Excel İçe Aktar"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => handleImport(e.target.files?.[0])}
            />
          </div>

          <div className="flex flex-1 flex-col gap-3 sm:flex-row xl:max-w-[560px]">
            <label className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                placeholder="Ara: ad / tc / tel / mail / rol / durum"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <button className="h-10 px-3 rounded-xl border text-sm hover:bg-slate-50" onClick={refresh}>
              <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Yenile</span>
            </button>
          </div>
        </div>
      </section>

      {importMsg && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{importMsg}</div>
      )}

      {backendError && (
        <div className="p-4 border rounded-xl text-sm text-rose-700 bg-rose-50">
          Backend kullanıcı listesi alınamadı: {backendError}.
        </div>
      )}

      {rows.length === 0 && (
        <div className="p-4 border rounded-xl text-sm text-slate-600">
          Kayıt bulunamadı.
        </div>
      )}

      {/* kartlar */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((u) => {
          const userId = u.id || u._id;
          const currentServiceIds = (Array.isArray(u.serviceIds) ? u.serviceIds : u.services) || [];
          const isEditingContact = editingContact?.userId === String(userId);

          return (
            <div key={userId} className="rounded-[24px] border border-slate-200 bg-white shadow-sm p-4">
              <div className="flex items-start justify-between">
                <div className="font-semibold text-[14px] text-slate-900">{u.name || "-"}</div>
                <Badge tone={u.status === "active" ? "green" : u.status === "pending" ? "amber" : "slate"}>
                  {u.status || (u.active === false ? "pending" : "active")}
                </Badge>
              </div>

              <div className="mt-3 text-[12px] space-y-1.5 text-slate-600">
                <div>TC: {maskTC(u.tc)}</div>
                <div>Tel: {u.phone || "-"}</div>
                <div>Mail: {u.email || "-"}</div>
                <div>Rol: {roleBadge(u.role)}</div>
                <div>Servisler: {formatServiceNames(currentServiceIds)}</div>
                <div className="pt-1">
                  <select
                    value={u.personId || ''}
                    onChange={async (e) => {
                      await handleLinkPerson(u, e.target.value || null);
                    }}
                    className="text-sm border rounded px-2 py-1 text-slate-700"
                  >
                    <option value="">— Personel bağla —</option>
                    {personnel.map((p) => {
                      const pid = p.id || p._id;
                      return (
                        <option key={pid} value={pid}>
                          {p.fullName || p.name}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                      İletişim Bilgileri
                    </div>
                    <div className="mt-1 text-[12px] text-slate-600">
                      Telefon ve e-posta buradan güncellenir.
                    </div>
                  </div>
                  {!isEditingContact ? (
                    <button
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-100"
                      onClick={() => openContactEditor(u)}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      İletişim düzenle
                    </button>
                  ) : null}
                </div>

                {!isEditingContact ? null : (
                  <div className="mt-3 grid gap-3">
                    <div>
                      <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                        Telefon
                      </label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        value={editingContact.phone}
                        onChange={(e) => updateContactDraft("phone", e.target.value)}
                        placeholder="05xx xxx xx xx"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                        E-posta
                      </label>
                      <input
                        type="email"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        value={editingContact.email}
                        onChange={(e) => updateContactDraft("email", e.target.value)}
                        placeholder="ornek@mail.com"
                      />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-100"
                        type="button"
                        onClick={closeContactEditor}
                        disabled={editingContact.saving}
                      >
                        <X className="h-3.5 w-3.5" />
                        Vazgeç
                      </button>
                      <button
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-[12px] font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                        type="button"
                        onClick={() => saveContactEditor(u)}
                        disabled={editingContact.saving}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {editingContact.saving ? "Kaydediliyor..." : "Kaydet"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {u.status !== "active" ? (
                  <button
                    className="text-[12px] px-3 py-1 rounded bg-emerald-600 text-white"
                    onClick={() => handleActivate(u)}
                  >
                    Aktifleştir
                  </button>
                ) : (
                  <button
                    className="text-[12px] px-3 py-1 rounded border"
                    onClick={() => handleSuspend(u)}
                  >
                    Askıya al
                  </button>
                )}

                <button
                  className="text-[12px] px-3 py-1 rounded border"
                  onClick={() => { handleSetRole(u, "ADMIN"); }}
                >
                  Admin yap
                </button>
                <button
                  className="text-[12px] px-3 py-1 rounded border"
                  onClick={() => { handleSetRole(u, "AUTHORIZED"); }}
                >
                  Yetkili yap
                </button>
                <button
                  className="text-[12px] px-3 py-1 rounded border"
                  onClick={() => { handleSetRole(u, "STANDARD"); }}
                >
                  Standart yap
                </button>

                <button
                  className="text-[12px] px-3 py-1 rounded border"
                  onClick={() => setEditUser(u)}
                >
                  Kimlik / Bağlantı Düzenle
                </button>

                <button
                  className="text-[12px] px-3 py-1 rounded border"
                  onClick={() =>
                    setAssignFor({
                      id: userId,
                      name: u.name || u.email || u.tc,
                      services: currentServiceIds.map(String),
                    })
                  }
                >
                  Servis ata
                </button>

                {hasBackend && (
                  <button
                    className="text-[12px] px-3 py-1 rounded border"
                    onClick={() => handleResetPassword(u)}
                  >
                    <span className="inline-flex items-center gap-1"><KeyRound className="h-3.5 w-3.5" /> Şifre sıfırla</span>
                  </button>
                )}

                <button
                  className="text-[12px] px-3 py-1 rounded border text-red-600"
                  onClick={async () => {
                    if (window.confirm(`"${u.name || u.email}" silinsin mi?`)) {
                      if (!hasBackend) {
                        toast.error("Backend gerekli. Lütfen giriş yapın.");
                        return;
                      }
                      if (String(userId).length !== 24) {
                        toast.error("Geçersiz kullanıcı id.");
                        return;
                      }
                      try {
                        await API.http.req(`/api/users/${userId}`, { method: 'DELETE' });
                        toast.success("Kullanıcı silindi.");
                        refresh();
                        return;
                      } catch (e) {
                        toast.error(e?.message || 'Silinemedi');
                        return;
                      }
                    }
                  }}
                >
                  Sil
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <AssignServicesModal
        open={Boolean(assignFor)}
        initialIds={assignFor?.services || []}
        onClose={() => setAssignFor(null)}
        onSave={async (ids) => {
          try {
            if (!hasBackend) {
              toast.error("Backend gerekli. Lütfen giriş yapın.");
              return;
            }
            if (String(assignFor.id || "").length !== 24) {
              toast.error("Geçersiz kullanıcı id.");
              return;
            }
            await API.setUserServices(assignFor.id, ids);
            toast.success("Servisler kaydedildi.");
            setAssignFor(null);
            refresh();
          } catch (e) {
            toast.error(e.message || "Kaydedilemedi");
          }
        }}
      />

      <QuickAddModal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onSave={async () => {
          setQuickAddOpen(false);
          await refresh();
        }}
      />

      <EditUserModal
        open={Boolean(editUser)}
        user={editUser}
        onClose={() => setEditUser(null)}
        onSave={async () => {
          await refresh();
          setEditUser(null);
        }}
      />
    </div>
  );
}
