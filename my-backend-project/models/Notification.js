// models/Notification.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const schema = new mongoose.Schema({
  userId:     { type: String, required: true, index: true },
  hospitalId: { type: String, default: '' },
  type:       { type: String, default: 'info' }, // info | success | warning | error
  title:      { type: String, default: '' },
  message:    { type: String, required: true },
  link:       { type: String, default: '' },
  read:       { type: Boolean, default: false, index: true },
  data:       { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

schema.index({ userId: 1, createdAt: -1 });
schema.index({ userId: 1, read: 1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', schema);
