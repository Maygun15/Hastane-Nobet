// models/RequestType.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const RequestTypeSchema = new mongoose.Schema({
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
  code: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['leave', 'schedule', 'shift_swap', 'overtime', 'other'],
    default: 'leave'
  },
  requiresApproval: {
    type: Boolean,
    default: true
  },
  approvalLevel: {
    type: Number,
    default: 1 // 1 = supervisor, 2 = manager, 3 = admin
  },
  maxRequestsPerMonth: {
    type: Number,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  icon: {
    type: String,
    default: 'request'
  },
  color: {
    type: String,
    default: '#3b82f6'
  },
  allowedRoles: [{
    type: String,
    enum: ['user', 'authorized', 'admin'],
    default: 'user'
  }],
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
  collection: 'request_types'
});

// Index for faster queries
RequestTypeSchema.index({ name: 1 });
RequestTypeSchema.index({ category: 1 });
RequestTypeSchema.index({ isActive: 1 });
applyHospitalScope(RequestTypeSchema);

module.exports = mongoose.model('RequestType', RequestTypeSchema);
