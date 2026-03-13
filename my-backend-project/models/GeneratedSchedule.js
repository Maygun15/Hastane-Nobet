const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const GeneratedScheduleSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null, index: true },
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

GeneratedScheduleSchema.index({ hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1 });
applyHospitalScope(GeneratedScheduleSchema);

module.exports = mongoose.models.GeneratedSchedule
  || mongoose.model('GeneratedSchedule', GeneratedScheduleSchema);
