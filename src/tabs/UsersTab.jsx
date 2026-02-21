// src/tabs/UsersTab.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import useServicesModel from "../hooks/useServicesModel.js";
import { API, getToken, REQUIRE_BACKEND } from "../lib/api.js";

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

/* ---------------- Kullanıcılar sekmesi ---------------- */
export default function UsersTab() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [assignFor, setAssignFor] = useState(null);
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
      setList([]);
      return;
    }
  };

  useEffect(() => {
    refresh();
  }, [hasBackend]);

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
      alert(e?.message || "Şablon indirilemedi");
    }
  };

  const handleImport = async (file) => {
    if (!file) return;
    if (!hasBackend) {
      alert("Backend gerekli. Lütfen giriş yapın.");
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
      alert("Backend gerekli. Lütfen giriş yapın.");
      return;
    }

    // ID belirleme ve doğrulama
    const userId = String(u._id || u.id || "");
    if (userId.length !== 24) {
      alert("Geçersiz kullanıcı id.");
      return;
    }

    // Doğru endpoint: /api/users/:id/activate
    try {
      await API.http.post(`/api/users/${userId}/activate`);
      refresh();
    } catch (e) {
      alert(e?.message || "Aktifleştirme başarısız");
    }
  };

  const handleSetRole = async (u, role) => {
    if (!hasBackend) {
      alert("Backend gerekli. Lütfen giriş yapın.");
      return;
    }
    const userId = String(u._id || u.id || "");
    if (userId.length !== 24) {
      alert("Geçersiz kullanıcı id.");
      return;
    }
    const roleMap = { ADMIN: 'admin', AUTHORIZED: 'staff', STAFF: 'staff', STANDARD: 'user', USER: 'user', admin: 'admin', authorized: 'staff', staff: 'staff', standard: 'user', user: 'user' };
    const roleOut = roleMap[role] || roleMap[String(role || '').toUpperCase()] || 'user';
    try {
      await API.http.req(`/api/users/${userId}/role`, { method: 'PATCH', body: { role: roleOut } });
      refresh();
    } catch (e) {
      alert(e?.message || "Rol güncellenemedi");
    }
  };

  const handleSuspend = async (u) => {
    if (!hasBackend) {
      alert("Backend gerekli. Lütfen giriş yapın.");
      return;
    }
    const userId = String(u._id || u.id || "");
    if (userId.length !== 24) {
      alert("Geçersiz kullanıcı id.");
      return;
    }
    try {
      await API.http.post(`/api/users/${userId}/deactivate`);
      refresh();
    } catch (e) {
      alert(e?.message || "Askıya alma başarısız");
    }
  };

  const handleResetPassword = async (u) => {
    if (!hasBackend) {
      alert("Backend gerekli. Lütfen giriş yapın.");
      return;
    }
    const identifier = u.email || u.phone || u.tc;
    if (!identifier) {
      alert("E-posta/telefon/TC bilgisi yok.");
      return;
    }
    if (!confirm(`"${u.name || u.email || u.tc}" için şifre sıfırlansın mı?`)) return;
    try {
      const r = await API.http.post('/api/users/reset-password', { identifier });
      if (r?.tempPassword) {
        alert(`Geçici şifre: ${r.tempPassword}`);
      } else {
        alert("Şifre sıfırlandı. E-posta gönderildi.");
      }
    } catch (e) {
      alert(e?.message || "Şifre sıfırlanamadı");
    }
  };

  return (
    <div className="space-y-4">
      {/* arama */}
      <div className="flex items-center gap-2">
        <input
          className="h-10 px-3 rounded-lg border w-80"
          placeholder="Ara: ad / tc / tel / mail / rol / durum"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="h-10 px-3 rounded-lg border" onClick={refresh}>
          Yenile
        </button>
        <button className="h-10 px-3 rounded-lg border" onClick={downloadTemplate}>
          Excel Şablon İndir
        </button>
        <button
          className="h-10 px-3 rounded-lg border"
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
      {importMsg && (
        <div className="text-sm text-slate-600">{importMsg}</div>
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

          return (
            <div key={userId} className="rounded-xl border bg-white shadow-sm p-3">
              <div className="flex items-start justify-between">
                <div className="font-semibold text-[14px]">{u.name || "-"}</div>
                <Badge tone={u.status === "active" ? "green" : u.status === "pending" ? "amber" : "slate"}>
                  {u.status || (u.active === false ? "pending" : "active")}
                </Badge>
              </div>

              <div className="mt-2 text-[12px] space-y-1">
                <div>TC: {u.tc || "-"}</div>
                <div>Tel: {u.phone || "-"}</div>
                <div>Mail: {u.email || "-"}</div>
                <div>Rol: {roleBadge(u.role)}</div>
                <div>Servisler: {formatServiceNames(currentServiceIds)}</div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
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
                    Şifre sıfırla
                  </button>
                )}

                <button
                  className="text-[12px] px-3 py-1 rounded border text-red-600"
                  onClick={async () => {
                    if (confirm(`"${u.name || u.email}" silinsin mi?`)) {
                      if (!hasBackend) {
                        alert("Backend gerekli. Lütfen giriş yapın.");
                        return;
                      }
                      if (String(userId).length !== 24) {
                        alert("Geçersiz kullanıcı id.");
                        return;
                      }
                      try {
                        await API.http.req(`/api/users/${userId}`, { method: 'DELETE' });
                        refresh();
                        return;
                      } catch (e) {
                        alert(e?.message || 'Silinemedi');
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
              alert("Backend gerekli. Lütfen giriş yapın.");
              return;
            }
            if (String(assignFor.id || "").length !== 24) {
              alert("Geçersiz kullanıcı id.");
              return;
            }
            await API.setUserServices(assignFor.id, ids);
            setAssignFor(null);
            refresh();
          } catch (e) {
            alert(e.message || "Kaydedilemedi");
          }
        }}
      />
    </div>
  );
}
