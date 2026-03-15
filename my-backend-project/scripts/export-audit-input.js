#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const MonthlySchedule = require("../models/MonthlySchedule");
const { buildSchedulerInput } = require("../services/scheduler/inputBuilder");
const { resolveStaff } = require("../services/scheduler/staffResolver");

function parseArgs(argv) {
  const out = {
    scheduleId: null,
    date: null,
    shiftCode: null,
    outPath: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--schedule") out.scheduleId = String(argv[++i] || "").trim();
    else if (arg === "--date") out.date = String(argv[++i] || "").trim();
    else if (arg === "--shift") out.shiftCode = String(argv[++i] || "").trim();
    else if (arg === "--out") out.outPath = String(argv[++i] || "").trim();
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  validateArgs(args);

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI missing in environment");
  }

  const connectOpts = {};
  if (process.env.MONGODB_DB) connectOpts.dbName = process.env.MONGODB_DB;
  await mongoose.connect(mongoUri, connectOpts);

  try {
    const output = await exportAuditInput(args);
    const serialized = `${JSON.stringify(output, null, 2)}\n`;

    if (args.outPath) {
      const resolvedOutPath = path.resolve(process.cwd(), args.outPath);
      fs.writeFileSync(resolvedOutPath, serialized, "utf8");
      console.log(`[export-audit-input] wrote ${resolvedOutPath}`);
    } else {
      process.stdout.write(serialized);
    }
  } finally {
    await mongoose.disconnect();
  }
}

function validateArgs(args) {
  if (!args.scheduleId) {
    throw new Error(
      "Usage: node scripts/export-audit-input.js --schedule <scheduleId> [--date YYYY-MM-DD] [--shift CODE] [--out ./audit-input.json]"
    );
  }
}

async function exportAuditInput({ scheduleId, date = null, shiftCode = null } = {}) {
  const scheduleDoc = await MonthlySchedule.findById(scheduleId).lean();
  if (!scheduleDoc) {
    throw new Error(`Schedule not found: ${scheduleId}`);
  }

  const schedulerInput = buildSchedulerInput({
    scheduleDoc,
    year: scheduleDoc.year,
    month: scheduleDoc.month,
    hospitalId: scheduleDoc.hospitalId || null,
    holidays: [],
  });

  const days = Array.isArray(schedulerInput?.days) ? schedulerInput.days : [];
  if (!days.length) {
    throw new Error("Selected schedule does not contain usable day/shift definitions.");
  }

  const selectedDay = resolveTargetDay(days, date);
  const selectedShift = resolveTargetShift(selectedDay, shiftCode);
  const staffPack = await resolveStaff({
    serviceId: scheduleDoc.serviceId || "",
    role: scheduleDoc.role || "",
    hospitalId: scheduleDoc.hospitalId || null,
  });

  const staff = Array.isArray(staffPack?.staff) ? staffPack.staff : [];
  if (!staff.length) {
    throw new Error("No staff resolved for selected schedule context.");
  }

  const assignments = buildAuditAssignments(scheduleDoc?.data?.assignments);
  const shiftsForDate = Array.isArray(selectedDay?.shifts)
    ? selectedDay.shifts.map((item) => buildShiftExport(item, scheduleDoc, selectedDay))
    : [];

  return {
    staff,
    assignments,
    date: selectedDay.date,
    shift: buildShiftExport(selectedShift, scheduleDoc, selectedDay),
    serviceId: selectedShift?.serviceId ?? scheduleDoc.serviceId ?? "",
    section: selectedShift?.section ?? selectedDay?.section ?? selectedShift?.area ?? null,
    shifts: shiftsForDate,
    schedule: {
      scheduleId: String(scheduleDoc._id),
      sectionId: scheduleDoc.sectionId || null,
      serviceId: scheduleDoc.serviceId || "",
      role: scheduleDoc.role || "",
      year: scheduleDoc.year || null,
      month: scheduleDoc.month || null,
      hospitalId: scheduleDoc.hospitalId ? String(scheduleDoc.hospitalId) : null,
    },
  };
}

function resolveTargetDay(days, explicitDate) {
  if (explicitDate) {
    const match = days.find((item) => String(item?.date || "").slice(0, 10) === explicitDate);
    if (!match) {
      throw new Error(`Selected date not found in schedule: ${explicitDate}`);
    }
    if (!Array.isArray(match.shifts) || !match.shifts.length) {
      throw new Error(`Selected date has no shifts to audit: ${explicitDate}`);
    }
    return match;
  }

  const firstWithShift = days.find((item) => Array.isArray(item?.shifts) && item.shifts.length);
  if (!firstWithShift) {
    throw new Error("Schedule contains no shifts to audit.");
  }
  return firstWithShift;
}

function resolveTargetShift(day, explicitShiftCode) {
  const shifts = Array.isArray(day?.shifts) ? day.shifts : [];
  if (!shifts.length) {
    throw new Error(`Selected date has no shifts to audit: ${day?.date || "-"}`);
  }

  if (explicitShiftCode) {
    const target = normalizeCode(explicitShiftCode);
    const match = shifts.find((item) => normalizeCode(item?.code || item?.id) === target);
    if (!match) {
      throw new Error(
        `Selected shift not found on ${day?.date || "-"}: ${explicitShiftCode}`
      );
    }
    return match;
  }

  return shifts[0];
}

function buildShiftExport(shift, scheduleDoc, day) {
  if (!shift || typeof shift !== "object") return null;

  return {
    id: shift.id ?? shift.code ?? null,
    code: shift.code ?? shift.id ?? null,
    serviceId: shift.serviceId ?? day?.serviceId ?? scheduleDoc?.serviceId ?? "",
    section: shift.section ?? day?.section ?? shift.area ?? null,
    area: shift.area ?? shift.section ?? null,
    requiredCount: Number(shift.requiredCount || 0) || 0,
    hours: Number(shift.hours || 0) || 0,
    start: shift.start || null,
    end: shift.end || null,
    isNight: Boolean(shift.isNight),
  };
}

function buildAuditAssignments(assignments) {
  const safeAssignments = Array.isArray(assignments) ? assignments : [];

  return safeAssignments
    .map((item) => {
      const date = normalizeDate(item?.date ?? item?.day);
      const personId = normalizeString(item?.personId);
      const shiftCode = normalizeString(item?.shiftCode ?? item?.shiftId ?? item?.shift ?? item?.code);
      const personName = normalizeString(item?.personName ?? item?.name);

      return {
        date,
        day: date,
        assignmentDate: date,
        personId,
        personName,
        shiftCode,
        shiftId: normalizeString(item?.shiftId ?? item?.shiftCode ?? item?.shift ?? item?.code),
      };
    })
    .filter((item) => item.date || item.personId || item.shiftCode);
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return null;
  const isoCandidate = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoCandidate)) return isoCandidate;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

main().catch(async (error) => {
  console.error(`[export-audit-input] failed: ${error?.message || error}`);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
