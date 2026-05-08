const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const AssignmentSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    sourceScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'MonthlySchedule', default: null, index: true },
    sectionId: { type: String, required: true, trim: true, index: true },
    serviceId: { type: String, default: '', trim: true, index: true },
    role: { type: String, default: '', trim: true, index: true },
    year: { type: Number, required: true, min: 2000, max: 2100, index: true },
    month: { type: Number, required: true, min: 1, max: 12, index: true },
    date: { type: String, required: true, trim: true, index: true }, // YYYY-MM-DD
    day: { type: Number, min: 1, max: 31 },
    weekday: { type: Number, min: 0, max: 6 },
    rowId: { type: String, default: '', trim: true },
    shiftId: { type: String, default: '', trim: true },
    shiftCode: { type: String, default: '', trim: true },
    roleLabel: { type: String, default: '', trim: true },
    taskKey: { type: String, required: true, trim: true, index: true },
    personId: { type: String, default: '', trim: true, index: true },
    personName: { type: String, default: '', trim: true },
    personKey: { type: String, required: true, trim: true, index: true },
    hours: { type: Number, default: 0 },
    pinned: { type: Boolean, default: false },
    supervisorTask: { type: Boolean, default: false },
    note: { type: String, default: '', trim: true },
    source: { type: String, default: 'monthlySchedule', trim: true, index: true },
    status: { type: String, default: 'active', trim: true, index: true },
    overrideReason: { type: String, default: '', trim: true },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

AssignmentSchema.index(
  { hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, date: 1, taskKey: 1, personKey: 1 },
  { unique: true }
);

applyHospitalScope(AssignmentSchema);

module.exports = mongoose.models.Assignment
  || mongoose.model('Assignment', AssignmentSchema);
