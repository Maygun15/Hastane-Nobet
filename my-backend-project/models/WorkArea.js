// models/WorkArea.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const WorkAreaSchema = new mongoose.Schema({
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
}, {
  timestamps: true,
  collection: 'work_areas'
});

// Index for faster queries
WorkAreaSchema.index({ name: 1 });
WorkAreaSchema.index({ status: 1 });
applyHospitalScope(WorkAreaSchema);

module.exports = mongoose.models.WorkArea || mongoose.model('WorkArea', WorkAreaSchema);
