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
    trim: true,
    uppercase: true,
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
  allowedRoles: {
    type: [String],
    enum: ['user', 'authorized', 'admin'],
    default: ['user'], // dizi varsayılanı — item-level default çalışmıyor
  },
  notes: {
    type: String,
    default: '',
    maxlength: 1000,
  },
}, {
  timestamps: true,
  collection: 'request_types'
});

// Boş string sparse unique index'te çakışmaya yol açar — undefined'a çevir
RequestTypeSchema.pre('save', function (next) {
  if (this.code === '') this.code = undefined;
  next();
});

// hospitalId prefix'li index'ler — scope'suz tekil index'ler kullanılmaz
RequestTypeSchema.index({ hospitalId: 1, name: 1 });
RequestTypeSchema.index({ hospitalId: 1, category: 1 });
RequestTypeSchema.index({ hospitalId: 1, isActive: 1 });
// Hastane kapsamında talep tipi kodu benzersiz olmalı
RequestTypeSchema.index({ hospitalId: 1, code: 1 }, { unique: true, sparse: true });
applyHospitalScope(RequestTypeSchema);

module.exports = mongoose.models.RequestType || mongoose.model('RequestType', RequestTypeSchema);
