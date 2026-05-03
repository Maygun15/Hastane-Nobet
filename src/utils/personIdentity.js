// Tek ve yetkili ID çözümleyici: id/_id/personId/pid'yi dener.
// TC numarası, kod veya diğer alanlar sistem ID'si olarak KULLANILMAZ.
export function resolvePersonId(person) {
  return String(person?.id || person?._id || person?.personId || person?.pid || "").trim();
}

function personIdOf(person) {
  return resolvePersonId(person);
}

function personNameOf(person) {
  return person?.fullName || person?.name || "";
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
  const personId = String(ref?.personId || ref?.id || "").trim();
  const nameKey = canonName(ref?.name || ref?.personName || ref?.fullName || "");

  if (personId && index.byId?.has(personId)) {
    return index.byId.get(personId) || null;
  }
  if (nameKey && index.byCanon?.has(nameKey)) {
    return index.byCanon.get(nameKey) || null;
  }
  return null;
}
