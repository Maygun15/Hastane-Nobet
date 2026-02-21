require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User.js');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const user = await User.findByIdentifier('17050689444').select('+passwordHash +password');
  
  if (!user) {
    console.log('HATA: Kullanıcı bulunamadı!');
    console.log('findByIdentifier ile arama başarısız');
    process.exit(1);
  }
  
  console.log('✅ Kullanıcı bulundu:', user.email);
  
  const result = await user.comparePassword('Ma1234');
  console.log('Şifre doğrulama sonucu:', result);
  
  if (!result) {
    console.log('\n❌ Şifre eşleşmiyor!');
    console.log('passwordHash mevcut ama comparePassword false döndürüyor');
  } else {
    console.log('\n✅ Şifre doğru!');
  }
  
  process.exit(0);
});
