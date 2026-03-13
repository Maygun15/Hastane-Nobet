// models/Request.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const RequestSchema = new mongoose.Schema({
  hospitalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    default: null,
    index: true,
  },
  type: {
    type: String,
    enum: ['izin', 'takas', 'tercih', 'diger'],
    required: true
  },
  fromUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fromPersonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
  fromName:     { type: String, default: '' },
  serviceId:    { type: String, default: '' },
  targetDate:   { type: String, default: '' },   // YYYY-MM-DD
  targetDateEnd:{ type: String, default: '' },   // izin aralığı için
  swapWithPersonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
  message:      { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'deleted'],
    default: 'pending'
  },
  adminNote:    { type: String, default: '' },
  resolvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt:   { type: Date, default: null },
  deletedAt:    { type: Date, default: null },
  deletedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deletedReason:{ type: String, default: '' },
  purgeAt:      { type: Date, default: null },
}, { timestamps: true });

RequestSchema.index({ fromUserId: 1 });
RequestSchema.index({ serviceId: 1, status: 1 });
RequestSchema.index({ status: 1, createdAt: -1 });
RequestSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
applyHospitalScope(RequestSchema);

module.exports = mongoose.models.Request || mongoose.model('Request', RequestSchema);
