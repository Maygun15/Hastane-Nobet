// src/components/InstitutionRulesPanel.jsx
// KURUM KURALLARI — planlama motorunun kullandığı kural değerlerinin yetkili kaynağı SUNUCUDUR.
// Bu panel değerleri sunucudan okur, yetkili kullanıcı değiştirirse sunucu doğrulamasıyla kaydeder.
// Tarayıcıdaki eski ayarlar (localStorage "dutyRulesV2") yalnız tek seferlik aktarım için okunur.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getEffectiveRules, migrateRulePolicy, saveRulePolicy } from "../api/apiAdapter.js";
import { http } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { mapRulesToBackend } from "./DutyRowsEditor.utils.js";

const LEGACY_LS_KEY = "dutyRulesV2";
const DISMISS_LS_KEY = "dutyRulesV2MigrationDismissed";
const SOURCE_OPTIONS = [
  ["belirsiz", "Kaynağı belirsiz"],
  ["kurum", "Kurum kararı"],
  ["mevzuat", "Mevzuat"],
  ["tercih", "Tercih"],
];
const LEVEL_LABEL = { genel: "Genel", meslek: "Meslek", servis: "Servis", "servis+meslek": "Servis + meslek" };
const ROLE_OPTIONS = [["", "Tüm meslekler"], ["Nurse", "Hemşire"], ["Doctor", "Doktor"]];

function scopeLevel({ serviceId, role }) {
  if (serviceId && role) return "servis+meslek";
  if (serviceId) return "servis";
  if (role) return "meslek";
  return "genel";
}

// Kararlı, kısa bir özet (tekrar edilen aktarımı engellemek için migrationKey).
export function stableHash(text) {
  let h = 5381;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(7, "0");
}

export function readLegacyBrowserRules() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_LS_KEY) || "[]");
    if (!Array.isArray(raw) || !raw.length) return {};
    return mapRulesToBackend(raw) || {};
  } catch {
    return {};
  }
}

function fmtValue(def, v) {
  if (v === undefined || v === null || v === "") return "—";
  if (def?.type === "boolean") return v ? "Açık" : "Kapalı";
  if (Number(v) === 0 && def?.zeroMeans) return `0 (${def.zeroMeans})`;
  return `${v}${def?.unit ? ` ${def.unit}` : ""}`;
}

function fmtDate(v) {
  if (!v) return "";
  try { return new Date(v).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }); } catch { return ""; }
}

function canEditScope(user, scope) {
  const role = String(user?.role || "").toLowerCase();
  if (role === "admin" || role === "superadmin") return true;
  if (["staff", "authorized", "yetkili"].includes(role)) {
    if (!scope.serviceId) return false;
    return (user?.serviceIds || []).map(String).includes(String(scope.serviceId));
  }
  return false;
}

