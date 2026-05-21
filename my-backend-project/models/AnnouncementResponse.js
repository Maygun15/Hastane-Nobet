const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const AnnouncementResponseSchema = new mongoose.Schema({
  hospitalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    default: null,
    index: true,
  },
  notificationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Notification',
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  userName: { type: String, default: '' },
  userEmail: { type: String, default: '' },
  title: { type: String, default: '' },
  responseType: {
    type: String,
    enum: ['ack', 'reply'],
    required: true,
  },
  message: { type: String, default: '', maxlength: 2000 },
}, { timestamps: true });

AnnouncementResponseSchema.index({ hospitalId: 1, notificationId: 1, createdAt: -1 });
AnnouncementResponseSchema.index({ notificationId: 1, userId: 1 }, { unique: true });

applyHospitalScope(AnnouncementResponseSchema);

module.exports = mongoose.models.AnnouncementResponse || mongoose.model('AnnouncementResponse', AnnouncementResponseSchema);
