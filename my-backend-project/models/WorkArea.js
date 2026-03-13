// models/WorkArea.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const WorkAreaSchema = new mongoose.Schema({
  hospitalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    default: null,
    index: true,
  },
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
    default: '#3b82f6'
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  serviceIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  }],
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
  collection: 'work_areas'
});

// Index for faster queries
WorkAreaSchema.index({ name: 1 });
WorkAreaSchema.index({ status: 1 });
applyHospitalScope(WorkAreaSchema);

module.exports = mongoose.model('WorkArea', WorkAreaSchema);
