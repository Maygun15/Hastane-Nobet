// src/ui/AuthCard.jsx
import React, { useEffect, useState } from "react";
import { apiRegister, apiLogin, setToken } from "../lib/api.js";

const DEFAULT_SERVICES = [
  { id: "servis_a", name: "A Servisi" },
  { id: "servis_b", name: "B Servisi" },
  { id: "servis_c", name: "C Servisi" },
];

export default function AuthCard() {
  console.log("[AuthCard/ui] v2 loaded");

  const [tab, setTab] = useState("register"); // 'login' | 'register'
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // LOGIN
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // REGISTER
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tc, setTc] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [rPassword, setRPassword] = useState("");

  const [services, setServices] = useState(DEFAULT_SERVICES);

  // (opsiyonel) servisi backend'den doldurmak istersen:
  useEffect(() => {
    // örnek: /api/services varsa buradan çekebilirsin
    // fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:3000'}/services`)
    //   .then(r => r.ok ? r.json() : Promise.reject())
    //   .then(list => setServices(Array.isArray(list) ? list : DEFAULT_SERVICES))
    //   .catch(() => setServices(DEFAULT_SERVICES));
    setServices(DEFAULT_SERVICES);
  }, []);

  function normalizePhone(v) {
    return String(v || "").replace(/[^\d+]/g, "");
  }

  async function handleLogin(e) {
    e.preventDefault();
    setMsg(""); setLoading(true);
    try {
      const data = await apiLogin({ identifier, password });
      if (data?.token) {
        setToken(data.token);
        setMsg("Giriş başarılı. Yönlendiriliyor…");
        window.location.reload();
      } else {
        setMsg(data?.message || "Giriş yapıldı.");
      }
    } catch (err) {
      setMsg(err.message || "Giriş başarısız.");
    } finally { setLoading(false); }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setMsg(""); setLoading(true);
    try {
      const payload = {
        name: name?.trim() || undefined,
        email: email?.trim() || undefined,
        phone: phone ? normalizePhone(phone) : undefined,
        tc: tc?.trim() || undefined,
        password: rPassword,
        // backend'de serviceIds bekliyoruz:
        serviceIds: serviceId ? [serviceId] : [],
      };
      const data = await apiRegister(payload);
      if (data?.token) {
        setToken(data.token);
        setMsg("Kayıt başarılı. Yönlendiriliyor…");
        window.location.reload();
      } else {
        setMsg(data?.message || "Kayıt alındı. Onay bekliyor.");
        setTab("login");
      }
    } catch (err) {
      setMsg(err.message || "Kayıt başarısız.");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-[420px] bg-white rounded-xl shadow p-6">
        <div className="text-center text-xs text-slate-500 mb-2">Hastane Nöbet Sistemi</div>
        <h2 className="text-center font-semibold mb-1">
          {tab === "login" ? "Giriş Yap" : "Hesap oluştur"}
        </h2>
        <div className="text-center text-[11px] text-slate-500 mb-3">v2 (identifier + telefon + TCKN + servis)</div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab("login")}
            className={`flex-1 py-2 rounded-md text-sm font-medium ${tab === "login" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            Giriş
          </button>
          <button
            onClick={() => setTab("register")}
            className={`flex-1 py-2 rounded-md text-sm font-medium ${tab === "register" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            Kayıt Ol
          </button>
        </div>

        {tab === "login" ? (
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="E-posta / Telefon / T.C. Kimlik"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
            <input
              type="password"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="Parola"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white rounded-md py-2 font-medium hover:bg-blue-700">
              {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-3">
            <input
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="Ad Soyad (opsiyonel)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="E-posta (opsiyonel)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="Telefon (opsiyonel)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <input
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="T.C. Kimlik (opsiyonel)"
              value={tc}
              onChange={(e) => setTc(e.target.value)}
            />

            <select
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              <option value="">Lütfen bir servis seçin</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <input
              type="password"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="Parola"
              value={rPassword}
              onChange={(e) => setRPassword(e.target.value)}
              required
            />

            <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white rounded-md py-2 font-medium hover:bg-blue-700">
              {loading ? "Kaydediliyor…" : "Kayıt Ol"}
            </button>
          </form>
        )}

        {msg && <p className="text-center text-sm mt-4 text-slate-600 whitespace-pre-line">{msg}</p>}

        <p className="mt-6 text-center text-[11px] text-slate-500">
          Kayıtlar <b>standart</b> kullanıcıdır. Admin/yetki yönetici tarafından verilir.
        </p>
      </div>
    </div>
  );
}
