// src/pages/AuthDemo.jsx
import React, { useMemo, useState } from "react";
import { apiLogin, apiRegister, apiRequestReset, setToken } from "../lib/api.js";

/** Yardımcı normalizasyonlar */
const normTC = (v) => String(v || "").replace(/\D+/g, "").slice(0, 11);
const normPhone = (v) => {
  let d = String(v || "").replace(/\D+/g, "");
  if (d.startsWith("0090")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return "90" + d.slice(1);
  if (d.length === 10) return "90" + d;
  return d;
};
const looksLikeEmail = (s) => /@/.test(String(s || ""));

function normalizeIdentifier(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (looksLikeEmail(s)) return s.toLowerCase();
  const only = s.replace(/\D+/g, "");
  if (only.length === 11) return only;       // TC
  return normPhone(only);                     // Telefonu 90... yap
}

export default function AuthDemo() {
  const [tab, setTab] = useState("login");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // login
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // register
  const [name, setName] = useState("");
  const [tc, setTc] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [rpass, setRpass] = useState("");

  // forgot password
  const [resetEmail, setResetEmail] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const identNorm = useMemo(() => normalizeIdentifier(identifier), [identifier]);
  const tcNorm = useMemo(() => normTC(tc), [tc]);
  const phoneNorm = useMemo(() => normPhone(phone), [phone]);
  const emailNorm = useMemo(() => (email || "").trim().toLowerCase(), [email]);
  const hasContact = useMemo(() => !!(emailNorm || phoneNorm || tcNorm), [emailNorm, phoneNorm, tcNorm]);
  const validEmail = useMemo(() => !emailNorm || /.+@.+\..+/.test(emailNorm), [emailNorm]);
  const validTc = useMemo(() => !tcNorm || tcNorm.length === 11, [tcNorm]);
  const validPhone = useMemo(() => !phoneNorm || phoneNorm.length >= 12, [phoneNorm]);

  async function handleLogin(e) {
    e.preventDefault();
    if (loading) return;
    setMsg("");
    setLoading(true);
    try {
      const { token } = await apiLogin({ identifier: identNorm, password });
      if (token) setToken(token);
      setMsg("Giriş başarılı, yönlendiriliyor…");
      setTimeout(() => (window.location.href = "/"), 400);
    } catch (err) {
      setMsg(err.message || "Giriş başarısız");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    if (loading) return;
    setMsg("");
    if (!hasContact) {
      setMsg("En az biri dolu olmalı: e-posta, telefon veya TC.");
      return;
    }
    if (!validEmail) {
      setMsg("E-posta formatı hatalı.");
      return;
    }
    if (!validPhone) {
      setMsg("Telefon formatı hatalı.");
      return;
    }
    if (!validTc) {
      setMsg("TC 11 hane olmalı.");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        tc: tcNorm || undefined,
        phone: phoneNorm || undefined,
        email: emailNorm || undefined,
        password: rpass,
      };
      const { token } = await apiRegister(payload);
      if (token) setToken(token);
      setMsg("Kayıt başarılı, giriş yapıldı.");
      setTimeout(() => (window.location.href = "/"), 600);
    } catch (err) {
      setMsg(err.message || "Kayıt başarısız");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestReset(e) {
    e.preventDefault();
    if (resetLoading) return;
    setResetMsg("");
    const clean = String(resetEmail || "").trim().toLowerCase();
    if (!clean) {
      setResetMsg("E-posta zorunlu.");
      return;
    }
    setResetLoading(true);
    try {
      const r = await apiRequestReset(clean);
      if (r?.resetToken) {
        setResetMsg(`Geçici token: ${r.resetToken}`);
      } else {
        setResetMsg("Şifre sıfırlama bağlantısı gönderildi.");
      }
    } catch (err) {
      setResetMsg(err.message || "İstek başarısız");
    } finally {
      setResetLoading(false);
    }
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400";
  const btn =
    "w-full rounded-lg px-4 py-2 font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60";
  const label = "text-[12px] text-slate-600 font-medium";

  const disabledLogin = loading || !identNorm || (password || "").length < 1;
  const disabledReg =
    loading ||
    !name.trim() ||
    !hasContact ||
    !validEmail ||
    !validTc ||
    !validPhone ||
    (rpass || "").length < 6;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-[420px] bg-white shadow-xl rounded-2xl p-6">
        <div className="text-center mb-4">
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100">
            Hastane Nöbet Sistemi
          </span>
          <h1 className="text-xl font-semibold mt-2">
            {tab === "login" ? "Hoş geldiniz" : "Hesap oluştur"}
          </h1>
          <p className="text-slate-500 text-sm">
            {tab === "login"
              ? "Devam etmek için kimlik ve parolanızı girin."
              : "Kısa bir kayıtla hemen başlayın."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            className={`py-2 rounded-lg text-sm font-medium border ${
              tab === "login"
                ? "bg-sky-600 text-white border-sky-600"
                : "bg-white text-slate-700 border-slate-200"
            }`}
            onClick={() => setTab("login")}
          >
            Giriş
          </button>
          <button
            className={`py-2 rounded-lg text-sm font-medium border ${
              tab === "register"
                ? "bg-sky-600 text-white border-sky-600"
                : "bg-white text-slate-700 border-slate-200"
            }`}
            onClick={() => setTab("register")}
          >
            Kayıt Ol
          </button>
        </div>

        {tab === "login" ? (
          <form className="space-y-3" onSubmit={handleLogin}>
            <div className="space-y-1">
              <div className={label}>Kimlik</div>
              <input
                className={input}
                placeholder="TC / Telefon / E-posta"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div className="space-y-1">
              <div className={label}>Parola</div>
              <input
                className={input}
                type="password"
                placeholder="Parola"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <button className={btn} disabled={disabledLogin}>
              {loading ? "Gönderiliyor…" : "Giriş Yap"}
            </button>

            <div className="border rounded-xl p-3 mt-2">
              <div className="text-sm font-semibold">Parolamı unuttum</div>
              <div className="mt-2 flex gap-2">
                <input
                  className={input + " flex-1"}
                  placeholder="e-posta@ornek.com"
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleRequestReset}
                  disabled={resetLoading}
                  className="px-3 rounded-lg bg-sky-600 text-white text-sm hover:bg-sky-700 disabled:opacity-60"
                >
                  {resetLoading ? "..." : "Gönder"}
                </button>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                E-postadaki link seni <code>/reset/&lt;token&gt;</code> sayfasına götürecek.
              </div>
              {!!resetMsg && (
                <div className="mt-2 text-xs text-slate-600">{resetMsg}</div>
              )}
            </div>
          </form>
        ) : (
          <form className="space-y-3" onSubmit={handleRegister}>
            <div className="space-y-1">
              <div className={label}>Ad Soyad</div>
              <input
                className={input}
                placeholder="Ad Soyad"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <div className={label}>E-posta</div>
              <input
                className={input}
                placeholder="E-posta"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className={label}>Telefon</div>
                <input
                  className={input}
                  placeholder="Telefon"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                />
              </div>
              <div className="space-y-1">
                <div className={label}>TC</div>
                <input
                  className={input}
                  placeholder="TC"
                  value={tc}
                  onChange={(e) => setTc(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="text-[11px] text-slate-500">
              En az biri dolu olmalı: e-posta, telefon veya TC.
            </div>
            <div className="space-y-1">
              <div className={label}>Parola</div>
              <input
                className={input}
                type="password"
                placeholder="Parola"
                value={rpass}
                onChange={(e) => setRpass(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <button className={btn} disabled={disabledReg}>
              {loading ? "Gönderiliyor…" : "Kayıt Ol"}
            </button>
          </form>
        )}

        {!!msg && (
          <div className="mt-4 text-center text-sm text-slate-700">{msg}</div>
        )}

        {tab === "register" && (
          <p className="mt-4 text-center text-[11px] text-slate-500">
            Kayıtlar <b>standart</b> kullanıcıdır. Admin/yetki yönetici tarafından verilir.
          </p>
        )}
      </div>
    </div>
  );
}
