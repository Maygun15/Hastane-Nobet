// Tercih talebi formu: tür + tarih aralığı sunucuya gönderilir (ROADMAP pilot #2).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("../api/apiAdapter.js", () => ({
  getMyRequests: vi.fn(() => Promise.resolve({ items: [] })),
  createRequest: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("../lib/api.js", () => ({ http: { get: vi.fn(() => Promise.resolve([])) } }));
vi.mock("../auth/AuthContext.jsx", () => ({ useAuth: () => ({ user: { _id: "u1", role: "user" } }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { createRequest } from "../api/apiAdapter.js";
import { toast } from "sonner";
import MyRequestsTab from "../tabs/MyRequestsTab.jsx";

async function openTercihForm(container) {
  render(<MyRequestsTab />, { container });
  fireEvent.click(await screen.findByRole("button", { name: /Yeni Talep/ }));
  const typeSelect = screen.getAllByRole("combobox").find((el) => [...el.options].some((o) => o.value === "tercih"));
  fireEvent.change(typeSelect, { target: { value: "tercih" } });
}

describe("MyRequestsTab tercih formu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gece istemiyorum + tarih aralığı gönderir", async () => {
    await openTercihForm();
    const kindSelect = screen.getAllByRole("combobox").find((el) => [...el.options].some((o) => o.value === "noNight"));
    fireEvent.change(kindSelect, { target: { value: "noNight" } });
    const [start, end] = document.querySelectorAll('input[type="date"]');
    fireEvent.change(start, { target: { value: "2026-12-24" } });
    fireEvent.change(end, { target: { value: "2026-12-26" } });
    fireEvent.change(screen.getByPlaceholderText("Talebinizi açıklayın..."), { target: { value: "Bayramda ailemle" } });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gönder" })); });

    expect(createRequest).toHaveBeenCalledWith({
      type: "tercih",
      message: "Bayramda ailemle",
      targetDate: "2026-12-24",
      targetDateEnd: "2026-12-26",
      preferenceKind: "noNight",
    });
  });

  it("tarih yoksa göndermez", async () => {
    await openTercihForm();
    fireEvent.change(screen.getByPlaceholderText("Talebinizi açıklayın..."), { target: { value: "x" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gönder" })); });
    expect(createRequest).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Tercih için tarih zorunludur");
  });
});

describe("MyRequestsTab izin formu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("izin türünü gönderir (açıklama metni izin türü olmaz)", async () => {
    render(<MyRequestsTab />);
    fireEvent.click(await screen.findByRole("button", { name: /Yeni Talep/ }));
    const typeSelect = screen.getByLabelText(/İzin türü/);
    expect(typeSelect.value).toBe("Y");
    const [start] = document.querySelectorAll('input[type="date"]');
    fireEvent.change(start, { target: { value: "2026-12-10" } });
    fireEvent.change(screen.getByPlaceholderText("Talebinizi açıklayın..."), { target: { value: "Düğünüm var" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gönder" })); });
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      type: "izin", leaveTypeCode: "Y", message: "Düğünüm var", targetDate: "2026-12-10",
    }));
  });
});
