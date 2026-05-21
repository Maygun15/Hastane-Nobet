// models/Notification.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const schema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
  type:       {
    type: String,
    enum: ['info', 'success', 'warning', 'error', 'announcement', 'request_new',
           'request_approved', 'request_rejected', 'leave_approved', 'leave_rejected',
           'shift_change', 'swap_approved'],
    default: 'info',
  },
  title:      { type: String, default: '', maxlength: 200 },
  message:    { type: String, required: true, maxlength: 2000 },
  link:       { type: String, default: '', maxlength: 500 },
  read:       { type: Boolean, default: false },
  data:       { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

// Birincil sorgu: kullanıcının son X bildirimi — tek compound index yeterli
schema.index({ hospitalId: 1, userId: 1, createdAt: -1 });
// Okunmamış filtresi
schema.index({ hospitalId: 1, userId: 1, read: 1 });
// TTL: 30 gün sonra otomatik sil
schema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

applyHospitalScope(schema);

module.exports = mongoose.models.Notification || mongoose.model('Notification', schema);
