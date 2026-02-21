// src/pages/auth/Login.jsx
import React, { useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e) {
    e.preventDefault();              // ⬅️ 404'u önler (GET /login gitmez)
    setErr("");
    try {
      await signIn({ identifier, password }); // POST /api/auth/login
      // İstersen burada navigate("/") yapacağız — sonraki adımda ekleriz.
    } catch (ex) {
      setErr(ex.message || "Giriş hatası");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md bg-white shadow rounded-2xl p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold text-center">Hoş geldiniz</h1>

        <div className="space-y-2">
          <label className="text-sm text-slate-600">Kimlik</label>
          <input
            className="w-full border rounded-lg px-3 py-2"
            placeholder="TC / E-posta / Telefon"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-600">Parola</label>
          <input
            type="password"
            className="w-full border rounded-lg px-3 py-2"
            placeholder="Parola"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {err && <div className="text-red-600 text-sm">{err}</div>}

        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded-lg py-2 font-medium"
        >
          Giriş Yap
        </button>
      </form>
    </div>
  );
}
