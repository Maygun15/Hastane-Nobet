// Taslak / yayınlandı çubuğu: durumu gösterir, Yayınla tek istek gönderir.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("../api/apiAdapter.js", () => ({
  getMonthlySchedule: vi.fn(),
  setSchedulePublication: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { getMonthlySchedule, setSchedulePublication } from "../api/apiAdapter.js";
import { toast } from "sonner";
import SchedulePublishBar from "../components/SchedulePublishBar.jsx";

const props = { sectionId: "calisma-cizelgesi", serviceId: "acil", role: "Nurse", year: 2026, month: 12 };

describe("SchedulePublishBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("çizelge yoksa hiçbir şey göstermez", async () => {
    getMonthlySchedule.mockResolvedValue(null);
    const { container } = render(<SchedulePublishBar {...props} />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("taslağı gösterir ve Yayınla ile yayınlar", async () => {
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

  it("onay verilmezse yayınlamaz", async () => {
    window.confirm.mockReturnValue(false);
    getMonthlySchedule.mockResolvedValue({ publication: { status: "draft" } });
    render(<SchedulePublishBar {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Yayınla" }));
    expect(setSchedulePublication).not.toHaveBeenCalled();
  });

  it("eski (yayın alanı olmayan) çizelgeyi yayınlanmış gösterir", async () => {
    getMonthlySchedule.mockResolvedValue({ publication: { status: "published", legacy: true } });
    render(<SchedulePublishBar {...props} />);
    expect(await screen.findByRole("button", { name: "Taslağa al" })).toBeTruthy();
    expect(screen.getByTestId("schedule-publish-bar").textContent).toContain("Yayınlandı");
  });
});
