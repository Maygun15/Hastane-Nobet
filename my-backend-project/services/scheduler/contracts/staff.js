"use strict";

function resolvePersonField(person, meta, fieldName, metaFieldNames = []) {
  if (person?.[fieldName] != null) return person[fieldName];

  for (const metaFieldName of metaFieldNames) {
    if (meta?.[metaFieldName] != null) return meta[metaFieldName];
  }

  return null;
}

function createRuntimeCounters() {
  return {
    totalHours: 0,
    totalShifts: 0,
    weekdayCount: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    pairHistory: {},
    assignedDays: [],
    weeklyCounts: {},
    taskCounts: {},
    consecutiveDays: 0,
    lastAssignedDate: null,
    lastShift: null,
  };
}

function normalizeStaffMember(person = {}) {
  const metaRaw = person?.meta && typeof person.meta === "object" ? person.meta : {};
  const active = resolvePersonField(person, metaRaw, "active", ["active"]);
  const isActive = resolvePersonField(person, metaRaw, "isActive", ["isActive"]);
  const status = resolvePersonField(person, metaRaw, "status", ["status"]);
  const serviceId = resolvePersonField(person, metaRaw, "serviceId", ["serviceId"]);
  const service = resolvePersonField(person, metaRaw, "service", ["service"]);
  const role = resolvePersonField(person, metaRaw, "role", ["role", "unvan"]);
  const roles = resolvePersonField(person, metaRaw, "roles", ["roles"]);
  const title = resolvePersonField(person, metaRaw, "title", ["title"]);
  const stats = resolvePersonField(person, metaRaw, "stats", ["stats"]);
  const skills = resolvePersonField(person, metaRaw, "skills", ["skills"]);
  const experience = resolvePersonField(person, metaRaw, "experience", ["experience"]);
  const experienceYears = resolvePersonField(person, metaRaw, "experienceYears", ["experienceYears"]);
  const seniority = resolvePersonField(person, metaRaw, "seniority", ["seniority"]);
  const areas = person?.areas ?? metaRaw.areas;
  const shiftCodes = person?.shiftCodes ?? metaRaw.shiftCodes;
  const meta = { ...metaRaw };

  if (areas != null && meta.areas == null) meta.areas = areas;
  if (shiftCodes != null && meta.shiftCodes == null) meta.shiftCodes = shiftCodes;
  if (active != null && meta.active == null) meta.active = active;
  if (isActive != null && meta.isActive == null) meta.isActive = isActive;
  if (status != null && meta.status == null) meta.status = status;
  if (serviceId != null && meta.serviceId == null) meta.serviceId = serviceId;
  if (service != null && meta.service == null) meta.service = service;
  if (role != null && meta.role == null) meta.role = role;
  if (roles != null && meta.roles == null) meta.roles = roles;
  if (title != null && meta.title == null) meta.title = title;
  if (stats != null && meta.stats == null) meta.stats = stats;
  if (skills != null && meta.skills == null) meta.skills = skills;
  if (experience != null && meta.experience == null) meta.experience = experience;
  if (experienceYears != null && meta.experienceYears == null) meta.experienceYears = experienceYears;
  if (seniority != null && meta.seniority == null) meta.seniority = seniority;

  return {
    id: String(person.id || person._id || person.personId || ""),
    name: person.name || person.fullName || person.displayName || "",
    active,
    isActive,
    status,
    serviceId,
    service,
    role,
    roles,
    title,
    stats,
    skills,
    experience,
    experienceYears,
    seniority,
    meta,
    areas,
    shiftCodes,
    ...createRuntimeCounters(),
  };
}

function normalizeStaff(staff = []) {
  if (!Array.isArray(staff)) return [];
  return staff.map((person) => normalizeStaffMember(person));
}

module.exports = {
  normalizeStaff,
  normalizeStaffMember,
  resolvePersonField,
  createRuntimeCounters,
};
