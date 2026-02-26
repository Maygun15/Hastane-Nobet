// src/services/hybridScheduler.js
/**
 * HYBRID SCHEDULER ARCHITECTURE
 * 
 * Frontend (rosterEngine.js): Quick draft planning
 * Backend (schedulerService.js): Final optimization with Duty Rules
 * 
 * Flow:
 * 1. User loads RosterPage → rosterEngine.js (fast, localStorage)
 * 2. User saves draft
 * 3. User clicks "Optimize" → Backend API call
 * 4. Backend applies Duty Rules + weights
 * 5. Frontend displays final optimized schedule
 */

import { fetchDutyRules, saveDutyRules } from '../api/apiAdapter';
import { generateRoster } from '../engine/rosterEngine';

/**
 * Stage 1: Frontend Draft (Quick)
 */
export async function generateDraftSchedule({
  year,
  month0,
  role = "Nurse",
  rows,
  overrides,
  staffRaw,
  leavePolicy = "hard",
}) {
  // Use rosterEngine directly
  const result = generateRoster({
    year,
    month0,
    role,
    rows,
    overrides,
    leavePolicy,
    forcePins: true,
    requireEligibility: true,
  });

  return {
    type: "DRAFT",
    timestamp: new Date().toISOString(),
    stage: "FRONTEND",
    year,
    month: month0 + 1,
    role,
    data: result,
    metadata: {
      staffCount: staffRaw?.length || 0,
      rowsCount: rows?.length || 0,
      daysInMonth: new Date(year, month0 + 1, 0).getDate(),
    },
  };
}

/**
 * Stage 2: Backend Optimization (Slow but smart)
 */
export async function optimizeScheduleWithBackend({
  sectionId,
  serviceId = "",
  role = "",
  year,
  month,
  draftData, // from Stage 1
  targetHours = 160,
  token,
}) {
  try {
    // Fetch current Duty Rules
    const dutyRules = await fetchDutyRules({
      sectionId,
      serviceId,
      role,
      token,
    });

    // Prepare payload for backend
    const payload = {
      sectionId,
      serviceId,
      role,
      year,
      month,
      dryRun: false, // save to DB
      payload: {
        targetHours,
        // Optional: pass draft as seed
        debug: {
          logBlocks: true,
        },
      },
    };

    // Call backend scheduler API
    const response = await fetch(
      `/api/scheduler/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(`Backend optimization failed: ${response.statusText}`);
    }

    const result = await response.json();

    return {
      type: "OPTIMIZED",
      timestamp: new Date().toISOString(),
      stage: "BACKEND",
      year,
      month,
      dutyRules,
      data: result.data,
      generatedId: result.generatedId,
      metadata: {
        appliedRules: dutyRules.rules,
        appliedWeights: dutyRules.weights,
        issues: result.data?.issues || [],
      },
    };
  } catch (err) {
    console.error("[hybridScheduler] optimization failed:", err);
    throw err;
  }
}

/**
 * Stage 3: Compare & Merge
 */
export function compareSchedules(draft, optimized) {
  if (!draft || !optimized) return null;

  const draftAssignments = draft.data?.namedAssignments || {};
  const optimizedAssignments = optimized.data?.assignments || [];

  const changes = {
    added: [],
    removed: [],
    changed: [],
  };

  // Simple comparison (could be more sophisticated)
  const draftCount = Object.keys(draftAssignments).reduce(
    (sum, day) => sum + Object.keys(draftAssignments[day] || {}).length,
    0
  );
  const optimizedCount = optimizedAssignments.length;

  return {
    draftAssignments: draftCount,
    optimizedAssignments: optimizedCount,
    issues: optimized.metadata?.issues || [],
    changes,
  };
}

/**
 * Stage 4: Save Comparison
 */
export async function saveScheduleComparison({
  sectionId,
  year,
  month,
  draft,
  optimized,
  decision, // "keep_draft" | "use_optimized" | "manual"
  token,
}) {
  try {
    const response = await fetch(
      `/api/schedules/comparison`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sectionId,
          year,
          month,
          draftData: draft,
          optimizedData: optimized,
          userDecision: decision,
          savedAt: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Save failed: ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    console.error("[hybridScheduler] save failed:", err);
    throw err;
  }
}

/**
 * Full Hybrid Flow
 */
export async function runHybridScheduling({
  // Frontend inputs
  year,
  month0,
  role,
  rows,
  overrides,
  staffRaw,

  // Backend inputs
  sectionId,
  serviceId,
  targetHours,
  token,
}) {
  try {
    console.log("[hybrid] Stage 1: Generating draft...");
    const draft = await generateDraftSchedule({
      year,
      month0,
      role,
      rows,
      overrides,
      staffRaw,
    });

    console.log("[hybrid] Stage 2: Optimizing with backend...");
    const optimized = await optimizeScheduleWithBackend({
      sectionId,
      serviceId,
      role,
      year,
      month: month0 + 1,
      draftData: draft,
      targetHours,
      token,
    });

    console.log("[hybrid] Stage 3: Comparing results...");
    const comparison = compareSchedules(draft, optimized);

    return {
      draft,
      optimized,
      comparison,
      flow: {
        status: "COMPLETE",
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.error("[hybrid] Error in hybrid scheduling:", err);
    throw err;
  }
}
