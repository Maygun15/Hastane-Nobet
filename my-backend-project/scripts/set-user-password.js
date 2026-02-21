// scripts/set-user-password.js
// Usage: node scripts/set-user-password.js <identifier(email|tc|phone)> <newPassword>
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const mongoose = require('mongoose');
const User = require(path.join(__dirname, '..', 'models', 'User.js'));

async function main() {
  const identifier = process.argv[2];
  const newPassword = process.argv[3];
  if (!identifier || !newPassword) {
    console.error('Usage: node scripts/set-user-password.js <identifier> <newPassword>');
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

  await user.setPassword(String(newPassword));
  user.password = undefined;
  await user.save();

  console.log('OK: password updated for', identifier);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('ERR:', err.message);
  process.exit(1);
});
