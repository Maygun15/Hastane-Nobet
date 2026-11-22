// models/ScheduleChange.js
// Çizelge işlem geçmişi (İP-5 / E): kim, hangi nöbeti, ne zaman değiştirdi; yayın sürümleri.
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const SlotSchema = new mongoose.Schema(
  {
    date: String,
    rowId: String,
    shiftCode: String,
    personId: String,
    personName: String,
  },
  { _id: false }
);

const ScheduleChangeSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    sectionId: { type: String, required: true },
    serviceId: { type: String, default: '' },
    role: { type: String, default: '' },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'MonthlySchedule', default: null },
    // edit: içerik değişikliği · generate: otomatik planlama · undo: geri alma
    // publish: yayın (version) · unpublish: taslağa alma
    kind: { type: String, enum: ['edit', 'generate', 'undo', 'publish', 'unpublish'], required: true },
    source: { type: String, default: '' },        // monthly-save, assign, unassign, scheduler, undo …
    contentRevision: { type: Number, default: null },
    publishVersion: { type: Number, default: null },
    added: { type: [SlotSchema], default: [] },
    removed: { type: [SlotSchema], default: [] },
    addedCount: { type: Number, default: 0 },
    removedCount: { type: Number, default: 0 },
    // Yalnız yayın olaylarında: yayınlanan atamaların kısa anahtarları (sonraki yayının farkı için).
    snapshot: { type: [String], default: undefined, select: false },
    by: { type: String, default: null },
    byName: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'at', updatedAt: false } }
);

ScheduleChangeSchema.index({ hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1, at: -1 });
ScheduleChangeSchema.index({ hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1, kind: 1, publishVersion: -1 });
// Aynı kapsamda aynı yayın sürümü bir kez (eş zamanlı iki yayın isteğinde ikincisi "zaten yayınlandı").
ScheduleChangeSchema.index(
  { hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1, publishVersion: 1 },
  { unique: true, partialFilterExpression: { kind: 'publish' }, name: 'publish_version_once' }
);
applyHospitalScope(ScheduleChangeSchema);

module.exports = mongoose.models.ScheduleChange || mongoose.model('ScheduleChange', ScheduleChangeSchema);
