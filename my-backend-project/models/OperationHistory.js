const mongoose = require('mongoose');

const OperationHistorySchema = new mongoose.Schema(
  {
    hospitalId: { type: String, required: true, index: true },
    sectionId: { type: String, required: true, trim: true },
    serviceId: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },

    operationType: { type: String, required: true, trim: true, index: true },
    summary: { type: String, default: '' },
    entityRefs: { type: mongoose.Schema.Types.Mixed, default: {} },
    affectedCollections: { type: [String], default: ['MonthlySchedule', 'Assignment'] },

    targetCollection: { type: String, default: 'MonthlySchedule' },
    targetDocumentId: { type: String, default: null },
    sourceScheduleId: { type: String, default: null },

    beforeSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    afterSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },

    reversible: { type: Boolean, default: true, index: true },
    undoStatus: {
      type: String,
      enum: ['available', 'undone', 'expired', 'conflict', 'not_supported'],
      default: 'available',
      index: true,
    },
    notReversibleReason: { type: String, default: '' },

    createdBy: { type: String, default: null, index: true },
    createdByName: { type: String, default: '' },
    undoneBy: { type: String, default: null },
    undoneByName: { type: String, default: '' },
    undoneAt: { type: Date, default: null },
    undoReason: { type: String, default: '' },
    undoOperationId: { type: String, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

OperationHistorySchema.index(
  {
    hospitalId: 1,
    sectionId: 1,
    serviceId: 1,
    role: 1,
    year: 1,
    month: 1,
    createdAt: -1,
  }
);

module.exports = mongoose.models.OperationHistory
  || mongoose.model('OperationHistory', OperationHistorySchema);
