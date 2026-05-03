const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  hospitalId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null, index: true },
  userId:       { type: String, default: '' },
  action:       { type: String, default: '' },
  endpoint:     { type: String, default: '' },
  method:       { type: String, default: '' },
  statusCode:   { type: Number, default: null },
  responseTime: { type: Number, default: null }, // ms
  ip:           { type: String, default: '' },
  requestId:    { type: String, default: '', index: true },
  changes:      { type: mongoose.Schema.Types.Mixed, default: null }, // { before, after }
  createdAt:    { type: Date, default: Date.now, index: true },
});

// 90 gün sonra otomatik sil
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
AuditLogSchema.index({ hospitalId: 1, createdAt: -1 });
AuditLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
