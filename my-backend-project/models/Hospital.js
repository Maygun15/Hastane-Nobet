const mongoose = require('mongoose');

const HospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    contactEmail: { type: String, default: '', trim: true, lowercase: true },
    active: { type: Boolean, default: true, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

HospitalSchema.index({ slug: 1 }, { unique: true });

module.exports = mongoose.models.Hospital || mongoose.model('Hospital', HospitalSchema);
