// models/Person.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const personSchema = new mongoose.Schema({
  hospitalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    default: null,
    index: true,
  },
  serviceId: { type: String, required: true, index: true },

  // Kimlik
  name:   { type: String, required: true, trim: true },
  firstName: { type: String, trim: true },
  lastName:  { type: String, trim: true },

  // TC ve iletişim
  tc:    { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  active: { type: Boolean, default: true, index: true },

  // Ek bilgiler
  meta:  { type: Object, default: {} },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
    sparse: true,
  },

  createdBy: { type: String }
}, { timestamps: true });

personSchema.index({ tc: 1 }, { sparse: true });
personSchema.index({ hospitalId: 1, tc: 1 }, { unique: true, sparse: true });
personSchema.index({ hospitalId: 1, serviceId: 1 });
applyHospitalScope(personSchema);

module.exports = mongoose.models.Person || mongoose.model('Person', personSchema);
