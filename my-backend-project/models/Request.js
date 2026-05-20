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
  swapWithPersonId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },

  // Takas talebi için hangi vardiyaların değiştirileceği
  swapSectionId:      { type: String, default: '' },
  swapMyDate:         { type: String, default: '' },   // YYYY-MM-DD
  swapMyShiftId:      { type: String, default: '' },   // shift kodu
  swapMyShiftLabel:   { type: String, default: '' },
  swapTargetDate:     { type: String, default: '' },   // YYYY-MM-DD
  swapTargetShiftId:  { type: String, default: '' },
  swapTargetShiftLabel: { type: String, default: '' },
  swapExecuted:       { type: Boolean, default: false },

  // Karşı tarafın (swapWithPersonId) yanıt durumu — peer-approval flow
  swapWithPersonName: { type: String, default: '' },
  peerStatus: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending',
  },
  peerRespondedAt: { type: Date, default: null },
  peerNote:        { type: String, default: '' },

  // İzin talebi için izin türü kodu
  leaveTypeCode:      { type: String, default: '' },   // 'YILLIK', 'HASTALIK' vb.

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
RequestSchema.index({ hospitalId: 1, serviceId: 1, status: 1 });
RequestSchema.index({ hospitalId: 1, status: 1, createdAt: -1 });
RequestSchema.index({ hospitalId: 1, fromPersonId: 1, createdAt: -1 });
RequestSchema.index({ hospitalId: 1, swapWithPersonId: 1, status: 1 });
RequestSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
applyHospitalScope(RequestSchema);

module.exports = mongoose.models.Request || mongoose.model('Request', RequestSchema);
