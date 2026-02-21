#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const emailArg = process.argv[2];
const passArg = process.argv[3];
const email = (emailArg || process.env.ADMIN_EMAIL || 'admin@admin.com').toLowerCase();
const password = passArg || process.env.ADMIN_PASSWORD || '123456';

(async () => {
  try {
    if (!process.env.MONGODB_URI) {
      console.error('MONGODB_URI yok. .env dosyasini kontrol et.');
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'hastane' });

    let u = await User.findOne({ email });
    if (!u) u = await User.findOne({ email: email.replace('@admin.com','@admin.com') });
    if (!u) u = await User.findOne({ role: 'admin' });
    if (!u) {
      console.error('Admin kullanici bulunamadi.');
      process.exit(1);
    }

    u.email = email;
    u.role = 'admin';
    u.active = true;
    u.passwordHash = await bcrypt.hash(password, 10);
    u.password = undefined;
    await u.save();

    console.log(`admin reset ok -> ${email} / ${password}`);
    process.exit(0);
  } catch (e) {
    console.error('reset-admin hata:', e.message);
    process.exit(1);
  }
})();
