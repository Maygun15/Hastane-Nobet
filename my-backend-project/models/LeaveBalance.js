// models/LeaveBalance.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const LeaveBalanceSchema = new mongoose.Schema({
  hospitalId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
  personId:    { type: String, required: true, trim: true, index: true },
  personName:  { type: String, default: '', trim: true },
  leaveTypeId: { type: String, required: true, trim: true, index: true },
  leaveTypeName: { type: String, default: '', trim: true },
  year:        { type: Number, required: true, min: 2020, max: 2100 },
  allocated:   { type: Number, default: 0, min: 0 },  // Hak edilen gün
  used:        { type: Number, default: 0, min: 0 },   // Kullanılan gün
  remaining:   { type: Number, default: 0 },            // allocated - used
}, { timestamps: true });

LeaveBalanceSchema.index({ hospitalId: 1, personId: 1, leaveTypeId: 1, year: 1 }, { unique: true });
applyHospitalScope(LeaveBalanceSchema);

module.exports = mongoose.models.LeaveBalance || mongoose.model('LeaveBalance', LeaveBalanceSchema);
