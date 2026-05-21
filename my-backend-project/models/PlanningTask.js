const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const subtaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
  },
  { _id: true }
);

const planningTaskSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      default: null,
      index: true,
    },
    planningId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Planning',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    startDate: { type: String, default: '' }, // YYYY-MM-DD
    dueDate: { type: String, default: '' },   // YYYY-MM-DD
    completedDate: { type: String, default: null },
    status: {
      type: String,
      enum: ['todo', 'in-progress', 'review', 'completed'],
      default: 'todo',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    estimatedHours: { type: Number, min: 0, default: null },
    actualHours: { type: Number, min: 0, default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    assignedToName: { type: String, default: '' },
    subtasks: [subtaskSchema],
    hasConflict: { type: Boolean, default: false },
    conflictWith: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PlanningTask' }],
      validate: { validator: (v) => v.length <= 100, message: 'En fazla 100 çakışma kaydedilebilir' },
      default: [],
    },
  },
  { timestamps: true }
);

applyHospitalScope(planningTaskSchema);

module.exports = mongoose.model('PlanningTask', planningTaskSchema);
