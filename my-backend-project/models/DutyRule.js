const mongoose = require('mongoose');

const DutyRuleSchema = new mongoose.Schema(
  {
    sectionId: { type: String, required: true, trim: true, index: true },
    serviceId: { type: String, default: '', trim: true, index: true },
    role: { type: String, default: '', trim: true, index: true },
    departman: { type: String, default: '', trim: true, index: true },
    description: { type: String, default: '', trim: true },
    rules: { type: mongoose.Schema.Types.Mixed, default: {} },
    weights: { type: mongoose.Schema.Types.Mixed, default: {} },
    basicRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    leaveRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    shiftRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    taskRequirements: { type: mongoose.Schema.Types.Mixed, default: {} },
    personnelRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    enabled: { type: Boolean, default: true },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

DutyRuleSchema.index({ sectionId: 1, serviceId: 1, role: 1 }, { unique: true });

module.exports = mongoose.models.DutyRule || mongoose.model('DutyRule', DutyRuleSchema);
