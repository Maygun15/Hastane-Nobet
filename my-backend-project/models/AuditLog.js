const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  userId: { type: String, default: '' },
  action: { type: String, default: '' },
  endpoint: { type: String, default: '' },
  method: { type: String, default: '' },
  ip: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
