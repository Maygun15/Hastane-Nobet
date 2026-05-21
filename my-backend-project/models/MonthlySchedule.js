// models/MonthlySchedule.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

// Operational monthly read model:
// editable roster input + assignment snapshot for existing calendar/editor flows.
const MonthlyScheduleSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    sectionId: { type: String, required: true, trim: true }, // ör: calisma-cizelgesi
    serviceId: { type: String, default: '', trim: true },     // boş => tüm servisler
    role: { type: String, default: '', trim: true },           // Nurse | Doctor vb.
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },  // 1..12
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    }, // frontend'in gönderdiği tüm çizelge payload'u
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    }, // opsiyonel ek bilgiler
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

MonthlyScheduleSchema.index(
  { hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1 },
  { unique: true }
);
// BSON 16MB limitine karşı koruma — Mixed data alanı büyük hastanelerde şişebilir
MonthlyScheduleSchema.pre('save', function checkBsonSize(next) {
  try {
    const bson = require('bson');
    const size = bson.calculateObjectSize(this.toObject());
    if (size > 12 * 1024 * 1024) { // 12MB — 16MB limitinin altında uyar
      return next(new Error(`Çizelge belgesi çok büyük (${Math.round(size / 1024)}KB). Lütfen aralığı küçültün.`));
    }
  } catch { /* bson paketi yoksa atla */ }
  return next();
});

applyHospitalScope(MonthlyScheduleSchema);

// Parent silinince bağlı Assignment dökümanlarını temizle
MonthlyScheduleSchema.pre('deleteOne', { document: true, query: false }, async function () {
  const Assignment = mongoose.model('Assignment');
  await Assignment.deleteMany({ sourceScheduleId: this._id });
});
MonthlyScheduleSchema.pre('findOneAndDelete', async function () {
  const doc = await this.model.findOne(this.getFilter()).select('_id').lean();
  if (doc) {
    const Assignment = mongoose.model('Assignment');
    await Assignment.deleteMany({ sourceScheduleId: doc._id });
  }
});
// deleteMany ile toplu silme — orphan Assignment önleme
MonthlyScheduleSchema.pre('deleteMany', async function () {
  const docs = await this.model.find(this.getFilter()).select('_id').lean();
  if (docs.length) {
    const ids = docs.map((d) => d._id);
    const Assignment = mongoose.model('Assignment');
    await Assignment.deleteMany({ sourceScheduleId: { $in: ids } });
  }
});

module.exports = mongoose.models.MonthlySchedule
  || mongoose.model('MonthlySchedule', MonthlyScheduleSchema);
