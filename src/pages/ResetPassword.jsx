// src/pages/ResetPassword.jsx
import React, { useMemo, useState } from "react";
import { apiResetPassword } from "../lib/api";

function readTokenFromLocation() {
  try {
    const p = window.location.pathname || "/";
    // /reset/<token> veya /reset/<token>/ gibi
    const seg = p.split("/").filter(Boolean);
    const idx = seg.findIndex(s => s === "reset");
    if (idx >= 0 && seg[idx+1]) return seg[idx+1];
    // hash desteklemek istersen: #/reset/<token>
    const h = window.location.hash || "";
    const hx = h.replace(/^#\/?/, "").split("/").filter(Boolean);
    const hidx = hx.findIndex(s => s === "reset");
    if (hidx >= 0 && hx[hidx+1]) return hx[hidx+1];
  } catch {}
  return "";
}

export default function ResetPasswordPage() {
  const token = useMemo(readTokenFromLocation, []);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token) return setMsg("Geçersiz bağlantı (token yok).");
    if (!pwd || pwd.length < 6) return setMsg("Parola en az 6 karakter olmalı.");
    if (pwd !== pwd2) return setMsg("Parolalar eşleşmiyor.");
    setBusy(true); setMsg("");
    try {
      await apiResetPassword(token, pwd);
      setMsg("✅ Parola güncellendi. Giriş sayfasına dönebilirsin.");
      setTimeout(() => {
        try { window.history.pushState({}, "", "/"); window.dispatchEvent(new Event("urlchange")); } catch {}
      }, 1200);
    } catch (err) {
      setMsg("❌ Hata: " + (err?.message || "işlem başarısız"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white border rounded-2xl shadow-sm p-5">
        <div className="text-lg font-semibold mb-2">Yeni Parola Belirle</div>
        <div className="text-xs text-slate-500 mb-4">Token: <code className="break-all">{token || "(yok)"}</code></div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            placeholder="Yeni parola"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            className="w-full px-3 py-2 rounded border"
            disabled={busy}
          />
          <input
            type="password"
            placeholder="Yeni parola (tekrar)"
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
            className="w-full px-3 py-2 rounded border"
            disabled={busy}
          />
          <button
            type="submit"
            className="w-full px-3 py-2 rounded bg-sky-600 text-white disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Gönderiliyor…" : "Parolayı Güncelle"}
          </button>
        </form>

        {msg && <div className="text-sm mt-3 text-slate-700">{msg}</div>}
      </div>
    </div>
  );
}
