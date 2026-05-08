// models/WorkingHours.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const WorkingHoursSchema = new mongoose.Schema({
  hospitalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    default: null,
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  startTime: {
    type: String, // HH:MM format
    required: true
  },
  endTime: {
    type: String, // HH:MM format
    required: true
  },
  totalHours: {
    type: Number,
    default: 8
  },
  workAreaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkArea'
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true,
  collection: 'working_hours'
});

// Index for faster queries
WorkingHoursSchema.index({ name: 1 });
WorkingHoursSchema.index({ status: 1 });
applyHospitalScope(WorkingHoursSchema);

module.exports = mongoose.models.WorkingHours || mongoose.model('WorkingHours', WorkingHoursSchema);
