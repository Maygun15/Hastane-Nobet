const mongoose = require('mongoose');

// Her AI çağrısını loglar — maliyet takibi ve debug için kritik
const AILogSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Çağrı kaynağı
  action:    { type: String, required: true }, // 'schedule-generate', 'shift-suggest', 'swap-analyze'
  provider:  { type: String, enum: ['openai', 'anthropic', 'other'], default: 'anthropic' },
  model:     { type: String, default: '' },    // 'claude-3-5-haiku-20241022', 'gpt-4o-mini'

  // Prompt ve yanıt
  promptTokens:     { type: Number, default: 0 },
  completionTokens: { type: Number, default: 0 },
  totalTokens:      { type: Number, default: 0 },

  // Maliyet (USD)
  costUsd: { type: Number, default: 0 },

  // Süre
  durationMs: { type: Number, default: 0 },

  // Sonuç
  success:  { type: Boolean, default: true },
  errorCode: { type: String, default: null },

  // İsteğe bağlı bağlam (kısaltılmış prompt özeti, tam prompt saklanmaz)
  context: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  timestamps: true,
});

// 1 yıl sonra otomatik sil
AILogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
AILogSchema.index({ hospitalId: 1, action: 1, createdAt: -1 });
AILogSchema.index({ userId: 1, createdAt: -1 });

const { applyHospitalScope } = require('./plugins/hospitalScope');
applyHospitalScope(AILogSchema);

module.exports = mongoose.models.AILog || mongoose.model('AILog', AILogSchema);
