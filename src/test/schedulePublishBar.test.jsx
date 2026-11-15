// Taslak / yayınlandı çubuğu + yayın öncesi risk kararları.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

vi.mock("../api/apiAdapter.js", () => ({
  getMonthlySchedule: vi.fn(),
  getScheduleRisks: vi.fn(),
  ackScheduleRisks: vi.fn(),
  setSchedulePublication: vi.fn(),
  getSlotCandidates: vi.fn(),
  assignSchedule: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  ackScheduleRisks, assignSchedule, getMonthlySchedule, getScheduleRisks, getSlotCandidates, setSchedulePublication,
} from "../api/apiAdapter.js";
import { toast } from "sonner";
import SchedulePublishBar from "../components/SchedulePublishBar.jsx";

const props = { sectionId: "calisma-cizelgesi", serviceId: "acil", role: "Nurse", year: 2026, month: 12 };
const bosSlot = {
  key: "BOS_SLOT|2026-12-07|r1", type: "BOS_SLOT", severity: "yuksek", date: "2026-12-07", rowId: "r1",
  shiftCode: "M", message: "07.12 · SERVİS SORUMLUSU (M): 2 kişi gerekli, 1 atandı", acknowledged: false,
};

describe("SchedulePublishBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    getScheduleRisks.mockResolvedValue({ risks: [], total: 0, pending: 0 });
  });

  it("çizelge yoksa hiçbir şey göstermez", async () => {
    getMonthlySchedule.mockResolvedValue(null);
    const { container } = render(<SchedulePublishBar {...props} />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("risk yokken taslağı Yayınla ile yayınlar (çift tıklamada tek istek)", async () => {
    getMonthlySchedule.mockResolvedValue({ publication: { status: "draft" } });
    setSchedulePublication.mockResolvedValue({ ok: true, publication: { status: "published" }, notified: 42 });

    render(<SchedulePublishBar {...props} />);
    const btn = await screen.findByRole("button", { name: "Yayınla" });
    expect(screen.getByTestId("schedule-publish-bar").textContent).toContain("Taslak");

    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });

    expect(setSchedulePublication).toHaveBeenCalledTimes(1);
    expect(setSchedulePublication).toHaveBeenCalledWith(props, true);
    expect(toast.success).toHaveBeenCalledWith("Çizelge yayınlandı", { description: "42 personele bildirim gönderildi." });
    expect(await screen.findByRole("button", { name: "Taslağa al" })).toBeTruthy();
  });

  it("karar bekleyen risk varken Yayınla kilitli; Bu şekilde devam kilidi açar", async () => {
    getMonthlySchedule.mockResolvedValue({ publication: { status: "draft" } });
    getScheduleRisks
      .mockResolvedValueOnce({ risks: [bosSlot], total: 1, pending: 1 })
      .mockResolvedValue({ risks: [{ ...bosSlot, acknowledged: true, ack: { byName: "Sorumlu" } }], total: 1, pending: 0 });
    ackScheduleRisks.mockResolvedValue({ ok: true });

    render(<SchedulePublishBar {...props} />);
    const publish = await screen.findByRole("button", { name: /Yayınla \(1 risk karar bekliyor\)/ });
    expect(publish.disabled).toBe(true);
    expect(screen.getByTestId("risk-panel").textContent).toContain("Yönetici kararı bekleyen 1 risk");

    const row = screen.getByTestId("risk-row");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Bu şekilde devam" })); });

    expect(ackScheduleRisks).toHaveBeenCalledWith(props, ["BOS_SLOT|2026-12-07|r1"]);
    const enabled = await screen.findByRole("button", { name: "Yayınla" });
    expect(enabled.disabled).toBe(false);
    expect(screen.getByTestId("risk-panel").textContent).toContain("Bu şekilde devam — Sorumlu");
  });

  it("boş görevde Yerine ata uygun adayları listeler ve seçileni atar", async () => {
    getMonthlySchedule.mockResolvedValue({ publication: { status: "draft" } });
    getScheduleRisks.mockResolvedValue({ risks: [bosSlot], total: 1, pending: 1 });
    getSlotCandidates.mockResolvedValue({
      slot: { date: "2026-12-07", rowId: "r1", shiftCode: "M", area: "SERVİS SORUMLUSU" },
      candidates: [
        { personId: "p1", personName: "Ayşe", eligible: true, reasons: [], monthHours: 120, monthNights: 3 },
        { personId: "p2", personName: "Fatma", eligible: false, reasons: ["O gün başka nöbeti var"], monthHours: 160, monthNights: 5 },
      ],
    });
    assignSchedule.mockResolvedValue({ ok: true });

    render(<SchedulePublishBar {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Yerine ata" }));
    const list = await screen.findByTestId("slot-candidates");
    expect(getSlotCandidates).toHaveBeenCalledWith(props, { date: "2026-12-07", rowId: "r1" });
    expect(list.textContent).toContain("Ayşe");
    expect(list.textContent).not.toContain("Fatma"); // uygun olmayan varsayılan gizli

    await act(async () => { fireEvent.click(within(list).getByRole("button", { name: "Ata" })); });
    expect(assignSchedule).toHaveBeenCalledWith(expect.objectContaining({
      ...props, date: "2026-12-07", rowId: "r1", shiftId: "r1", shiftCode: "M", personId: "p1", personName: "Ayşe",
      roleLabel: "SERVİS SORUMLUSU",
    }));
    expect(assignSchedule.mock.calls[0][0].force).toBeUndefined();
  });

  it("kural riskinde Yerine ata, hızlı değiştirme penceresini o kişiyle açar", async () => {
    getMonthlySchedule.mockResolvedValue({ publication: { status: "draft" } });
    getScheduleRisks.mockResolvedValue({ risks: [{
      key: "KURAL|DINLENME_12S|2026-12-02|p2", type: "KURAL", severity: "yuksek", date: "2026-12-02",
      rowId: "rM", shiftCode: "M", personId: "p2", personName: "Fatma", message: "02.12 · Fatma: 12 saatten az dinlenme", acknowledged: false,
    }], total: 1, pending: 1 });
    const seen = [];
    const handler = (e) => seen.push(e.detail);
    window.addEventListener("quick-replace:open", handler);

    render(<SchedulePublishBar {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Yerine ata" }));
    window.removeEventListener("quick-replace:open", handler);

    expect(seen).toEqual([expect.objectContaining({ date: "2026-12-02", rowId: "rM", personName: "Fatma", autoSearch: true })]);
  });

  it("onay verilmezse yayınlamaz", async () => {
    window.confirm.mockReturnValue(false);
    getMonthlySchedule.mockResolvedValue({ publication: { status: "draft" } });
    render(<SchedulePublishBar {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Yayınla" }));
    await act(async () => {});
    expect(setSchedulePublication).not.toHaveBeenCalled();
  });

  it("eski (yayın alanı olmayan) çizelgeyi yayınlanmış gösterir", async () => {
    getMonthlySchedule.mockResolvedValue({ publication: { status: "published", legacy: true } });
    render(<SchedulePublishBar {...props} />);
    expect(await screen.findByRole("button", { name: "Taslağa al" })).toBeTruthy();
    expect(screen.getByTestId("schedule-publish-bar").textContent).toContain("Yayınlandı");
  });
});

describe("SchedulePublishBar — Yine de ata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("riskli adayı gerekçeyle atar ve doğan kural risklerini aynı kararla kapatır", async () => {
    getMonthlySchedule.mockResolvedValue({ publication: { status: "draft" } });
    const kural = {
      key: "KURAL|DINLENME_12S|2026-12-07|p3", type: "KURAL", date: "2026-12-07", personId: "p3",
      personName: "Gamze", severity: "yuksek", message: "x", acknowledged: false,
    };
    getScheduleRisks
      .mockResolvedValueOnce({ risks: [bosSlot], total: 1, pending: 1 }) // ilk yükleme
      .mockResolvedValueOnce({ risks: [kural], total: 1, pending: 1 })   // atamadan sonra
      .mockResolvedValue({ risks: [{ ...kural, acknowledged: true }], total: 1, pending: 0 });
    getSlotCandidates.mockResolvedValue({
      slot: { date: "2026-12-07", rowId: "r1", shiftCode: "M", area: "SERVİS SORUMLUSU" },
      candidates: [{ personId: "p3", personName: "Gamze", eligible: false, reasons: ["Kural ihlali doğurur"], monthHours: 168, monthNights: 2 }],
    });
    assignSchedule.mockResolvedValue({ ok: true });
    ackScheduleRisks.mockResolvedValue({ ok: true });

    render(<SchedulePublishBar {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Yerine ata" }));
    fireEvent.click(await screen.findByRole("button", { name: "Uygun olmayanları da göster" }));
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Yine de ata" })); });

    expect(assignSchedule).toHaveBeenCalledWith(expect.objectContaining({ personId: "p3", force: true }));
    expect(assignSchedule.mock.calls[0][0].overrideReason).toContain("Kural ihlali doğurur");
    expect(ackScheduleRisks).toHaveBeenCalledWith(props, ["KURAL|DINLENME_12S|2026-12-07|p3"], expect.stringContaining("Yine de ata"));
  });
});
