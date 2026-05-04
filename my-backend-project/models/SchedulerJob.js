// models/SchedulerJob.js
const mongoose = require('mongoose');

const SchedulerJobSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', index: true },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status:     { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued', index: true },
    params: {
      sectionId:  String,
      serviceId:  String,
      role:       String,
      year:       Number,
      month:      Number,
      dryRun:     Boolean,
    },
    result:     { type: mongoose.Schema.Types.Mixed, default: null },
    error:      { type: String, default: null },
    startedAt:  { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
  },
  {
    timestamps: true,
    expireAfterSeconds: 60 * 60 * 24, // TTL 24h
  }
);

// TTL index on createdAt
SchedulerJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

module.exports = mongoose.models.SchedulerJob || mongoose.model('SchedulerJob', SchedulerJobSchema);
