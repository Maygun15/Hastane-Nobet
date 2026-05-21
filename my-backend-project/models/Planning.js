const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const planningSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      default: null,
      index: true,
    },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String, required: true },   // YYYY-MM-DD
    status: {
      type: String,
      enum: ['draft', 'active', 'completed', 'cancelled'],
      default: 'active',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    assignedPersonnel: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Person' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Listeleme ve sıralama sorguları için
planningSchema.index({ hospitalId: 1, status: 1, createdAt: -1 });
planningSchema.index({ hospitalId: 1, priority: 1 });

applyHospitalScope(planningSchema);

module.exports = mongoose.model('Planning', planningSchema);
