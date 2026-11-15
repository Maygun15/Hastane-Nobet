// BUG-11: Onayla/Reddet düğmesine çok hızlı iki kez basılırsa API iki kez çağrılmamalı.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const pending = { _id: "r1", type: "takas", status: "pending", fromName: "Ayşe", serviceId: "acil", targetDate: "2026-11-20", createdAt: "2026-11-01" };

let resolveUpdate;
vi.mock("../api/apiAdapter.js", () => ({
  getMyRequests: vi.fn(() => Promise.resolve({ items: [pending] })),
  updateRequest: vi.fn(() => new Promise((resolve) => { resolveUpdate = resolve; })),
}));
vi.mock("../lib/leaves.js", () => ({
  loadLeavesFromBackend: vi.fn(() => Promise.resolve()),
  emitLeavesChanged: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { updateRequest } from "../api/apiAdapter.js";
import RequestsManagementTab from "../tabs/RequestsManagementTab.jsx";

describe("RequestsManagementTab double-click guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends approve only once when clicked twice in the same tick", async () => {
    render(<RequestsManagementTab />);
    const btn = await screen.findByRole("button", { name: "Onayla" });

    // İki tıklama aynı senkron blokta: React yeniden çizmeden ikinci tıklama gelir.
    act(() => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });

    expect(updateRequest).toHaveBeenCalledTimes(1);
    await act(async () => { resolveUpdate({ ok: true }); });
  });
});
