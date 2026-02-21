// models/MonthlySchedule.js
const mongoose = require('mongoose');

const MonthlyScheduleSchema = new mongoose.Schema(
  {
    sectionId: { type: String, required: true, trim: true }, // ör: calisma-cizelgesi
    serviceId: { type: String, default: '', trim: true },     // boş => tüm servisler
    role: { type: String, default: '', trim: true },           // Nurse | Doctor vb.
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },  // 1..12
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    }, // frontend'in gönderdiği tüm çizelge payload'u
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    }, // opsiyonel ek bilgiler
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

MonthlyScheduleSchema.index(
  { sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1 },
  { unique: true }
);

module.exports = mongoose.models.MonthlySchedule
  || mongoose.model('MonthlySchedule', MonthlyScheduleSchema);

