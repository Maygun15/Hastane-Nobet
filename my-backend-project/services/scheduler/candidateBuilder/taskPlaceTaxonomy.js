"use strict";

const TASK_PLACE_KINDS = Object.freeze({
  WORK_AREA: "WORK_AREA",
  RESPONSIBILITY: "RESPONSIBILITY",
  COMPOSITE_WORK_AREA: "COMPOSITE_WORK_AREA",
  UNKNOWN: "UNKNOWN",
  SECTION: "WORK_AREA",
  COMPOSITE: "COMPOSITE_WORK_AREA",
});

const TASK_PLACE_DEFINITIONS = Object.freeze([
  makeDefinition({
    label: "KIRMIZI",
    kind: TASK_PLACE_KINDS.WORK_AREA,
  }),
  makeDefinition({
    label: "SARI",
    kind: TASK_PLACE_KINDS.WORK_AREA,
  }),
  makeDefinition({
    label: "YEŞİL",
    kind: TASK_PLACE_KINDS.WORK_AREA,
    aliases: ["YESIL"],
  }),
  makeDefinition({
    label: "TRİAJ",
    kind: TASK_PLACE_KINDS.WORK_AREA,
    aliases: ["TRIAJ", "TRIYAJ"],
  }),
  makeDefinition({
    label: "ÇOCUK",
    kind: TASK_PLACE_KINDS.WORK_AREA,
    aliases: ["COCUK"],
  }),
  makeDefinition({
    label: "ECZANE",
    kind: TASK_PLACE_KINDS.WORK_AREA,
  }),
  makeDefinition({
    label: "RESÜSİTASYON",
    kind: TASK_PLACE_KINDS.WORK_AREA,
    aliases: ["RESUSITASYON"],
  }),
  makeDefinition({
    label: "CERRAHİ MÜDAHELE",
    kind: TASK_PLACE_KINDS.WORK_AREA,
    aliases: ["CERRAHI MUDAHELE"],
  }),
  makeDefinition({
    label: "AŞI",
    kind: TASK_PLACE_KINDS.WORK_AREA,
    aliases: ["ASI"],
  }),
  makeDefinition({
    label: "EKİP SORUMLUSU",
    kind: TASK_PLACE_KINDS.RESPONSIBILITY,
    aliases: ["EKIP SORUMLUSU"],
  }),
  makeDefinition({
    label: "SERVİS SORUMLUSU",
    kind: TASK_PLACE_KINDS.RESPONSIBILITY,
    aliases: ["SERVIS SORUMLUSU"],
  }),
  makeDefinition({
    label: "SÜPERVİZÖR",
    kind: TASK_PLACE_KINDS.RESPONSIBILITY,
    aliases: ["SUPERVIZOR"],
  }),
  makeDefinition({
    label: "KIRMIZI VE SARI ALAN GÖREVLENDİRME",
    kind: TASK_PLACE_KINDS.COMPOSITE_WORK_AREA,
    aliases: [
      "KIRMIZI VE SARI ALAN GOREVLENDIRME",
      "KIRMIZI VE SARI GOREVLENDIRME",
      "KIRMIZI VE SARI GÖREVLENDİRME",
    ],
    eligibleWorkAreasAnyOf: ["KIRMIZI", "SARI"],
    notes: "Composite work area. Any eligible work area match is enough.",
  }),
]);

const DEFINITION_BY_KEY = buildDefinitionIndex(TASK_PLACE_DEFINITIONS);

function resolveTaskPlaceDefinition(label) {
  const normalizedKey = normalizeTaskPlaceKey(label);
  if (!normalizedKey) {
    return createUnknownDefinition(label);
  }

  const definition = DEFINITION_BY_KEY.get(normalizedKey);
  if (!definition) {
    return createUnknownDefinition(label);
  }

  return {
    ...definition,
    label: definition.label,
    eligibleWorkAreasAnyOf: Array.isArray(definition.eligibleWorkAreasAnyOf)
      ? [...definition.eligibleWorkAreasAnyOf]
      : [],
    eligibleSectionsAnyOf: Array.isArray(definition.eligibleWorkAreasAnyOf)
      ? [...definition.eligibleWorkAreasAnyOf]
      : [],
    aliases: Array.isArray(definition.aliases) ? [...definition.aliases] : [],
  };
}

function classifyTaskPlace(label) {
  return resolveTaskPlaceDefinition(label).kind;
}

function isWorkAreaTaskPlace(label) {
  return classifyTaskPlace(label) === TASK_PLACE_KINDS.WORK_AREA;
}

function isSectionTaskPlace(label) {
  return isWorkAreaTaskPlace(label);
}

function isCompositeTaskPlace(label) {
  return classifyTaskPlace(label) === TASK_PLACE_KINDS.COMPOSITE_WORK_AREA;
}