export default function InstitutionRulesPanel() {
  const { user } = useAuth();
  const [services, setServices] = useState([]);
  const [scope, setScope] = useState({ serviceId: "", role: "" });
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [form, setForm] = useState({ values: {}, sources: {} });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null); // { message, conflict?, errors? }
  const [migrating, setMigrating] = useState(false);
  const [pick, setPick] = useState({});

  const editable = canEditScope(user, scope);
  const level = scopeLevel(scope);

  useEffect(() => {
    http.get("/api/services?size=200")
      .then((d) => setServices(d?.items || d?.data || (Array.isArray(d) ? d : [])))
      .catch(() => setServices([]));
  }, []);

  const applyServerData = useCallback((data) => {
    const layer = (data?.layers || []).find((l) => l.level === scopeLevel(scope)) || null;
    setForm({ values: { ...(layer?.values || {}) }, sources: { ...pickSources(data, layer) } });
    setDirty(false);
  }, [scope]);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await getEffectiveRules({ sectionId: "calisma-cizelgesi", ...scope });
      setState({ loading: false, error: null, data });
      applyServerData(data);
    } catch (e) {
      setState({ loading: false, error: e?.message || "Kurum kuralları okunamadı.", data: null });
    }
  }, [scope, applyServerData]);

  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const catalog = data?.catalog || [];
  const layer = (data?.layers || []).find((l) => l.level === level) || null;

  // ── Tarayıcıdaki eski ayarlar: önizleme / uyuşmazlık ──
  const legacy = useMemo(() => readLegacyBrowserRules(), [data]);
  const legacyKeys = Object.keys(legacy).filter((k) => catalog.some((c) => c.key === k));
  const legacyHash = stableHash(JSON.stringify(legacyKeys.map((k) => [k, legacy[k]])));
  const dismissed = (() => { try { return localStorage.getItem(DISMISS_LS_KEY) === legacyHash; } catch { return false; } })();
  const differences = legacyKeys.filter((k) => data?.values?.[k] !== legacy[k]);
  const showMigration = !!data && level === "genel" && !data.configured && legacyKeys.length > 0;
  const showMismatch = !!data && data.configured && differences.length > 0 && !dismissed;

  useEffect(() => {
    if (showMigration) setPick(Object.fromEntries(legacyKeys.map((k) => [k, true])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMigration, legacyHash]);

  const setValue = (key, v) => { setForm((f) => ({ ...f, values: { ...f.values, [key]: v } })); setDirty(true); setSaveError(null); };
  const setSource = (key, v) => { setForm((f) => ({ ...f, sources: { ...f.sources, [key]: v } })); setDirty(true); setSaveError(null); };

  const save = async () => {
    if (!editable || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const values = {};
      for (const def of catalog) {
        const v = form.values[def.key];
        if (v === undefined || v === null || v === "") continue;
        values[def.key] = def.type === "number" ? Number(String(v).replace(",", ".")) : v;
      }
      const res = await saveRulePolicy({
        scope: { sectionId: "calisma-cizelgesi", ...scope },
        values,
        sources: form.sources,
        expectedRevision: layer?.revision || 0,
      });
      // Başarı mesajı yalnızca sunucu onayından sonra.
      setState({ loading: false, error: null, data: res });
      applyServerData(res);
      toast.success("Kurum kuralları kaydedildi", { description: `Yeni sürüm: ${String(res?.version || "").replace(/^kv-/, "").slice(0, 6)}` });
    } catch (e) {
      const body = e?.body || {};
      if (e?.status === 409) {
        setSaveError({ message: body.message || "Kurallar siz düzenlerken değişti.", conflict: true });
      } else if (e?.status === 400 && Array.isArray(body.errors)) {
        setSaveError({ message: body.message || "Değerler geçersiz.", errors: body.errors });
      } else {
        setSaveError({ message: body.message || e?.message || "Kaydedilemedi. Bağlantıyı kontrol edip tekrar deneyin." });
      }
      // Kullanıcının düzenlediği değerler korunur (form sıfırlanmaz).
    } finally {
      setSaving(false);
    }
  };

  const migrate = async () => {
    if (!editable || migrating) return;
    const values = Object.fromEntries(legacyKeys.filter((k) => pick[k]).map((k) => [k, legacy[k]]));
    if (!Object.keys(values).length) return;
    setMigrating(true);
    try {
      const key = `tarayici-${stableHash(JSON.stringify({ scope: "genel", values }))}`;
      const res = await migrateRulePolicy({ scope: { sectionId: "calisma-cizelgesi", serviceId: "", role: "" }, values, migrationKey: key });
      setState({ loading: false, error: null, data: res });
      applyServerData(res);
      toast.success(res?.alreadyApplied ? "Bu aktarım daha önce yapılmış; değişiklik olmadı." : "Tarayıcıdaki ayarlar sunucuya aktarıldı", {
        description: res?.missingRequired?.length ? "Eksik zorunlu kuralları aşağıdan tamamlayın." : undefined,
      });
    } catch (e) {
      toast.error("Aktarılamadı", { description: e?.body?.message || e?.message || "" });
      await load();
    } finally {
      setMigrating(false);
    }
  };

  const dismissMismatch = () => {
    try { localStorage.setItem(DISMISS_LS_KEY, legacyHash); } catch {}
    setState((s) => ({ ...s })); // yeniden çiz
  };

  const serviceName = (id) => {
    const s = services.find((x) => String(x._id || x.id) === String(id));
    return s?.name || id;
  };
  const visibleServices = services.filter((s) => {
    const role = String(user?.role || "").toLowerCase();
    if (role === "admin" || role === "superadmin") return true;
    return (user?.serviceIds || []).map(String).includes(String(s._id || s.id));
  });

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="institution-rules-panel" aria-labelledby="kurum-kurallari-baslik">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="kurum-kurallari-baslik" className="text-base font-semibold text-slate-900">Kurum kuralları (planlamada kullanılan değerler)</h3>
          <p className="mt-0.5 text-[13px] text-slate-600">
            Çizelge motoru bu değerleri <b>sunucudan</b> okur; bütün bilgisayarlar aynı değerleri kullanır.
            Servis için ayrı değer girilen kural o serviste genel değerin yerine geçer.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <label className="flex items-center gap-1">
            <span className="text-slate-600">Kapsam</span>
            <select
              className="rounded-lg border border-slate-300 px-2 py-1"
              value={scope.serviceId}
              onChange={(e) => setScope((s) => ({ ...s, serviceId: e.target.value }))}
              aria-label="Kural kapsamı (servis)"
            >
              <option value="">Genel (tüm servisler)</option>
              {visibleServices.map((s) => (
                <option key={String(s._id || s.id)} value={String(s._id || s.id)}>{s.name}</option>
              ))}
            </select>
          </label>
          <select
            className="rounded-lg border border-slate-300 px-2 py-1"
            value={scope.role}
            onChange={(e) => setScope((s) => ({ ...s, role: e.target.value }))}
            aria-label="Kural kapsamı (meslek)"
          >
            {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {state.loading && <div className="mt-3 text-[13px] text-slate-500" role="status">Kurum kuralları yükleniyor…</div>}
      {state.error && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800" role="alert">
          <span>{state.error}</span>
          <button type="button" className="rounded border border-rose-300 bg-white px-2 py-0.5" onClick={load}>Tekrar dene</button>
        </div>
      )}

      {data && (
        <>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-600" data-testid="rules-version">
            <span>
              Etkin sürüm: <b>{data.version ? String(data.version).replace(/^kv-/, "").slice(0, 6) : "yok"}</b>
            </span>
            {(data.layers || []).map((l) => (
              <span key={l.level}>
                {LEVEL_LABEL[l.level] || l.level}: rev. {l.revision}
                {l.updatedByName ? ` · ${l.updatedByName}` : ""}
                {l.updatedAt ? ` · ${fmtDate(l.updatedAt)}` : ""}
              </span>
            ))}
          </div>

          {!data.complete && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900" role="alert">
              {data.configured
                ? <>Zorunlu kural eksik: <b>{data.missingRequired.map((k) => catalog.find((c) => c.key === k)?.label || k).join(", ")}</b>. Bu tamamlanmadan çizelge oluşturulamaz ve yayınlanamaz.</>
                : <>Bu kapsam için sunucuda kurum kuralı yok. Çizelge oluşturmadan önce aşağıdan kaydedin{showMigration ? " ya da bu tarayıcıdaki eski ayarları aktarın" : ""}.</>}
            </div>
          )}

          {showMigration && (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-[13px]" data-testid="rules-migration">
              <div className="font-semibold text-sky-900">Bu tarayıcıda eski kural ayarları bulundu</div>
              <p className="text-sky-900">Hangilerinin genel kurum kuralı olarak sunucuya aktarılacağını seçin. Aktarım tekrarlansa da kayıt çoğalmaz.</p>
              <table className="mt-2 w-full text-left">
                <thead><tr className="text-slate-500"><th className="w-8" /><th>Kural</th><th>Tarayıcıdaki değer</th><th>Sunucuda</th></tr></thead>
                <tbody>
                  {legacyKeys.map((k) => {
                    const def = catalog.find((c) => c.key === k);
                    return (
                      <tr key={k}>
                        <td><input type="checkbox" aria-label={`${def?.label || k} aktarılsın`} checked={!!pick[k]} onChange={(e) => setPick((p) => ({ ...p, [k]: e.target.checked }))} /></td>
                        <td>{def?.label || k}</td>
                        <td>{fmtValue(def, legacy[k])}</td>
                        <td className="text-slate-500">yok</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {catalog.filter((c) => c.required && !legacyKeys.includes(c.key)).length > 0 && (
                <p className="mt-1 text-[12px] text-sky-900">
                  Tarayıcıda olmayan zorunlu kurallar aktarımdan sonra aşağıdan girilmeli:{" "}
                  {catalog.filter((c) => c.required && !legacyKeys.includes(c.key)).map((c) => c.label).join(", ")}.
                </p>
              )}
              <button
                type="button"
                disabled={!editable || migrating || !legacyKeys.some((k) => pick[k])}
                onClick={migrate}
                className="mt-2 rounded-lg bg-sky-600 px-3 py-1.5 text-white disabled:opacity-50"
              >
                {migrating ? "Aktarılıyor…" : "Seçilenleri sunucuya aktar"}
              </button>
              {!editable && <span className="ml-2 text-[12px] text-slate-600">Aktarım için yönetici yetkisi gerekir.</span>}
            </div>
          )}

          {showMismatch && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900" data-testid="rules-mismatch">
              <div className="font-semibold">Bu tarayıcıdaki eski ayarlar sunucudakinden farklı</div>
              <p>Planlama sunucudaki değerleri kullanır; tarayıcıdaki eski değerler etkisizdir.</p>
              <ul className="mt-1 list-disc pl-5">
                {differences.map((k) => {
                  const def = catalog.find((c) => c.key === k);
                  return <li key={k}>{def?.label || k}: tarayıcı {fmtValue(def, legacy[k])} · sunucu {fmtValue(def, data.values?.[k])}</li>;
                })}
              </ul>
              <button type="button" onClick={dismissMismatch} className="mt-2 rounded border border-amber-300 bg-white px-2 py-1">Anladım, bu uyarıyı gizle</button>
            </div>
          )}

          <table className="mt-3 w-full text-left text-[13px]" data-testid="rules-table">
            <thead>
              <tr className="border-b text-slate-500">
                <th className="py-1">Kural</th>
                <th>Etkin değer</th>
                <th>Geldiği katman</th>
                <th>{LEVEL_LABEL[level]} katmanında değer</th>
                <th>Kaynak</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((def) => {
                const own = form.values[def.key];
                const inputId = `rule-${def.key}`;
                return (
                  <tr key={def.key} className="border-b border-slate-100">
                    <td className="py-1.5">
                      <label htmlFor={inputId}>{def.label}</label>
                      {def.required && <span className="ml-1 text-rose-600" title="Zorunlu">*</span>}
                    </td>
                    <td>{fmtValue(def, data.values?.[def.key])}</td>
                    <td className="text-slate-500">{data.origin?.[def.key] ? LEVEL_LABEL[data.origin[def.key]] : "—"}</td>
                    <td>
                      {def.type === "boolean" ? (
                        <select
                          id={inputId}
                          disabled={!editable || saving}
                          className="rounded border border-slate-300 px-1.5 py-0.5"
                          value={own === true ? "1" : own === false ? "0" : ""}
                          onChange={(e) => setValue(def.key, e.target.value === "" ? undefined : e.target.value === "1")}
                        >
                          <option value="">{level === "genel" ? "— seçin —" : "üst katmandan"}</option>
                          <option value="1">Açık</option>
                          <option value="0">Kapalı</option>
                        </select>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <input
                            id={inputId}
                            type="number"
                            inputMode="numeric"
                            min={def.min ?? undefined}
                            max={def.max ?? undefined}
                            disabled={!editable || saving}
                            className="w-20 rounded border border-slate-300 px-1.5 py-0.5"
                            placeholder={level === "genel" ? "" : "üst katman"}
                            value={own ?? ""}
                            onChange={(e) => setValue(def.key, e.target.value === "" ? undefined : e.target.value)}
                          />
                          <span className="text-slate-500">{def.unit}</span>
                        </span>
                      )}
                      {saveError?.errors?.find((x) => x.key === def.key) && (
                        <div className="text-[12px] text-rose-700">{saveError.errors.find((x) => x.key === def.key).message}</div>
                      )}
                    </td>
                    <td>
                      <select
                        aria-label={`${def.label} kaynağı`}
                        disabled={!editable || saving || own === undefined || own === ""}
                        className="rounded border border-slate-300 px-1.5 py-0.5"
                        value={form.sources[def.key] || "belirsiz"}
                        onChange={(e) => setSource(def.key, e.target.value)}
                      >
                        {SOURCE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {saveError && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800" role="alert">
              <span>{saveError.message} Düzenlediğiniz değerler korunuyor.</span>
              {saveError.conflict ? (
                <button type="button" className="rounded border border-rose-300 bg-white px-2 py-0.5" onClick={load}>Sunucudaki güncel değerleri yükle</button>
              ) : (
                <button type="button" className="rounded border border-rose-300 bg-white px-2 py-0.5" onClick={save}>Tekrar dene</button>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!editable || saving || !dirty}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
            >
              {saving ? "Kaydediliyor…" : `${LEVEL_LABEL[level]} kurallarını kaydet`}
            </button>
            {dirty && !saving && (
              <button type="button" onClick={() => applyServerData(data)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]">Vazgeç</button>
            )}
            {!editable && (
              <span className="text-[12px] text-slate-500">
                {scope.serviceId ? `${serviceName(scope.serviceId)} kurallarını` : "Genel kurum kurallarını"} değiştirme yetkiniz yok; değerleri görüntülüyorsunuz.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function pickSources(_data, layer) {
  return layer?.sources ? { ...layer.sources } : {};
}
