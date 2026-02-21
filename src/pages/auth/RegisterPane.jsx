// src/pages/auth/RegisterPane.jsx
import React, { useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import {
  validateRegisterForm,
  normalizePhoneTR,
} from "../../utils/validateClient.js";
import { useNavigate } from "react-router-dom";

export default function RegisterPane() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    tc: "",
    password: "",
  });
  const [errors, setErrors] = useState({});
  const [serverMsg, setServerMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  // Alan referansları (hata olduğunda odak için)
  const refs = {
    name: useRef(null),
    email: useRef(null),
    phone: useRef(null),
    tc: useRef(null),
    password: useRef(null),
  };

  function set(k, v) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function focusFirstError(errs, data) {
    if (errs._) {
      if (!data.email && refs.email.current) return refs.email.current.focus();
      if (!data.phone && refs.phone.current) return refs.phone.current.focus();
      if (!data.tc && refs.tc.current) return refs.tc.current.focus();
    }
    const order = ["email", "phone", "tc", "password", "name"];
    for (const k of order) {
      if (errs[k] && refs[k]?.current) {
        refs[k].current.focus();
        break;
      }
    }
  }

  // Email kutusuna sayı yazılırsa otomatik telefon/TC alanına taşı
  function smartNormalizeFields(s) {
    let { email, phone, tc } = s;
    const raw = String(email || "");
    const digits = raw.replace(/\D+/g, "");
    if (raw && !raw.includes("@") && digits) {
      if (!tc && /^\d{11}$/.test(digits)) { // 11 hane → TC
        tc = digits.slice(0, 11);
        email = "";
      } else if (!phone && /^5\d{9}$/.test(digits)) { // 5XXXXXXXXX → Telefon
        phone = digits;
        email = "";
      }
    }
    return { ...s, email, phone, tc };
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return; // çift submit önle
    setServerMsg(null);
    setErrors({});

    const smart = smartNormalizeFields(form);
    if (smart !== form) setForm(smart);

    const check = validateRegisterForm(smart);
    if (!check.ok) {
      setErrors(check.errors);
      focusFirstError(check.errors, check.data);
      return;
    }

    try {
      setBusy(true);
      const res = await register(check.data); // { user, pending, message }
      if (res?.user) {
        navigate("/"); // ilk kullanıcı (admin) → giriş yapıldı
        return;
      }
      setServerMsg(res?.message || "Kayıt alındı. Hesap onay bekliyor.");
      setForm((s) => ({ ...s, password: "" })); // sadece parolayı temizle
      refs.password.current?.focus();
    } catch (err) {
      setServerMsg(err?.message || "Kayıt başarısız.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3">
      {serverMsg && (
        <div className="p-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200">
          {serverMsg}
        </div>
      )}

      {/* Ad Soyad (opsiyonel) */}
      <div>
        <input
          ref={refs.name}
          className="w-full h-10 rounded-lg border px-3 text-sm"
          placeholder="Ad Soyad (opsiyonel)"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          autoComplete="name"
        />
      </div>

      {/* E-posta (opsiyonel) */}
      <div>
        <input
          ref={refs.email}
          className={`w-full h-10 rounded-lg border px-3 text-sm ${errors.email ? "border-rose-400" : ""}`}
          placeholder="E-posta (opsiyonel)"
          type="text"             // ← email yerine text
          inputMode="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          onBlur={() => setForm((s) => smartNormalizeFields(s))}
          autoComplete="email"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "err-email" : undefined}
        />
        {errors.email && (
          <p id="err-email" className="mt-1 text-[12px] text-rose-600">{errors.email}</p>
        )}
      </div>

      {/* Telefon (TR) */}
      <div>
        <input
          ref={refs.phone}
          className={`w-full h-10 rounded-lg border px-3 text-sm ${errors.phone ? "border-rose-400" : ""}`}
          placeholder="Telefon (5XXXXXXXXX)"
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          onBlur={() => set("phone", normalizePhoneTR(form.phone))}
          autoComplete="tel-national"
          aria-invalid={!!errors.phone}
          aria-describedby={errors.phone ? "err-phone" : undefined}
        />
        {errors.phone && (
          <p id="err-phone" className="mt-1 text-[12px] text-rose-600">{errors.phone}</p>
        )}
      </div>

      {/* T.C. Kimlik */}
      <div>
        <input
          ref={refs.tc}
          className={`w-full h-10 rounded-lg border px-3 text-sm ${errors.tc ? "border-rose-400" : ""}`}
          placeholder="T.C. Kimlik (11 hane)"
          inputMode="numeric"
          pattern="[0-9]*"
          value={form.tc}
          maxLength={11}
          onChange={(e) => set("tc", e.target.value)}
          autoComplete="off"
          aria-invalid={!!errors.tc}
          aria-describedby={errors.tc ? "err-tc" : undefined}
        />
        {errors.tc && (
          <p id="err-tc" className="mt-1 text-[12px] text-rose-600">{errors.tc}</p>
        )}
      </div>

      {/* Parola */}
      <div>
        <div className="relative">
          <input
            ref={refs.password}
            className={`w-full h-10 rounded-lg border px-3 text-sm pr-20 ${errors.password ? "border-rose-400" : ""}`}
            placeholder="Parola (min 6 karakter)"
            type={showPass ? "text" : "password"}
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            onKeyUp={(e) => setCapsOn(e.getModifierState && e.getModifierState("CapsLock"))}
            onKeyDown={(e) => setCapsOn(e.getModifierState && e.getModifierState("CapsLock"))}
            onBlur={() => setCapsOn(false)}
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={
              errors.password ? "err-pass" : capsOn ? "caps-tip" : undefined
            }
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded border bg-white"
            onClick={() => setShowPass((s) => !s)}
            tabIndex={-1}
          >
            {showPass ? "Gizle" : "Göster"}
          </button>
        </div>
        {capsOn && (
          <p id="caps-tip" className="mt-1 text-[12px] text-amber-700">
            Caps Lock açık olabilir.
          </p>
        )}
        {errors.password && (
          <p id="err-pass" className="mt-1 text-[12px] text-rose-600">
            {errors.password}
          </p>
        )}
      </div>

      {/* Genel hata (kimlik zorunluluğu) */}
      {errors._ && <p className="text-[12px] text-rose-600">{errors._}</p>}

      <button
        className="w-full h-10 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60"
        disabled={busy}
      >
        {busy ? "Gönderiliyor..." : "Kayıt Ol"}
      </button>

      <p className="text-center text-[11px] text-slate-500">
        İlk kayıt otomatik <b>admin</b> olur. Diğer kayıtlar <b>onay bekler</b>.
      </p>
    </form>
  );
}
