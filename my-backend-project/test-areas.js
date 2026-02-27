require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('./models/Person');
const MonthlySchedule = require('./models/MonthlySchedule');
const { areaMatches, normalizeArea } = require('./services/scheduler/constraints');

mongoose.connect(process.env.MONGODB_URI, { dbName: 'hastane' }).then(async () => {
  const persons = await Person.find().lean();
  const doc = await MonthlySchedule.findById('68f7de3432c8b3e9e201eb3e').lean();
  const defs = doc?.data?.defs || [];

  const shiftAreas = [...new Set(defs.map(d => normalizeArea(d.label || '')).filter(Boolean))];
  console.log('Vardiya alanları:', shiftAreas);

  for (const shiftArea of shiftAreas) {
    const getPersonAreas = (p) => {
      const raw = p?.meta?.areas || [];
      if (Array.isArray(raw)) return raw.map(normalizeArea).filter(Boolean);
      return [];
    };
    
    const matched = persons.filter(p => {
      const areas = getPersonAreas(p);
      if (areas.length === 0) return false;
      return areaMatches(areas, shiftArea);
    });
    
    console.log(`"${shiftArea}": ${matched.length} kişi eşleşiyor`);
    if (matched.length < 3) {
      matched.forEach(p => console.log('  -', p.name));
    }
  }

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
