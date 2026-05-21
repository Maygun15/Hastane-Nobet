const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const AssignmentSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    sourceScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'MonthlySchedule', default: null, index: true },
    sectionId: { type: String, required: true, trim: true },
    serviceId: { type: String, default: '', trim: true },
    role: { type: String, default: '', trim: true },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    date: { type: String, required: true, trim: true }, // YYYY-MM-DD — ISO leksikografik sıralama çalışır
    day: { type: Number, min: 1, max: 31 },
    weekday: { type: Number, min: 0, max: 6 },
    rowId: { type: String, default: '', trim: true },
    shiftId: { type: String, default: '', trim: true },
    shiftCode: { type: String, default: '', trim: true },
    roleLabel: { type: String, default: '', trim: true },
    taskKey: { type: String, required: true, trim: true },
    personId: { type: String, default: '', trim: true },
    personName: { type: String, default: '', trim: true },
    personKey: { type: String, required: true, trim: true },
    hours: { type: Number, default: 0 },
    pinned: { type: Boolean, default: false },
    supervisorTask: { type: Boolean, default: false },
    note: { type: String, default: '', trim: true },
    source: { type: String, default: 'monthlySchedule', trim: true },
    status: { type: String, default: 'active', trim: true },
    overrideReason: { type: String, default: '', trim: true },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// Benzersizlik kısıtı
AssignmentSchema.index(
  { hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, date: 1, taskKey: 1, personKey: 1 },
  { unique: true }
);
// Kişi takvimi sorgusu: /person-calendar
AssignmentSchema.index({ hospitalId: 1, personId: 1, date: 1 });
// Günlük/aylık servis görünümü
AssignmentSchema.index({ hospitalId: 1, sectionId: 1, serviceId: 1, year: 1, month: 1 });
// Tarih aralığı sorguları (date YYYY-MM-DD leksikografik karşılaştırma)
AssignmentSchema.index({ hospitalId: 1, sectionId: 1, serviceId: 1, date: 1 });
// Durum + tarih sıralaması
AssignmentSchema.index({ hospitalId: 1, status: 1, date: 1 });

applyHospitalScope(AssignmentSchema);

module.exports = mongoose.models.Assignment
  || mongoose.model('Assignment', AssignmentSchema);
