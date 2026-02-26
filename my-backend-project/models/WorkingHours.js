// models/WorkingHours.js
const mongoose = require('mongoose');

const WorkingHoursSchema = new mongoose.Schema({
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
    ref: 'WorkArea',
    index: true
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
  collection: 'working_hours'
});

// Index for faster queries
WorkingHoursSchema.index({ name: 1 });
WorkingHoursSchema.index({ workAreaId: 1 });
WorkingHoursSchema.index({ status: 1 });

module.exports = mongoose.model('WorkingHours', WorkingHoursSchema);
