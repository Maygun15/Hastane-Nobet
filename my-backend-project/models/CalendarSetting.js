// models/CalendarSetting.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const CalendarSettingSchema = new mongoose.Schema({
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
  year: {
    type: Number,
    required: true
  },
  month: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    enum: ['holiday', 'special', 'weekend', 'working_day'],
    default: 'holiday'
  },
  date: {
    type: Date,
    required: true
  },
  isHoliday: {
    type: Boolean,
    default: true
  },
  isReligious: {
    type: Boolean,
    default: false
  },
  startDate: {
    type: Date
  },
  endDate: {
    type: Date
  },
  affectWorkingHours: {
    type: Boolean,
    default: true
  },
  color: {
    type: String,
    default: '#ff6b6b'
  },
  notes: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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
  collection: 'calendar_settings'
});

// Index for faster queries
CalendarSettingSchema.index({ hospitalId: 1, date: 1 });
CalendarSettingSchema.index({ hospitalId: 1, year: 1, month: 1 });
CalendarSettingSchema.index({ hospitalId: 1, type: 1 });
CalendarSettingSchema.index({ hospitalId: 1, isHoliday: 1 });
applyHospitalScope(CalendarSettingSchema);

module.exports = mongoose.model('CalendarSetting', CalendarSettingSchema);
