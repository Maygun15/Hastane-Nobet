const mongoose = require('mongoose');

const GeneratedScheduleSchema = new mongoose.Schema(
  {
    sectionId: { type: String, required: true, trim: true, index: true },
    serviceId: { type: String, default: '', trim: true, index: true },
    role: { type: String, default: '', trim: true, index: true },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    sourceScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'MonthlySchedule', default: null },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    algorithm: { type: String, default: 'scheduler-v2' },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

GeneratedScheduleSchema.index({ sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1 });

module.exports = mongoose.models.GeneratedSchedule
  || mongoose.model('GeneratedSchedule', GeneratedScheduleSchema);
