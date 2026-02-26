// models/CalendarSetting.js
const mongoose = require('mongoose');

const CalendarSettingSchema = new mongoose.Schema({
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
    required: true,
    index: true
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
    required: true,
    index: true
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
CalendarSettingSchema.index({ date: 1 });
CalendarSettingSchema.index({ year: 1, month: 1 });
CalendarSettingSchema.index({ type: 1 });
CalendarSettingSchema.index({ isHoliday: 1 });

module.exports = mongoose.model('CalendarSetting', CalendarSettingSchema);
