// src/components/AuthGate.jsx
import React, { useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { Mail, Lock, LogIn, UserPlus, Loader2, Check, X } from "lucide-react";
import { apiRequestReset, apiResetPassword } from "../lib/api.js";

export default function AuthGate({ children }) {
  const { user, loading, login, register } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 to-indigo-50">
        <div className="flex items-center gap-3 text-slate-700">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Oturum kontrol ediliyor…</span>
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen login={login} register={register} />;
  return children;
}

function AuthScreen({ login, register }) {
  const [mode, setMode] = useState("login"); // 'login' | 'register'
  const [email, setEmail] = useState("");    // başlangıçta boş (hardcode kaldırıldı)
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);

  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPass, setNewPass] = useState("");
  const [resetStep, setResetStep] = useState(1); // 1: email → token, 2: token + newPass

  // Çift çağrı kilidi
  const submittingRef = useRef(false);
  const lock = () => {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setSubmitting(true);
    return true;
  };
  const unlock = () => {
    submittingRef.current = false;
    setSubmitting(false);
  };

  async function onSubmit(e) {
    e.preventDefault();
    if (!lock()) return;
    setMsg(null);
    try {
      const cleanEmail = String(email).trim().toLowerCase();

      if (mode === "login") {
        // AuthContext login({ identifier | email, password })
        await login({ email: cleanEmail, password });
        setMsg({ type: "success", text: "✅ Giriş başarılı" });
      } else {
        // AuthContext register(payload)
        await register({ email: cleanEmail, password });
        setMsg({ type: "info", text: "✅ Kayıt başarılı, şimdi giriş yapabilirsiniz" });
        setMode("login");
      }
    } catch (err) {
      const text =
        err?.response?.data?.message ||
        err?.message ||
        "Bir hata oluştu";
      setMsg({ type: "error", text: `❌ ${text}` });
    } finally {
      unlock();
    }
  }

  // === RESET akışı ===
  async function handleRequestReset() {
    if (!lock()) return;
    setMsg(null);
    try {
      const clean = String(resetEmail).trim().toLowerCase();
      const r = await apiRequestReset(clean);
      if (r?.resetToken) setResetToken(r.resetToken); // DEV: token göster
      setResetStep(2);
    } catch (err) {
      const text = err?.response?.data?.message || err?.message || "İşlem başarısız";
      setMsg({ type: "error", text });
    } finally {
      unlock();
    }
  }

  async function handleDoReset() {
    if (!lock()) return;
    setMsg(null);
    try {
      await apiResetPassword(resetToken.trim(), newPass);
      setMsg({ type: "success", text: "✅ Şifren güncellendi, giriş yapabilirsin." });
      setShowReset(false);
      setResetEmail("");
      setResetToken("");
      setNewPass("");
      setResetStep(1);
      setMode("login");
    } catch (err) {
      const text = err?.response?.data?.message || err?.message || "İşlem başarısız";
      setMsg({ type: "error", text });
    } finally {
      unlock();
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white/90 backdrop-blur border shadow-2xl rounded-2xl p-6">
          {/* Başlık */}
          <div className="mb-5 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100 text-sm font-medium">
              Hastane Nöbet Sistemi
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-800">
              {mode === "login" ? "Hoş geldiniz" : "Hesap oluştur"}
            </h1>
            <p className="text-slate-500 text-sm">
              {mode === "login"
                ? "Devam etmek için e-posta ve şifrenizle giriş yapın."
                : "Kısa bir kayıtla hemen başlayın."}
            </p>
          </div>

          {/* Tab butonları */}
          <div className="grid grid-cols-2 gap-2 mb-5">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`h-10 rounded-xl border text-sm font-medium transition ${
                mode === "login"
                  ? "bg-sky-600 text-white border-sky-600"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-800"
              }`}
            >
              Giriş
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`h-10 rounded-xl border text-sm font-medium transition ${
                mode === "register"
                  ? "bg-sky-600 text-white border-sky-600"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-800"
              }`}
            >
              Kayıt Ol
            </button>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="text-sm text-slate-600">E-posta</span>
              <div className="mt-1 flex items-center gap-2 rounded-xl border bg-white px-3 h-11 focus-within:ring-2 focus-within:ring-sky-200">
                <Mail className="w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  className="flex-1 outline-none text-slate-800 placeholder:text-slate-400"
                  placeholder="ornek@hastane.gov.tr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </label>

            <label className="block">
              <span className="text-sm text-slate-600">Şifre</span>
              <div className="mt-1 flex items-center gap-2 rounded-xl border bg-white px-3 h-11 focus-within:ring-2 focus-within:ring-sky-200">
                <Lock className="w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  className="flex-1 outline-none text-slate-800 placeholder:text-slate-400"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            </label>

            {/* Mesaj alanı */}
            {msg && (
              <div
                className={`text-sm mt-1 ${
                  msg.type === "error"
                    ? "text-red-600"
                    : msg.type === "success"
                    ? "text-emerald-600"
                    : "text-slate-600"
                }`}
              >
                {msg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-xl border bg-sky-600 text-white font-semibold inline-flex items-center justify-center gap-2 hover:bg-sky-700 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  İşleniyor…
                </>
              ) : mode === "login" ? (
                <>
                  <LogIn className="w-4 h-4" />
                  Giriş Yap
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Kayıt Ol
                </>
              )}
            </button>

            <div className="text-right">
              <button
                type="button"
                onClick={() => setShowReset(true)}
                className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
              >
                Parolanı mı unuttun?
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* RESET MODAL */}
      {showReset && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Parola sıfırlama</h2>
              <button type="button" onClick={() => setShowReset(false)}>
                <X className="w-5 h-5 text-slate-500 hover:text-slate-700" />
              </button>
            </div>

            {resetStep === 1 ? (
              <>
                <p className="text-sm text-slate-600 mb-3">
                  E-posta adresini gir; sana geçici reset token (DEV aşamasında burada gösterilecektir) oluşturulacak.
                </p>
                <input
                  type="email"
                  className="w-full h-11 px-3 rounded-md border border-slate-300 mb-3"
                  placeholder="mail@ornek.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleRequestReset}
                  disabled={!resetEmail || submitting}
                  className="w-full h-11 rounded-md bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-60"
                >
                  {submitting ? "İşleniyor…" : "Devam"}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-2">
                  DEV kolaylığı: reset token aşağıda gösteriliyor.
                </p>
                <input
                  className="w-full h-10 mb-2 px-3 rounded border border-slate-300"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="Reset token"
                />
                <input
                  type="password"
                  className="w-full h-11 mb-3 px-3 rounded-md border border-slate-300"
                  placeholder="Yeni şifre (min 6)"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={handleDoReset}
                  disabled={!resetToken || newPass.length < 6 || submitting}
                  className="w-full h-11 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> İşleniyor…
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" /> Şifreyi Güncelle
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
