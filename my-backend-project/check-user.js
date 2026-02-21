require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User.js');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const user = await User.findOne({ tc: '17050689444' }).select('+passwordHash +password').lean();
  console.log(JSON.stringify({
    id: user?._id,
    email: user?.email,
    tc: user?.tc,
    phone: user?.phone,
    active: user?.active,
    hasPasswordHash: !!user?.passwordHash,
    passwordHashPrefix: user?.passwordHash?.substring(0, 7),
    passwordHashLen: user?.passwordHash?.length,
    hasPasswordField: !!user?.password,
    passwordValue: user?.password
  }, null, 2));
  process.exit(0);
});
