require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User.js');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const user = await User.findOne({ tc: '17050689444' }).select('+passwordHash +password');
  
  if (!user) {
    console.log('Kullanıcı bulunamadı');
    process.exit(1);
  }
  
  console.log('Kullanıcı bulundu:', user.email);
  console.log('Yeni şifre hash\'leniyor...');
  
  const newHash = await bcrypt.hash('Ma1234', 10);
  user.passwordHash = newHash;
  user.password = undefined;
  
  await user.save();
  
  console.log('✅ Şifre başarıyla güncellendi!');
  console.log('Hash prefix:', newHash.substring(0, 7));
  
  // Test et
  const testUser = await User.findById(user._id).select('+passwordHash +password');
  const ok = await testUser.comparePassword('Ma1234');
  console.log('Doğrulama testi:', ok ? '✅ BAŞARILI' : '❌ BAŞARISIZ');
  
  process.exit(0);
});
