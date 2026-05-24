const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const SettingSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    key: { type: String, required: true, trim: true, index: true },
    serviceId: { type: String, default: '', trim: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: String, default: null },
    createdBy: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

SettingSchema.index({ hospitalId: 1, key: 1, serviceId: 1 }, { unique: true });

SettingSchema.pre('save', function () {
  if (this.key === 'leavesV2' && this.value) {
    const approxBytes = Buffer.byteLength(JSON.stringify(this.value), 'utf8');
    if (approxBytes > 12 * 1024 * 1024) {
      throw new Error(`leavesV2 değeri BSON limitine yaklaşıyor (${Math.round(approxBytes / 1024 / 1024)}MB). Veriyi ayırın.`);
    }
  }
});

applyHospitalScope(SettingSchema);

module.exports = mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
