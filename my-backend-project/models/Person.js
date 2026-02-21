// models/Person.js
const mongoose = require('mongoose');

const personSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  serviceId: { type: String, required: true, index: true },

  // Kimlik
  name:   { type: String, required: true, trim: true }, // "Ad Soyad"
  firstName: { type: String, trim: true },
  lastName:  { type: String, trim: true },

  // TC ve iletişim
  tc:    { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },

  // İsteğe bağlı meta
  meta:  { type: Object, default: {} },
}, { timestamps: true });

personSchema.index({ tc: 1 }, { sparse: true });

module.exports = mongoose.models.Person || mongoose.model('Person', personSchema);
