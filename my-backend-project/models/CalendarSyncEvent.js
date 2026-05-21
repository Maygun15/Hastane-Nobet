const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const CalendarSyncEventSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true, index: true },
    googleEventId: { type: String, required: true, trim: true },
    payloadHash: { type: String, default: '', trim: true },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true }
);

CalendarSyncEventSchema.index({ hospitalId: 1, userId: 1, assignmentId: 1 }, { unique: true });

applyHospitalScope(CalendarSyncEventSchema);

module.exports =
  mongoose.models.CalendarSyncEvent ||
  mongoose.model('CalendarSyncEvent', CalendarSyncEventSchema);
