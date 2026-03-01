// models/ScheduleRules.js
const mongoose = require('mongoose');

const ScheduleRulesSchema = new mongoose.Schema(
  {
    sectionId: { type: String, required: true, trim: true },
    serviceId: { type: String, default: '', trim: true },
    role: { type: String, default: '', trim: true },

    enabled: { type: Boolean, default: false },
    maxShiftsPerPerson: { type: Number, default: null },
    minRestDaysBetween: { type: Number, default: 0 },
    maxConsecutiveShifts: { type: Number, default: null },
    restrictedDays: { type: [String], default: [] },
    allowedHours: {
      start: { type: String, default: '00:00' },
      end: { type: String, default: '23:59' },
    },

    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

ScheduleRulesSchema.index(
  { sectionId: 1, serviceId: 1, role: 1 },
  { unique: true }
);

module.exports = mongoose.models.ScheduleRules
  || mongoose.model('ScheduleRules', ScheduleRulesSchema);
