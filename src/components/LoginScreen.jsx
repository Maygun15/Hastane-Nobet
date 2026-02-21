// src/components/LoginScreen.jsx
import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import ForgotPassword from "./ForgotPassword.jsx";

export default function LoginScreen() {
  const [tab, setTab] = useState("login");
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-sky-50">
      <div className="w-[420px] rounded-2xl bg-white shadow-xl p-6">
        <div className="text-center mb-5">
          <span className="inline-block text-xs px-3 py-1 rounded-full bg-sky-100 text-sky-700 mb-2">
            Hastane Nöbet Sistemi
          </span>
          <h1 className="text-xl font-semibold">
            {tab === "login" ? "Hoş geldiniz" : "Hesap oluştur"}
          </h1>
          <p className="text-sm text-slate-500">
            {tab === "login"
              ? "Devam etmek için kimlik ve parolanızı girin."
              : "Kısa bir kayıtla hemen başlayın."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            className={`h-9 rounded-md text-sm font-medium border ${
              tab === "login"
                ? "bg-sky-600 text-white border-sky-600"
                : "bg-white border-slate-200"
            }`}
            onClick={() => setTab("login")}
            type="button"
          >
            Giriş
          </button>
          <button
            className={`h-9 rounded-md text-sm font-medium border ${
              tab === "register"
                ? "bg-sky-600 text-white border-sky-600"
                : "bg-white border-slate-200"
            }`}
            onClick={() => setTab("register")}
            type="button"
          >
            Kayıt Ol
          </button>
        </div>

        {tab === "login" ? <LoginForm /> : <RegisterForm onDone={() => setTab("login")} />}

        <p className="text-[11px] text-center text-slate-500 mt-4">
          İlk kayıt otomatik <b>admin</b> olur. Diğer kayıtlar <b>onay bekler</b>.
        </p>
      </div>
    </div>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState(""); // e-posta / TC / telefon / ad
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login({ identifier, password }); // ← email yerine identifier gönderiyoruz
    } catch (ex) {
      setErr(ex.message || "Giriş başarısız");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div>
          <label className="text-xs text-slate-600">Kimlik</label>
          <input
            type="text"                         // ← ÖNEMLİ: text
            name="identifier"
            className="mt-1 w-full h-10 px-3 rounded-md border border-slate-300 outline-none focus:ring-2 focus:ring-sky-200"
            placeholder="E-posta / TC / Telefon / Ad Soyad"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label className="text-xs text-slate-600">Parola</label>
          <input
            type="password"
            className="mt-1 w-full h-10 px-3 rounded-md border border-slate-300 outline-none focus:ring-2 focus:ring-sky-200"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            minLength={6}
            required
          />
        </div>

        {err && (
          <div className="text-sm p-2 rounded bg-rose-50 text-rose-700 border border-rose-200">
            {err}
          </div>
        )}

        <button
          disabled={busy}
          className="w-full h-10 rounded-md bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-60"
          type="submit"
        >
          Giriş Yap
        </button>
      </form>

      <ForgotPassword />
    </>
  );
}

function RegisterForm({ onDone }) {
  const { register, login } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const setField = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  async function onSubmit(e) {
    e.preventDefault();
    setErr(""); setOk(""); setBusy(true);
    try {
      const r = await register({ name: form.name, email: form.email, password: form.password, role: "user" });
      if (!r) {
        setOk("Başvurunuz alındı. Yönetici onayından sonra giriş yapabilirsiniz.");
        onDone?.();
      }
    } catch (ex) {
      setErr(ex.message || "Kayıt başarısız");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="text-xs text-slate-600">Ad Soyad (opsiyonel)</label>
          <input
            className="mt-1 w-full h-10 px-3 rounded-md border border-slate-300 outline-none focus:ring-2 focus:ring-sky-200"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-600">E-posta</label>
          <input
            type="email"
            className="mt-1 w-full h-10 px-3 rounded-md border border-slate-300 outline-none focus:ring-2 focus:ring-sky-200"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className="text-xs text-slate-600">Parola</label>
          <input
            type="password"
            className="mt-1 w-full h-10 px-3 rounded-md border border-slate-300 outline-none focus:ring-2 focus:ring-sky-200"
            value={form.password}
            onChange={(e) => setField("password", e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>
      </div>

      {err && (
        <div className="text-sm p-2 rounded bg-rose-50 text-rose-700 border border-rose-200">
          {err}
        </div>
      )}
      {ok && (
        <div className="text-sm p-2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
          {ok}
        </div>
      )}

      <button
        disabled={busy}
        className="w-full h-10 rounded-md bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-60"
        type="submit"
      >
        Kayıt Ol
      </button>
    </form>
  );
}
