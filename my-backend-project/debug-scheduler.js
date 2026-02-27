require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('./models/Person');
const MonthlySchedule = require('./models/MonthlySchedule');

// constraints.js fonksiyonlarını kopyala
const normalizeArea = (s) =>
  (s || '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

const splitAreaTokens = (s) => {
  const base = normalizeArea(s);
  if (!base) return [];
  return base
    .replace(/[\(\)\[\]\{\}]/g, ' ')
    .replace(/\b(alan|alani|gorev|gorevi|gorevlendirme|birim|birimi|unit)\b/g, ' ')
    .replace(/&|\+|\/|\\|,|;|-|_|\bve\b|\bveya\b|\byada\b/g, ' ')
    .split(/\s+/).map(t => t.trim()).filter(t => t && t.length > 1);
};

const getPersonAreas = (person) => {
  const raw = person?.meta?.areas || person?.meta?.duties || person?.areas || [];
  if (Array.isArray(raw)) return raw.map(normalizeArea).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map(normalizeArea).filter(Boolean);
  return [];
};

mongoose.connect(process.env.MONGODB_URI, { dbName: 'hastane' }).then(async () => {
  // 1. Personel alanlarına bak
  const persons = await Person.find().lean();
  console.log('=== PERSONEL ALANLARI (ilk 3) ===');
  for (const p of persons.slice(0, 3)) {
    const areas = getPersonAreas(p);
    console.log(p.name, '→ areas:', areas.slice(0, 3));
  }

  // 2. Vardiya label'larına bak
  const doc = await MonthlySchedule.findById('68f7de3432c8b3e9e201eb3e').lean();
  const defs = doc?.data?.defs || [];
  const shiftAreas = [...new Set(defs.map(d => normalizeArea(d.label || '')).filter(Boolean))];
  console.log('\n=== VARDİYA ALANLARI (normalize) ===');
  console.log(shiftAreas);

  // 3. İlk vardiya için eşleşme testi
  const testArea = shiftAreas[0];
  console.log(`\n=== "${testArea}" için eşleşme testi ===`);
  let matched = 0;
  let noMatch = 0;
  for (const p of persons) {
    const areas = getPersonAreas(p);
    if (areas.length === 0) { noMatch++; continue; }
    if (areas.includes(testArea)) { matched++; continue; }
    const tokens = splitAreaTokens(testArea);
    const ok = tokens.some(t => areas.includes(t));
    if (ok) matched++; else noMatch++;
  }
  console.log(`Eşleşen: ${matched}, Eşleşmeyen: ${noMatch}`);

  // 4. shiftCodes kontrolü
  const normalizeCode = (s) =>
    (s || '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
  const getPersonShiftCodes = (person) => {
    const raw = person?.meta?.shiftCodes || person?.shiftCodes || [];
    if (Array.isArray(raw)) return raw.map(normalizeCode).filter(Boolean);
    return [];
  };
  
  const shiftCodes = [...new Set(defs.map(d => normalizeCode(d.shiftCode || '')).filter(Boolean))];
  console.log('\n=== VARDİYA KODLARI ===', shiftCodes);
  
  const testCode = 'N';
  let codeMatch = 0, noCode = 0;
  for (const p of persons) {
    const codes = getPersonShiftCodes(p);
    if (!codes.length || codes.includes(testCode)) codeMatch++;
    else noCode++;
  }
  console.log(`"${testCode}" kodu için: Eşleşen: ${codeMatch}, Eşleşmeyen: ${noCode}`);

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
