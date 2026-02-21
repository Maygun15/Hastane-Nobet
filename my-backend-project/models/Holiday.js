const mongoose = require('mongoose');

const HolidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD
    kind: { type: String, enum: ['full', 'arife', 'half'], default: 'full' },
    name: { type: String, default: '' },
    source: { type: String, default: 'nager' },
    year: { type: Number, index: true },
  },
  { timestamps: true }
);

HolidaySchema.index({ date: 1 }, { unique: true });
HolidaySchema.index({ year: 1 });

module.exports = mongoose.models.Holiday || mongoose.model('Holiday', HolidaySchema);
