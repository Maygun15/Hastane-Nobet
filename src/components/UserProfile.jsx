// src/components/UserProfile.jsx
import React, { useState, useEffect, useMemo } from "react";
import { API } from "../lib/api.js";
import { maskTC } from "../utils/format.js";
import useServicesModel from "../hooks/useServicesModel.js";

export default function UserProfile({ currentUser, onUpdate }) {
  const servicesModel = useServicesModel();
  const services = useMemo(() => {
    const all = servicesModel.list?.() || [];
    return [...all].sort((a, b) =>
      (a.name || a.code || "").localeCompare((b.name || b.code || ""), "tr", { sensitivity: "base" })
    );
  }, [servicesModel]);
  const servicesById = useMemo(() => {
    const map = new Map();
    services.forEach((s) => {
      map.set(String(s.id ?? s._id ?? s.code ?? s.name), s);
    });
    return map;
  }, [services]);

  const [form, setForm] = useState({
    phone: "",
    email: "",
    serviceId: "",
  });
  const [identityForm, setIdentityForm] = useState({
    name: "",
    tc: "",
  });
  const [pwForm, setPwForm] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [saving, setSaving] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [identityMsg, setIdentityMsg] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  useEffect(() => {
    if (currentUser) {
      const svc = Array.isArray(currentUser.serviceIds)
        ? currentUser.serviceIds[0]
        : currentUser.serviceId || "";
      setForm({
        phone: currentUser.phone || "",
        email: currentUser.email || "",
        serviceId: svc ? String(svc) : "",
      });
      setIdentityForm({
        name: currentUser.name || "",
        tc: String(currentUser.tc || "").replace(/\D/g, "").slice(0, 11),
      });
    }
  }, [currentUser]);

  const isAdminOrAuth = ["ADMIN", "AUTHORIZED", "STAFF"].includes(
    String(currentUser?.role || "").toUpperCase()
  );

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const userId = currentUser._id || currentUser.id;
      const body = { phone: form.phone, email: form.email };
      if (isAdminOrAuth) body.serviceId = form.serviceId || "";
      await API.http.req(`/api/users/${userId}/profile`, {
        method: "PATCH",
        body,
      });
      setMsg("✅ Kaydedildi.");
      onUpdate?.();
    } catch (err) {
      setMsg(`❌ ${err?.message || "Kaydedilemedi"}`);
    } finally {
      setSaving(false);
    }
  };

  const saveIdentity = async (e) => {
    e.preventDefault();
    if (!isAdminOrAuth) return;
    setIdentitySaving(true);
    setIdentityMsg("");
    try {
      const userId = currentUser._id || currentUser.id;
      const tcDigits = String(identityForm.tc || "").replace(/\D/g, "").slice(0, 11);
      await API.http.req(`/api/users/${userId}/identity`, {
        method: "PATCH",
        body: {
          name: String(identityForm.name || "").trim(),
          tc: tcDigits,
        },
      });
      setIdentityMsg("✅ Kimlik bilgileri güncellendi.");
      onUpdate?.();
    } catch (err) {
      setIdentityMsg(`❌ ${err?.message || "Kimlik bilgileri güncellenemedi"}`);
    } finally {
      setIdentitySaving(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) {
      setPwMsg("❌ Yeni şifreler eşleşmiyor.");
      return;
    }
    if (pwForm.next.length < 6) {
      setPwMsg("❌ Şifre en az 6 karakter olmalı.");
      return;
    }
    setPwSaving(true);
    setPwMsg("");
    try {
      await API.http.post("/api/users/change-password", {
        currentPassword: pwForm.current,
        newPassword: pwForm.next,
      });
      setPwMsg("✅ Şifre güncellendi.");
      setPwForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      setPwMsg(`❌ ${err?.message || "Şifre güncellenemedi"}`);
    } finally {
      setPwSaving(false);
    }
  };

  if (!currentUser) return null;

  const displayServiceIds = Array.isArray(currentUser.serviceIds)
    ? currentUser.serviceIds
    : currentUser.serviceId
      ? [currentUser.serviceId]
      : [];
  const displayServices = displayServiceIds
    .map((id) => {
      const s = servicesById.get(String(id));
      return s?.name || s?.code || String(id);
    })
    .filter(Boolean);

  return (
    <div className="max-w-xl mx-auto space-y-6 p-4">
      {/* Kimlik Bilgileri */}
      <div className="rounded-xl border bg-white p-4 space-y-2">
        <h2 className="font-semibold text-slate-800 mb-3">Kimlik Bilgileri</h2>
        <div className="grid grid-cols-2 gap-3 text-sm mb-2">
          <div>
            <div className="text-xs text-slate-500 mb-1">Ad Soyad</div>
            <div className="font-medium">{currentUser.name || "-"}</div>
            {!isAdminOrAuth && (
              <div className="text-[11px] text-slate-400 mt-0.5">
                Değiştirmek için yöneticinize başvurun.
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">T.C. Kimlik No</div>
            <div className="font-medium">{maskTC(currentUser.tc)}</div>
            {!isAdminOrAuth && (
              <div className="text-[11px] text-slate-400 mt-0.5">
                Değiştirmek için yöneticinize başvurun.
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Rol</div>
            <div className="font-medium">{currentUser.role || "STANDARD"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Durum</div>
            <div className="font-medium">{currentUser.status || "active"}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-slate-500 mb-1">Servis</div>
            <div className="font-medium">{displayServices.join(", ") || "-"}</div>
          </div>
        </div>
        {isAdminOrAuth && (
          <form onSubmit={saveIdentity} className="space-y-3 border-t pt-3">
            <div>
              <label className="text-xs text-slate-500">Ad Soyad</label>
              <input
                className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                value={identityForm.name}
                onChange={(e) => setIdentityForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">T.C. Kimlik No</label>
              <input
                className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                value={identityForm.tc}
                maxLength={11}
                onChange={(e) =>
                  setIdentityForm((f) => ({ ...f, tc: e.target.value.replace(/\D/g, "").slice(0, 11) }))
                }
              />
            </div>
            {identityMsg && <div className="text-sm">{identityMsg}</div>}
            <button
              type="submit"
              disabled={identitySaving}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
            >
              {identitySaving ? "Kaydediliyor..." : "Kimliği Kaydet"}
            </button>
          </form>
        )}
      </div>

      {/* İletişim Bilgileri — düzenlenebilir */}
      <form onSubmit={saveProfile} className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold text-slate-800">İletişim Bilgileri</h2>
        <div>
          <label className="text-xs text-slate-500">Servis</label>
          {isAdminOrAuth ? (
            <select
              className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
              value={form.serviceId}
              onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value }))}
            >
              <option value="">— Servis seç —</option>
              {services.map((s) => {
                const id = String(s.id ?? s._id ?? s.code ?? s.name);
                return (
                  <option key={id} value={id}>
                    {s.name || s.code || id}
                  </option>
                );
              })}
            </select>
          ) : (
            <div className="mt-1 text-sm">{displayServices.join(", ") || "-"}</div>
          )}
        </div>
        <div>
          <label className="text-xs text-slate-500">Telefon</label>
          <input
            className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="05xx xxx xx xx"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">E-posta</label>
          <input
            type="email"
            className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="ornek@mail.com"
          />
        </div>
        {msg && <div className="text-sm">{msg}</div>}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm disabled:opacity-50"
        >
          {saving ? "Kaydediliyor..." : "Kaydet"}
        </button>
      </form>

      {/* Şifre Değiştir */}
      <form onSubmit={changePassword} className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold text-slate-800">Şifre Değiştir</h2>
        <div>
          <label className="text-xs text-slate-500">Mevcut Şifre</label>
          <input
            type="password"
            className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
            value={pwForm.current}
            onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Yeni Şifre</label>
          <input
            type="password"
            className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
            value={pwForm.next}
            onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Yeni Şifre (Tekrar)</label>
          <input
            type="password"
            className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
            value={pwForm.confirm}
            onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
          />
        </div>
        {pwMsg && <div className="text-sm">{pwMsg}</div>}
        <button
          type="submit"
          disabled={pwSaving}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
        >
          {pwSaving ? "Güncelleniyor..." : "Şifreyi Güncelle"}
        </button>
      </form>
    </div>
  );
}
