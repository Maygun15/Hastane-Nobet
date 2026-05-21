// src/ui/AuthCard.jsx
import React, { useEffect, useState } from "react";
import { apiRegister, apiLogin, setToken } from "../lib/api.js";

const DEFAULT_SERVICES = [
  { id: "servis_a", name: "A Servisi" },
  { id: "servis_b", name: "B Servisi" },
  { id: "servis_c", name: "C Servisi" },
];

// ── Ortak input sınıfı ──────────────────────────────────────────────
const inputCls =
  "w-full h-10 rounded-control border border-slate-200 bg-white px-3 text-sm text-ink placeholder:text-ink-faint outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/10";

// ── Ortak label ─────────────────────────────────────────────────────
function Label({ children }) {
  return (
    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">
      {children}
    </label>
  );
}

// ── Sol marka paneli ────────────────────────────────────────────────
function BrandPanel() {
  return (
    <div className="relative hidden md:flex flex-col justify-between bg-brand-900 px-10 py-12 overflow-hidden">
      {/* Arka plan desen */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      {/* Sağ üst dekoratif daire */}
      <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-brand-600/20 blur-2xl" />
      {/* Sol alt dekoratif daire */}
      <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-accent/10 blur-3xl" />

      {/* Logo */}
      <div className="relative flex items-center gap-3">
        <div className="w-10 h-10 rounded-control bg-white/10 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 20 20" fill="none" className="w-6 h-6">
            <rect x="3" y="3" width="14" height="14" rx="2" fill="white" fillOpacity="0.15" stroke="white" strokeWidth="1.25"/>
            <path d="M10 6.5v7M6.5 10h7" stroke="white" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <div className="text-white font-bold text-base leading-tight tracking-tight">
            Nöbet Yönetim
          </div>
          <div className="text-white/40 text-[11px] font-mono">Hastane Çizelge Sistemi</div>
        </div>
      </div>

      {/* Ana metin */}
      <div className="relative">
        <h1 className="text-white text-3xl font-bold leading-tight tracking-tight mb-4">
          Doğru personel,<br />
          <span className="text-accent">doğru nöbet.</span>
        </h1>
        <p className="text-white/50 text-sm leading-relaxed max-w-xs">
          Hastane nöbet çizelgelerini planlayın, personel taleplerini yönetin ve
          adil dağılımı otomatik olarak sağlayın.
        </p>
      </div>

      {/* Alt özellik listesi */}
      <div className="relative space-y-3">
        {[
          "Akıllı çizelge oluşturma",
          "İzin ve takas yönetimi",
          "AI destekli planlama",
        ].map((item) => (
          <div key={item} className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                <path d="M2 6l3 3 5-5" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-white/60 text-xs">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Ana bileşen ─────────────────────────────────────────────────────
export default function AuthCard() {
  const [tab, setTab] = useState("login");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: "", ok: false });

  // Login
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // Register
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tc, setTc] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [rPassword, setRPassword] = useState("");
  const [services, setServices] = useState(DEFAULT_SERVICES);

  useEffect(() => {
    setServices(DEFAULT_SERVICES);
  }, []);

  function normalizePhone(v) {
    return String(v || "").replace(/[^\d+]/g, "");
  }

  async function handleLogin(e) {
    e.preventDefault();
    setMsg({ text: "", ok: false });
    setLoading(true);
    try {
      const data = await apiLogin({ identifier, password });
      if (data?.token) {
        setToken(data.token);
        setMsg({ text: "Giriş başarılı, yönlendiriliyor…", ok: true });
        window.location.reload();
      } else {
        setMsg({ text: data?.message || "Giriş yapıldı.", ok: true });
      }
    } catch (err) {
      setMsg({ text: err.message || "Giriş başarısız.", ok: false });
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setMsg({ text: "", ok: false });
    setLoading(true);
    try {
      const payload = {
        name: name?.trim() || undefined,
        email: email?.trim() || undefined,
        phone: phone ? normalizePhone(phone) : undefined,
        tc: tc?.trim() || undefined,
        password: rPassword,
        serviceIds: serviceId ? [serviceId] : [],
      };
      const data = await apiRegister(payload);
      if (data?.token) {
        setToken(data.token);
        setMsg({ text: "Kayıt başarılı, yönlendiriliyor…", ok: true });
        window.location.reload();
      } else {
        setMsg({ text: data?.message || "Kayıt alındı. Yönetici onayı bekleniyor.", ok: true });
        setTab("login");
      }
    } catch (err) {
      setMsg({ text: err.message || "Kayıt başarısız.", ok: false });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4">
      <div className="w-full max-w-3xl bg-white rounded-card shadow-panel overflow-hidden grid md:grid-cols-[1fr_1.1fr]">

        {/* Sol — Marka Paneli */}
        <BrandPanel />

        {/* Sağ — Form Paneli */}
        <div className="px-8 py-10 flex flex-col justify-center">

          {/* Mobilde logo */}
          <div className="flex md:hidden items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-control bg-brand-900 flex items-center justify-center">
              <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
                <rect x="3" y="3" width="14" height="14" rx="2" stroke="white" strokeWidth="1.25"/>
                <path d="M10 6.5v7M6.5 10h7" stroke="white" strokeWidth="1.75" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-ink font-bold text-sm">Nöbet Yönetim Sistemi</span>
          </div>

          {/* Başlık */}
          <div className="mb-7">
            <h2 className="text-2xl font-bold text-ink tracking-tight leading-none mb-1.5">
              {tab === "login" ? "Hoş geldiniz" : "Hesap oluştur"}
            </h2>
            <p className="text-sm text-ink-muted">
              {tab === "login"
                ? "Devam etmek için giriş yapın."
                : "Bilgilerinizi doldurun, yönetici onaylayacaktır."}
            </p>
          </div>

          {/* Tab seçici */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-control mb-6">
            {[
              { key: "login", label: "Giriş Yap" },
              { key: "register", label: "Kayıt Ol" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setTab(key); setMsg({ text: "", ok: false }); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-chip transition-all ${
                  tab === key
                    ? "bg-white text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Giriş formu */}
          {tab === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label>E-posta / Telefon / T.C. Kimlik</Label>
                <input
                  className={inputCls}
                  placeholder="ornek@hastane.com"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
              <div>
                <Label>Parola</Label>
                <input
                  type="password"
                  className={inputCls}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full h-10 bg-brand-900 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-semibold rounded-control transition-colors mt-2"
              >
                {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
              </button>
            </form>
          ) : (
            /* Kayıt formu */
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Ad Soyad</Label>
                  <input className={inputCls} placeholder="Ahmet Yılmaz" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label>E-posta</Label>
                  <input className={inputCls} placeholder="ornek@hastane.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Telefon</Label>
                  <input className={inputCls} placeholder="05xx xxx xx xx" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <Label>T.C. Kimlik</Label>
                  <input className={inputCls} placeholder="11 haneli" value={tc} onChange={(e) => setTc(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Servis</Label>
                <select
                  className={inputCls}
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  <option value="">Servis seçin</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Parola</Label>
                <input
                  type="password"
                  className={inputCls}
                  placeholder="••••••••"
                  value={rPassword}
                  onChange={(e) => setRPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full h-10 bg-brand-900 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-semibold rounded-control transition-colors mt-1"
              >
                {loading ? "Kaydediliyor…" : "Kayıt Ol"}
              </button>
            </form>
          )}

          {/* Mesaj */}
          {msg.text && (
            <div className={`mt-4 px-3 py-2.5 rounded-control text-sm ${
              msg.ok
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
            }`}>
              {msg.text}
            </div>
          )}

          {/* Alt not */}
          <p className="mt-6 text-center text-[11px] text-ink-faint leading-relaxed">
            Kayıtlar standart kullanıcı olarak açılır.
            <br />Yönetici yetkilendirmesi ayrıca yapılır.
          </p>
        </div>
      </div>
    </div>
  );
}
