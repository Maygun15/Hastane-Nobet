const mongoose = require('mongoose');

// Personel bazlı AI öğrenme verisi — AI'ın çizelge üretirken kullandığı tercihler
const AIPreferenceSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null, index: true },
  personId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Tercih edilen vardiya saatleri
  preferredShiftCodes: [{ type: String }],   // ['SABAH', 'OGLEN']
  avoidedShiftCodes:   [{ type: String }],   // ['GECE']

  // Tercih edilen günler (0=Pazar, 1=Pazartesi, ..., 6=Cumartesi)
  preferredWeekdays: [{ type: Number, min: 0, max: 6 }],
  avoidedWeekdays:   [{ type: Number, min: 0, max: 6 }],

  // Ardışık gece sınırı (kişisel)
  maxConsecutiveNights: { type: Number, default: null },

  // Haftalık maksimum saat (kişisel override)
  maxWeeklyHours: { type: Number, default: null },

  // AI tarafından çıkarılan örüntüler (otomatik güncellenir)
  learnedPatterns: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Manuel not (admin tarafından girilir)
  adminNote: { type: String, default: '' },

  // Güven skoru — ne kadar veriye dayalı (0-1)
  confidenceScore: { type: Number, default: 0, min: 0, max: 1 },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, {
  timestamps: true,
});

AIPreferenceSchema.index({ hospitalId: 1, personId: 1 }, { unique: true });

module.exports = mongoose.models.AIPreference || mongoose.model('AIPreference', AIPreferenceSchema);
