// scripts/fix-indexes.js
require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI yok. .env içine ekleyin.'); process.exit(1);
}

(async () => {
  await mongoose.connect(MONGODB_URI, { dbName: 'hastane', serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const col = db.collection('users');

  const idx = await col.indexes();
  console.log('Mevcut indexler:', idx.map(i => i.name));

  // Aynı key ile birden fazla index varsa (örn email:1), unique+sparse olan kalsın, diğerlerini sil
  const byKey = {};
  for (const i of idx) {
    const keyStr = JSON.stringify(i.key);
    if (!byKey[keyStr]) byKey[keyStr] = [];
    byKey[keyStr].push(i);
  }

  const drops = [];
  for (const [key, arr] of Object.entries(byKey)) {
    if (arr.length <= 1) continue;
    // email/phone/tc gibi keyler için "unique & sparse" olanı koru, geri kalanları sil
    const keep = arr.find(i => i.unique && i.sparse) || arr[0];
    for (const i of arr) {
      if (i.name !== keep.name && i.name !== '_id_') drops.push(i.name);
    }
  }

  for (const name of drops) {
    console.log('Drop index:', name);
    try { await col.dropIndex(name); } catch (e) { console.warn('Drop hata:', name, e.message); }
  }

  const finalIdx = await col.indexes();
  console.log('Kalan indexler:', finalIdx.map(i => i.name));
  await mongoose.disconnect();
  console.log('Bitti ✅');
})();
