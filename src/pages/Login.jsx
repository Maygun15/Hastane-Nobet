// src/pages/auth/Login.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setErr("");
    setLoading(true);
    try {
      await login({ identifier, password });
      navigate("/", { replace: true });
    } catch (ex) {
      setErr(ex.message || "Giriş hatası");
    } finally {
      setLoading(false);
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

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
        >
          {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
        </button>
      </form>
    </div>
  );
}
