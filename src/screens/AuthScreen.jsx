// src/screens/AuthScreen.jsx
import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

/**
 * Basit kimlik ekranı:
 * - Giriş: identifier (e-posta/TC/telefon/ad-soyad) + parola
 * - Kayıt: kayıtlar standart kullanıcıdır; admin yetkisi yönetici tarafından verilir;
 *          diğerleri pending → admin onayı bekler
 */
export default function AuthScreen() {
  const [tab, setTab] = useState("login"); // "login" | "register"

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6">
        <div className="flex gap-2 mb-4">
          <button
            className={`flex-1 py-2 rounded-lg ${tab === "login" ? "bg-slate-900 text-white" : "bg-slate-100"}`}
            onClick={() => setTab("login")}
          >
            Giriş
          </button>
          <button
            className={`flex-1 py-2 rounded-lg ${tab === "register" ? "bg-slate-900 text-white" : "bg-slate-100"}`}
            onClick={() => setTab("register")}
          >
            Kayıt Ol
          </button>
        </div>

        {tab === "login" ? <LoginForm /> : <RegisterForm onSwitch={() => setTab("login")} />}
      </div>
    </div>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    try {
      await login({ identifier, password });
      // başarılıysa App.jsx otomatik ana uygulamayı gösterecek
    } catch (ex) {
      setErr(ex.message || "Giriş başarısız");
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <input
        className="border rounded-lg px-3 py-2"
        placeholder="E-posta / TC / Telefon / Ad Soyad"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        autoFocus
      />
      <input
        className="border rounded-lg px-3 py-2"
        type="password"
        placeholder="Parola"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {err && <div className="text-red-600 text-sm">{err}</div>}
      <button className="bg-slate-900 text-white rounded-lg py-2">Giriş Yap</button>
    </form>
  );
}

function RegisterForm({ onSwitch }) {
  const { register, login } = useAuth();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    tc: "",
    password: "",
  });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  function setField(k, v) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    try {
      // userAuth: ilk kullanıcıyı ADMIN + active yapar
      const u = await register(form);

      if (u.status === "active") {
        // İlk kullanıcı: otomatik giriş
        await login({
          identifier: u.email || u.tc || u.phone || u.name,
          password: form.password,
        });
      } else {
        // Diğerleri: pending → admin onayı lazım
        setOk("Başvurunuz alındı. Yönetici onayından sonra giriş yapabilirsiniz.");
        onSwitch?.(); // login sekmesine döndür
      }
    } catch (ex) {
      setErr(ex.message || "Kayıt başarısız");
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <input
        className="border rounded-lg px-3 py-2"
        placeholder="Ad Soyad"
        value={form.name}
        onChange={(e) => setField("name", e.target.value)}
      />
      <input
        className="border rounded-lg px-3 py-2"
        placeholder="E-posta"
        value={form.email}
        onChange={(e) => setField("email", e.target.value)}
      />
      <input
        className="border rounded-lg px-3 py-2"
        placeholder="Telefon"
        value={form.phone}
        onChange={(e) => setField("phone", e.target.value)}
      />
      <input
        className="border rounded-lg px-3 py-2"
        placeholder="TC"
        value={form.tc}
        onChange={(e) => setField("tc", e.target.value)}
      />
      <input
        className="border rounded-lg px-3 py-2"
        type="password"
        placeholder="Parola"
        value={form.password}
        onChange={(e) => setField("password", e.target.value)}
      />
      {err && <div className="text-red-600 text-sm">{err}</div>}
      {ok && <div className="text-green-600 text-sm">{ok}</div>}
      <button className="bg-slate-900 text-white rounded-lg py-2">Kayıt Ol</button>
    </form>
  );
}
