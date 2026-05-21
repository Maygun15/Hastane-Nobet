// models/LeaveType.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const LeaveTypeSchema = new mongoose.Schema({
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
  color: {
    type: String,
    default: '#ef4444'
  },
  code: {
    type: String,
    trim: true,
    uppercase: true,
  },
  category: {
    type: String,
    enum: ['annual', 'sick', 'personal', 'maternity', 'unpaid', 'other'],
    default: 'annual'
  },
  maxDaysPerYear: {
    type: Number,
    default: null
  },
  requiresApproval: {
    type: Boolean,
    default: true
  },
  isDeductible: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  paidLeave: {
    type: Boolean,
    default: true
  },
  notes: {
    type: String,
    default: '',
    maxlength: 1000,
  },
}, {
  timestamps: true,
  collection: 'leave_types'
});

// Boş string sparse unique index'te çakışmaya yol açar — undefined'a çevir
LeaveTypeSchema.pre('save', function (next) {
  if (this.code === '') this.code = undefined;
  next();
});

// Hastane kapsamında izin kodu benzersiz olmalı
LeaveTypeSchema.index({ hospitalId: 1, code: 1 }, { unique: true, sparse: true });
LeaveTypeSchema.index({ hospitalId: 1, name: 1 });
LeaveTypeSchema.index({ hospitalId: 1, isActive: 1 });
applyHospitalScope(LeaveTypeSchema);

module.exports = mongoose.models.LeaveType || mongoose.model('LeaveType', LeaveTypeSchema);
