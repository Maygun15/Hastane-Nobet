// models/Person.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const personSchema = new mongoose.Schema({
  hospitalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    default: null,
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

  annualLeaveDays: { type: Number, default: 15, min: 0 },
  createdBy: { type: String }
}, { timestamps: true });

personSchema.index({ tc: 1 }, { sparse: true });
// TC benzersizliği sadece TC girilmişse uygulanır. Eski tanım ({ unique, sparse })
// birleşik indekste işe yaramıyordu: TC'si boş ('' / null) ikinci kişi eklenemiyordu.
// Eski 'hospitalId_1_tc_1' indeksi için: scripts/migratePersonTcIndex.js
const PERSON_TC_INDEX_NAME = 'hospitalId_1_tc_1_nonempty';
personSchema.index(
  { hospitalId: 1, tc: 1 },
  {
    name: PERSON_TC_INDEX_NAME,
    unique: true,
    partialFilterExpression: { tc: { $type: 'string', $gt: '' } },
  }
);
personSchema.index({ hospitalId: 1, serviceId: 1 });
// Personel arama: ?q= sorguları için
personSchema.index({ hospitalId: 1, name: 1 });
// Email lookup (kullanıcı bağlama)
personSchema.index({ hospitalId: 1, email: 1 }, { sparse: true });
// Auth lookup: userId + hospitalId (requests.routes.js Person.findOne({ userId }))
personSchema.index({ hospitalId: 1, userId: 1 }, { sparse: true });
applyHospitalScope(personSchema);

module.exports = mongoose.models.Person || mongoose.model('Person', personSchema);
