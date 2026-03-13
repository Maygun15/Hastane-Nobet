const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const HolidaySchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null, index: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    kind: { type: String, enum: ['full', 'arife', 'half'], default: 'full' },
    name: { type: String, default: '' },
    source: { type: String, default: 'nager' },
    year: { type: Number, index: true },
  },
  { timestamps: true }
);

HolidaySchema.index({ hospitalId: 1, date: 1 }, { unique: true });
HolidaySchema.index({ year: 1 });
applyHospitalScope(HolidaySchema);

module.exports = mongoose.models.Holiday || mongoose.model('Holiday', HolidaySchema);
