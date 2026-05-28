// Tek ve yetkili ID çözümleyici: id/_id/personId/person_id/pid'yi dener.
// TC numarası, kod veya diğer alanlar sistem ID'si olarak KULLANILMAZ.
export function resolvePersonId(person) {
  return String(
    person?.id ||
    person?._id ||
    person?.personId ||
    person?.person_id ||
    person?.pid ||
    person?.staffId ||
    person?.person?.id ||
    person?.person?._id ||
    person?.person?.personId ||
    person?.person?.person_id ||
    ""
  ).trim();
}

function personIdOf(person) {
  return resolvePersonId(person);
}

export function personNameOf(person) {
  return String(
    person?.fullName ||
    person?.name ||
    person?.displayName ||
    person?.adsoyad ||
    person?.adSoyad ||
    person?.personName ||
    person?.person?.fullName ||
    person?.person?.name ||
    ""
  ).trim();
}

export function resolveAssignmentPersonId(assignment) {
  return String(
    assignment?.personId ||
    assignment?.person_id ||
    assignment?.pid ||
    assignment?.staffId ||
    assignment?.person?.id ||
    assignment?.person?._id ||
    assignment?.person?.personId ||
    assignment?.person?.person_id ||
    ""
  ).trim();
}

export function resolveAssignmentPersonName(assignment) {
  return personNameOf(assignment);
}

export function stripDiacritics(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ş/g, "S").replace(/İ/g, "I")
    .replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ç/g, "c");
}

export function canonName(str) {
  return stripDiacritics((str || "").toString().trim().toLocaleUpperCase("tr-TR"))
    .replace(/\s+/g, " ")
    .trim();
}

export function choosePreferredName(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  const currentCanon = canonName(current);
  const candidateCanon = canonName(candidate);
  if (currentCanon && candidateCanon && currentCanon === candidateCanon) {
    return candidate === candidate.toLowerCase() && current !== current.toLowerCase() ? current : candidate;
  }
  return current;
}

export function buildPersonIdentityIndex(people = []) {
  const byId = new Map();
  const byCanon = new Map();
  for (const person of Array.isArray(people) ? people : []) {
    const pid = personIdOf(person);
    const nameKey = canonName(personNameOf(person));
    if (pid) byId.set(pid, person);
    if (nameKey && !byCanon.has(nameKey)) byCanon.set(nameKey, person);
  }
  return { byId, byCanon };
}

export function resolvePersonRef(ref = {}, peopleOrIndex = []) {
  const index = Array.isArray(peopleOrIndex) ? buildPersonIdentityIndex(peopleOrIndex) : (peopleOrIndex || {});
  const personId = String(ref?.personId || ref?.person_id || ref?.id || ref?._id || ref?.pid || ref?.staffId || "").trim();
  const nameKey = canonName(personNameOf(ref));

  if (personId && index.byId?.has(personId)) {
    return index.byId.get(personId) || null;
  }
  if (nameKey && index.byCanon?.has(nameKey)) {
    return index.byCanon.get(nameKey) || null;
  }
  return null;
}
