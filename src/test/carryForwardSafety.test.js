import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock, invalidateMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock("../lib/api.js", () => ({
  http: { req: requestMock },
}));

vi.mock("../store/monthlyScheduleModel.js", () => ({
  invalidateScheduleCache: invalidateMock,
}));

import {
  carryForwardMonthlyTemplate,
  generateSchedulerPlan,
} from "../api/apiAdapter.js";

const scope = {
  sectionId: "calisma-cizelgesi",
  serviceId: "service-a",
  role: "Nurse",
  year: 2026,
  month: 6,
};

describe("carry-forward frontend safety boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls only carry-forward and does not emit schedule mutation events", async () => {
    requestMock.mockResolvedValue({
      ok: true,
      carried: true,
      defsCount: 41,
      assignmentsCopied: 0,
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");

    const result = await carryForwardMonthlyTemplate(scope);

    expect(result).toMatchObject({
      carried: true,
      defsCount: 41,
      assignmentsCopied: 0,
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      "/api/schedules/monthly/carry-forward-template",
      expect.objectContaining({
        method: "POST",
        body: scope,
      }),
    );
    expect(requestMock.mock.calls.some(([path]) => path === "/api/scheduler/generate")).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it("calls scheduler only through the separate generation API", async () => {
    requestMock.mockResolvedValue({ ok: true, data: { assignments: [] } });

    await generateSchedulerPlan(scope);

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      "/api/scheduler/generate",
      expect.objectContaining({
        method: "POST",
        body: scope,
      }),
    );
  });
});
