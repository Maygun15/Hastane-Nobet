// scripts/inspect-user.js
// Usage: node scripts/inspect-user.js <identifier>
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
const mongoose = require('mongoose');
const User = require(path.join(__dirname, '..', 'models', 'User.js'));

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error('Usage: node scripts/inspect-user.js <identifier>');
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(uri, { dbName: 'hastane', serverSelectionTimeoutMS: 10000 });
  const user = await User.findByIdentifier(String(identifier)).select('+passwordHash +password');
  if (!user) {
    console.error('Kullanıcı bulunamadı:', identifier);
    process.exit(2);
  }
  const ph = user.passwordHash || '';
  const pw = user.password || '';
  console.log(JSON.stringify({
    id: String(user._id),
    email: user.email,
    tc: user.tc,
    phone: user.phone,
    active: user.active,
    passwordHashPrefix: ph ? ph.slice(0, 7) : '',
    passwordHashLen: ph.length || 0,
    hasPasswordField: !!pw,
    passwordFieldLen: pw.length || 0
  }, null, 2));
  await mongoose.disconnect();
}
main().catch((err) => {
  console.error('ERR:', err.message);
  process.exit(1);
});