function isEligibleForCompositeTaskPlace(person, taskPlaceDefinition) {
  const definition = normalizeDefinitionInput(taskPlaceDefinition);
  if (definition.kind !== TASK_PLACE_KINDS.COMPOSITE_WORK_AREA) {
    return false;
  }

  const personSections = extractPersonSections(person);
  if (!personSections.length) {
    return false;
  }

  return definition.eligibleWorkAreasAnyOf.some((sectionLabel) =>
    personSections.includes(normalizeTaskPlaceKey(sectionLabel))
  );
}

function listTaskPlaceDefinitions() {
  return TASK_PLACE_DEFINITIONS.map((item) => ({
    ...item,
    eligibleWorkAreasAnyOf: [...item.eligibleWorkAreasAnyOf],
    eligibleSectionsAnyOf: [...item.eligibleWorkAreasAnyOf],
    aliases: [...item.aliases],
  }));
}

function listTaskPlaceKinds() {
  return [
    TASK_PLACE_KINDS.WORK_AREA,
    TASK_PLACE_KINDS.RESPONSIBILITY,
    TASK_PLACE_KINDS.COMPOSITE_WORK_AREA,
    TASK_PLACE_KINDS.UNKNOWN,
  ];
}

function makeDefinition({
  label,
  kind,
  aliases = [],
  eligibleWorkAreasAnyOf = [],
  notes = "",
} = {}) {
  const normalizedLabel = normalizeDisplayLabel(label);
  const normalizedKey = normalizeTaskPlaceKey(label);
  const normalizedAliases = Array.from(
    new Set(
      [normalizedLabel]
        .concat(Array.isArray(aliases) ? aliases.map((item) => normalizeDisplayLabel(item)).filter(Boolean) : [])
    )
  );

  return Object.freeze({
    label: normalizedLabel,
    normalizedKey,
    kind: kind || TASK_PLACE_KINDS.UNKNOWN,
    aliases: normalizedAliases,
    eligibleWorkAreasAnyOf: Array.from(
      new Set(
        (Array.isArray(eligibleWorkAreasAnyOf) ? eligibleWorkAreasAnyOf : [])
          .map((item) => normalizeDisplayLabel(item))
          .filter(Boolean)
      )
    ),
    notes: notes || "",
  });
}

function buildDefinitionIndex(definitions) {
  const out = new Map();

  for (const definition of definitions) {
    out.set(definition.normalizedKey, definition);
    for (const alias of definition.aliases) {
      const aliasKey = normalizeTaskPlaceKey(alias);
      if (aliasKey) out.set(aliasKey, definition);
    }
  }

  return out;
}

function normalizeDefinitionInput(input) {
  if (input && typeof input === "object" && input.normalizedKey) {
    return input;
  }

  return resolveTaskPlaceDefinition(input);
}

function createUnknownDefinition(label) {
  const normalizedLabel = normalizeDisplayLabel(label);
  const normalizedKey = normalizeTaskPlaceKey(label);

  return {
    label: normalizedLabel || "",
    normalizedKey,
    kind: TASK_PLACE_KINDS.UNKNOWN,
    aliases: normalizedLabel ? [normalizedLabel] : [],
    eligibleWorkAreasAnyOf: [],
    eligibleSectionsAnyOf: [],
    notes: "No taxonomy definition registered yet.",
  };
}

function extractPersonSections(person) {
  if (!person || typeof person !== "object") return [];

  const raw =
    person?.sections ??
    person?.section ??
    person?.area ??
    person?.areas ??
    person?.workAreas ??
    person?.workArea ??
    person?.meta?.sections ??
    person?.meta?.areas ??
    person?.meta?.section ??
    person?.meta?.area ??
    person?.meta?.workAreas ??
    person?.meta?.workArea;

  const values = normalizeTaskPlaceList(raw);
  return Array.from(new Set(values));
}

function normalizeTaskPlaceList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTaskPlaceKey(item)).filter(Boolean);
  }

  if (typeof value === "string" && value.includes(",")) {
    return value
      .split(",")
      .map((item) => normalizeTaskPlaceKey(item))
      .filter(Boolean);
  }

  const one = normalizeTaskPlaceKey(value);
  return one ? [one] : [];
}

function normalizeDisplayLabel(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeTaskPlaceKey(value) {
  if (value == null) return null;

  const normalized = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”"']/g, "")
    .replace(/[(){}[\],.;:/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/I/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C");

  return normalized || null;
}

module.exports = {
  TASK_PLACE_KINDS,
  normalizeTaskPlaceKey,
  resolveTaskPlaceDefinition,
  classifyTaskPlace,
  isWorkAreaTaskPlace,
  isSectionTaskPlace,
  isCompositeTaskPlace,
  isEligibleForCompositeTaskPlace,
  listTaskPlaceDefinitions,
  listTaskPlaceKinds,
};
