// İP-4 / D — "çözüm bulunamadı" açıklamaları planlayıcının anlayacağı dilde.
import { describe, expect, it } from "vitest";
import { describeCandidatePipeline, summarizeIssueDiagnostic, formatIssueReason } from "../components/DutyRowsEditor.utils.js";

describe("aday eleme açıklaması", () => {
  it("Türkçe, sayılarla ve öneriyle; teknik terim yok", () => {
    const t = summarizeIssueDiagnostic({
      inputStaffCount: 57, candidateBuilderEligibleCount: 47, postConstraintCount: 0,
      topBlockers: [{ code: "SERVICE_SUPERVISOR_ONLY", count: 47 }, { code: "NIGHT_24H_NEXT_DAY_BLOCK", count: 20 }],
    });
    expect(t).toMatch(/57 kişiden 47 kişi bu göreve uygun; kurallar uygulandıktan sonra 0 aday kaldı/);
    expect(t).toMatch(/bu görev yalnız servis sorumlusuna \(47\)/);
    expect(t).toMatch(/Öneri: Servis Sorumlusu alanına bir kişi daha ekleyin/);
    expect(t).not.toMatch(/havuz|builder|runtime/);
  });
  it("bilinen kodlar Türkçe; bilinmeyen kod olduğu gibi", () => {
    expect(formatIssueReason("min_rest_hours")).toBe("en az dinlenme süresi dolmamış");
    expect(formatIssueReason("MAX_WEEKLY_HOURS")).toBe("haftalık saat sınırı dolmuş");
    expect(formatIssueReason("YENI_KOD")).toBe("YENI_KOD");
    expect(describeCandidatePipeline({ inputStaffCount: 3 })).toMatch(/3 kişiden 0 kişi/);
  });
});
