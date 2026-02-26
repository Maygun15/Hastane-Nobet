// models/LeaveType.js
const mongoose = require('mongoose');

const LeaveTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
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
    unique: true,
    sparse: true,
    trim: true
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
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: true,
  collection: 'leave_types'
});

// Index for faster queries
LeaveTypeSchema.index({ name: 1 });
LeaveTypeSchema.index({ code: 1 });
LeaveTypeSchema.index({ category: 1 });
LeaveTypeSchema.index({ isActive: 1 });

module.exports = mongoose.model('LeaveType', LeaveTypeSchema);
