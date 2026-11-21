// İP-1 — kurum kuralları: sunucu yetkili kaynak; kayıt/yayın sürüm çakışması; tarayıcıdan geçiş.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("../api/apiAdapter.js", () => ({
  getEffectiveRules: vi.fn(),
  saveRulePolicy: vi.fn(),
  migrateRulePolicy: vi.fn(),
  getMonthlySchedule: vi.fn(),
  getScheduleRisks: vi.fn(),
  ackScheduleRisks: vi.fn(),
  setSchedulePublication: vi.fn(),
  getSlotCandidates: vi.fn(),
  assignSchedule: vi.fn(),
  revalidateMonthlySchedule: vi.fn(),
  getScheduleChanges: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("../lib/api.js", () => ({ http: { get: vi.fn().mockResolvedValue({ items: [{ _id: "svc-a", name: "Acil Servis" }] }) } }));
const authState = { user: { role: "admin", name: "Yönetici", serviceIds: [] } };
vi.mock("../auth/AuthContext.jsx", () => ({ useAuth: () => authState }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  getEffectiveRules, saveRulePolicy, migrateRulePolicy, getMonthlySchedule, getScheduleRisks,
  setSchedulePublication, revalidateMonthlySchedule,
} from "../api/apiAdapter.js";
import { toast } from "sonner";
import InstitutionRulesPanel, { stableHash } from "../components/InstitutionRulesPanel.jsx";
import SchedulePublishBar, { RuleVersionLine } from "../components/SchedulePublishBar.jsx";

const CATALOG = [
  { key: "ONE_SHIFT_PER_DAY", label: "Günde en fazla bir vardiya", type: "boolean", unit: null, required: true },
  { key: "MIN_REST_HOURS", label: "İki vardiya arası en az dinlenme", type: "number", unit: "saat", min: 0, max: 48, required: true },
];
const effective = (over = {}) => ({
  ok: true, configured: true, complete: true, missingRequired: [], version: "kv-abc123def456",
  values: { ONE_SHIFT_PER_DAY: true, MIN_REST_HOURS: 11 }, sources: { MIN_REST_HOURS: "kurum" },
  origin: { ONE_SHIFT_PER_DAY: "genel", MIN_REST_HOURS: "genel" },
  layers: [{ level: "genel", revision: 2, updatedByName: "Sorumlu", values: { ONE_SHIFT_PER_DAY: true, MIN_REST_HOURS: 11 }, sources: { MIN_REST_HOURS: "kurum" } }],
  catalog: CATALOG, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authState.user = { role: "admin", name: "Yönetici", serviceIds: [] };
});

describe("InstitutionRulesPanel", () => {
  it("değerleri sunucudan okur; sürüm ve değiştiren görünür", async () => {
    getEffectiveRules.mockResolvedValue(effective());
    render(<InstitutionRulesPanel />);
    expect(await screen.findByTestId("rules-version")).toHaveTextContent("abc123");
    expect(screen.getByTestId("rules-version")).toHaveTextContent("Sorumlu");
    expect(screen.getByLabelText("İki vardiya arası en az dinlenme")).toHaveValue(11);
  });

  it("kayıt hatasında düzenlenen değer korunur, 'Tekrar dene' ile kaydedilir; başarı mesajı sunucu onayından sonra", async () => {
    getEffectiveRules.mockResolvedValue(effective());
    saveRulePolicy
      .mockRejectedValueOnce(Object.assign(new Error("ağ"), { status: 503, body: { message: "Sunucuya ulaşılamadı." } }))
      .mockResolvedValueOnce(effective({ version: "kv-yeni00000000", values: { ONE_SHIFT_PER_DAY: true, MIN_REST_HOURS: 12 },
        layers: [{ level: "genel", revision: 3, values: { ONE_SHIFT_PER_DAY: true, MIN_REST_HOURS: 12 }, sources: {} }] }));
    render(<InstitutionRulesPanel />);
    const input = await screen.findByLabelText("İki vardiya arası en az dinlenme");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /Genel kurallarını kaydet/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sunucuya ulaşılamadı. Düzenlediğiniz değerler korunuyor.");
    expect(screen.getByLabelText("İki vardiya arası en az dinlenme")).toHaveValue(12);
    expect(toast.success).not.toHaveBeenCalled();
    expect(saveRulePolicy.mock.calls[0][0]).toMatchObject({ values: { MIN_REST_HOURS: 12 }, expectedRevision: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Kurum kuralları kaydedildi", expect.anything()));
    expect(saveRulePolicy).toHaveBeenCalledTimes(2);
  });

  it("başka biri değiştirdiyse (409) güncel değerleri yükleme seçeneği sunulur", async () => {
    getEffectiveRules.mockResolvedValue(effective());
    saveRulePolicy.mockRejectedValue(Object.assign(new Error("çakışma"), { status: 409, body: { code: "RULES_REVISION_CONFLICT", message: "Bu kurallar siz düzenlerken değişti." } }));
    render(<InstitutionRulesPanel />);
    fireEvent.change(await screen.findByLabelText("İki vardiya arası en az dinlenme"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /kaydet/ }));
    expect(await screen.findByRole("button", { name: "Sunucudaki güncel değerleri yükle" })).toBeInTheDocument();
  });

  it("sunucuda kural yokken tarayıcıdaki eski ayarı önizler ve aynı anahtarla aktarır", async () => {
    localStorage.setItem("dutyRulesV2", JSON.stringify([
      { id: "MIN_REST_11H", enabled: true, value: 11 },
      { id: "ONE_SHIFT_PER_DAY", enabled: true },
    ]));
    getEffectiveRules.mockResolvedValue(effective({ configured: false, complete: false, version: null, values: {}, origin: {}, layers: [], missingRequired: ["ONE_SHIFT_PER_DAY", "MIN_REST_HOURS"] }));
    migrateRulePolicy.mockResolvedValue(effective());
    render(<InstitutionRulesPanel />);
    const box = await screen.findByTestId("rules-migration");
    expect(box).toHaveTextContent("İki vardiya arası en az dinlenme");
    expect(box).toHaveTextContent("11 saat");
    fireEvent.click(screen.getByRole("button", { name: "Seçilenleri sunucuya aktar" }));
    await waitFor(() => expect(migrateRulePolicy).toHaveBeenCalledTimes(1));
    const arg = migrateRulePolicy.mock.calls[0][0];
    expect(arg.values).toEqual({ ONE_SHIFT_PER_DAY: true, MIN_REST_HOURS: 11 });
    expect(arg.migrationKey).toBe(`tarayici-${stableHash(JSON.stringify({ scope: "genel", values: arg.values }))}`);
  });

  it("sunucuda kural varken tarayıcıdaki farklı eski değer uyuşmazlık olarak gösterilir", async () => {
    localStorage.setItem("dutyRulesV2", JSON.stringify([{ id: "MIN_REST_11H", enabled: true, value: 8 }]));
    getEffectiveRules.mockResolvedValue(effective());
    render(<InstitutionRulesPanel />);
    const box = await screen.findByTestId("rules-mismatch");
    expect(box).toHaveTextContent("tarayıcı 8 saat · sunucu 11 saat");
  });

  it("personel (user) değerleri yalnız görüntüler", async () => {
    authState.user = { role: "user", serviceIds: ["svc-a"] };
    getEffectiveRules.mockResolvedValue(effective());
    render(<InstitutionRulesPanel />);
    expect(await screen.findByLabelText("İki vardiya arası en az dinlenme")).toBeDisabled();
    expect(screen.getByText(/değiştirme yetkiniz yok/)).toBeInTheDocument();
  });
});

describe("Plan kural sürümü", () => {
  it("sürümü olmayan eski plan 'Kural sürümü bilinmiyor' ve doğrulama düğmesiyle gösterilir", () => {
    const onRevalidate = vi.fn();
    render(<RuleVersionLine status={{ status: "unknown", currentVersion: "kv-abc", rulesConfigured: true, rulesComplete: true }} onRevalidate={onRevalidate} />);
    expect(screen.getByTestId("rule-version-line")).toHaveTextContent("Kural sürümü bilinmiyor");
    fireEvent.click(screen.getByRole("button", { name: "Güncel kurallarla doğrula" }));
    expect(onRevalidate).toHaveBeenCalled();
  });
  it("güncel planda doğrulama düğmesi yok", () => {
    render(<RuleVersionLine status={{ status: "current", planVersion: "kv-abc", currentVersion: "kv-abc", rulesConfigured: true, rulesComplete: true }} />);
    expect(screen.getByTestId("rule-version-line")).toHaveTextContent("Güncel kurum kurallarıyla oluşturuldu");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("yayın 409 (kural değişti) → açıklama + doğrula → plan güncel sürüme geçer, düzenleyiciye olay gider", async () => {
    getMonthlySchedule.mockResolvedValue({ publication: { status: "draft" }, rules: { status: "outdated", planVersion: "kv-eski", currentVersion: "kv-yeni", rulesConfigured: true, rulesComplete: true } });
    getScheduleRisks.mockResolvedValue({ risks: [] });
    setSchedulePublication.mockRejectedValue(Object.assign(new Error("x"), { status: 409, body: { code: "RULE_VERSION_CONFLICT", message: "Plan oluşturulduktan sonra kurum kuralları değişti." } }));
    revalidateMonthlySchedule.mockResolvedValue({ ok: true, ruleContext: { version: "kv-yeni" }, rules: { status: "current", planVersion: "kv-yeni", currentVersion: "kv-yeni", rulesConfigured: true, rulesComplete: true }, ruleViolations: 0 });
    const events = [];
    const onEv = (e) => events.push(e.detail);
    window.addEventListener("rules:revalidated", onEv);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SchedulePublishBar sectionId="calisma-cizelgesi" serviceId="svc-a" role="Nurse" year={2026} month={12} />);
    fireEvent.click(await screen.findByRole("button", { name: "Yayınla" }));
    expect(await screen.findByText("Plan oluşturulduktan sonra kurum kuralları değişti.")).toBeInTheDocument();

    getMonthlySchedule.mockResolvedValue({ publication: { status: "draft" }, rules: { status: "current", planVersion: "kv-yeni", currentVersion: "kv-yeni", rulesConfigured: true, rulesComplete: true } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Güncel kurallarla doğrula" })); });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Plan güncel kurallarla doğrulandı", expect.anything()));
    expect(events[0]).toMatchObject({ serviceId: "svc-a", version: "kv-yeni" });
    expect(await screen.findByText(/Güncel kurum kurallarıyla oluşturuldu/)).toBeInTheDocument();
    window.removeEventListener("rules:revalidated", onEv);
  });
});

describe("Ay başı kontrolü satırı (İP-2)", () => {
  it("önceki ay verisi yoksa uyarı olarak gösterilir", async () => {
    const { BoundaryLine } = await import("../components/SchedulePublishBar.jsx");
    render(<BoundaryLine boundary={{ status: "missing", message: "Önceki dönem (2026-12) verisi yok" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Ay başı kontrolü: Önceki dönem (2026-12) verisi yok");
  });
  it("veri varsa bilgi olarak gösterilir", async () => {
    const { BoundaryLine } = await import("../components/SchedulePublishBar.jsx");
    render(<BoundaryLine boundary={{ status: "found", message: "Önceki dönemden 3 görev" }} />);
    expect(screen.getByTestId("boundary-line")).toHaveTextContent("Önceki dönemden 3 görev");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Yayın sürümü ve işlem geçmişi (İP-5)", () => {
  it("işlem geçmişi kim / ne zaman / hangi nöbet bilgisini gösterir", async () => {
    const { ChangeHistory } = await import("../components/SchedulePublishBar.jsx");
    render(<ChangeHistory items={[
      { _id: "1", at: "2026-11-21T21:00:00Z", byName: "Planlayıcı İki", kind: "edit", addedCount: 1, removedCount: 1,
        added: [{ date: "2026-12-05", shiftCode: "N", personName: "AYŞE" }], removed: [{ date: "2026-12-05", personName: "FATMA" }] },
      { _id: "2", at: "2026-11-21T22:00:00Z", byName: "Sorumlu", kind: "publish", publishVersion: 2, note: "Sürüm 1 → 2" },
    ]} />);
    const list = screen.getByTestId("change-history");
    expect(list).toHaveTextContent("Planlayıcı İki · Düzenleme · +1 / −1");
    expect(list).toHaveTextContent("+ 05.12 N AYŞE");
    expect(list).toHaveTextContent("− 05.12 FATMA");
    expect(list).toHaveTextContent("Yayın (sürüm 2)");
  });

  it("yayından sonra değişen planda uyarı ve 'Değişiklikleri yayınla (sürüm 3)' görünür; tekrar yayın bildirim göndermez", async () => {
    getMonthlySchedule.mockResolvedValue({ publication: { status: "published", version: 2 }, hasUnpublishedChanges: true,
      rules: { status: "current", rulesConfigured: true, rulesComplete: true } });
    getScheduleRisks.mockResolvedValue({ risks: [] });
    setSchedulePublication.mockResolvedValue({ ok: true, alreadyPublished: true, publication: { status: "published", version: 2 }, notified: 0 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SchedulePublishBar sectionId="calisma-cizelgesi" serviceId="svc-a" role="Nurse" year={2026} month={12} />);
    expect(await screen.findByTestId("unpublished-changes")).toHaveTextContent("bildirim almadı");
    fireEvent.click(screen.getByRole("button", { name: "Değişiklikleri yayınla (sürüm 3)" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Değişiklik yok — çizelge zaten bu hâliyle yayında", expect.anything()));
  });
});
