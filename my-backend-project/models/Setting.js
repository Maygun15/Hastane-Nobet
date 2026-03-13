const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const SettingSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null, index: true },
    key: { type: String, required: true, trim: true, index: true },
    serviceId: { type: String, default: '', trim: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: String, default: null },
    createdBy: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

SettingSchema.index({ hospitalId: 1, key: 1, serviceId: 1 }, { unique: true });
applyHospitalScope(SettingSchema);

module.exports = mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
