// src/components/ForgotPassword.jsx
import React, { useState } from "react";
import { apiRequestReset } from "../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email) return setMsg("E-posta gerekli");
    setBusy(true); setMsg("");
    try {
      await apiRequestReset(email);
      setMsg("✅ Eğer kayıtlıysa, sıfırlama e-postası gönderildi.");
    } catch (err) {
      setMsg("⚠️ İstek başarısız: " + (err?.message || "bilinmeyen hata"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 p-3 rounded-lg border bg-white">
      <div className="font-medium mb-2">Parolamı unuttum</div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          placeholder="e-posta@ornek.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 px-3 py-2 rounded border"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-2 rounded bg-sky-600 text-white disabled:opacity-60"
        >
          Gönder
        </button>
      </form>
      {msg && <div className="text-sm mt-2 text-slate-600">{msg}</div>}

      <div className="text-xs text-slate-500 mt-2">
        E-postadaki link seni <code>/reset/&lt;token&gt;</code> sayfasına götürecek.
      </div>
    </div>
  );
}
