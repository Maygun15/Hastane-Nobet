const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, index: true },
    serviceId: { type: String, default: '', trim: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: String, default: null },
    createdBy: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

SettingSchema.index({ key: 1, serviceId: 1 }, { unique: true });

module.exports = mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
