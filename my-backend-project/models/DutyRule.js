// models/DutyRule.js
const mongoose = require('mongoose');
const { applyHospitalScope } = require('./plugins/hospitalScope');

const DutyRuleSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      default: null,
      index: true,
    },
    // Departman bilgileri
    departman: {
      type: String,
      required: true,
      enum: ['Acil Servis', 'Ameliyathane', 'Laboratuvar', 'Radyoloji', 'Anestezi', 'YBÜ', 'Diğer'],
      default: 'Acil Servis'
    },
    serviceId: {
      type: String,
      required: true
    },
    sectionId: {
      type: String,
      default: ''
    },
    role: {
      type: String,
      default: ''
    },
    description: String,
    rules: [
      new mongoose.Schema({
        id: { type: String },
        type: { type: String },
        enabled: { type: Boolean, default: true },
        value: { type: mongoose.Schema.Types.Mixed }
      }, { _id: false })
    ],
    weights: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    // TEMEL KURALLAR
    basicRules: {
      maxConsecutiveDays: {
        type: Number,
        default: 6,
        min: 1,
        max: 10
      },
      minRestHours: {
        type: Number,
        default: 12,
        min: 8,
        max: 24
      },
      maxWeeklyHours: {
        type: Number,
        default: 72,
        min: 40,
        max: 100
      },
      maxDailyHours: {
        type: Number,
        default: 24,
        min: 8,
        max: 24
      },
      noDoubleShiftPerDay: {
        type: Boolean,
        default: true
      },
      nightShiftFollowUp: {
        type: String,
        enum: ['none', 'min12hours', 'min24hours', 'rest'],
        default: 'min24hours'
      }
    },

    // İZİN KURALLARI
    leaveRules: {
      type: Map,
      of: new mongoose.Schema({
        code: String,
        name: String,
        description: String,
        countAsWorked: Boolean,      // Çalışma saatine sayılır mı?
        allowDuty: Boolean,          // Nöbet yazılabilir mi?
        deductFromAnnual: Boolean,   // Yıllıktan düşülür mü?
        requiresApproval: Boolean    // Onay gerekli mi?
      }, { _id: false }),
      default: new Map([
        ['AN', {
          code: 'AN',
          name: 'Ay Sonu Nöbeti',
          description: 'Bir önceki ayın son gün nöbeti',
          countAsWorked: true,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: false
        }],
        ['Bİ', {
          code: 'Bİ',
          name: 'Babalık İzni',
          countAsWorked: true,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: true
        }],
        ['Dİ', {
          code: 'Dİ',
          name: 'Doğum İzni',
          countAsWorked: true,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: true
        }],
        ['E', {
          code: 'E',
          name: 'Eğitim',
          countAsWorked: true,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: true
        }],
        ['Eİ', {
          code: 'Eİ',
          name: 'Evlilik İzni',
          countAsWorked: true,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: true
        }],
        ['G', {
          code: 'G',
          name: 'Görevli',
          countAsWorked: true,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: false
        }],
        ['H', {
          code: 'H',
          name: 'Yatış',
          countAsWorked: false,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: false
        }],
        ['R', {
          code: 'R',
          name: 'Rapor',
          countAsWorked: false,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: false
        }],
        ['RE', {
          code: 'RE',
          name: 'Refakat',
          countAsWorked: false,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: false
        }],
        ['S', {
          code: 'S',
          name: 'Sevk',
          countAsWorked: false,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: false
        }],
        ['Sİ', {
          code: 'Sİ',
          name: 'Sendika İzni',
          countAsWorked: true,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: false
        }],
        ['İ', {
          code: 'İ',
          name: 'Nöbet İzni',
          countAsWorked: false,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: false
        }],
        ['İİ', {
          code: 'İİ',
          name: 'İdari İzin',
          countAsWorked: false,
          allowDuty: false,
          deductFromAnnual: false,
          requiresApproval: false
        }],
        ['Ü', {
          code: 'Ü',
          name: 'Ücretsiz İzin',
          countAsWorked: false,
          allowDuty: false,
          deductFromAnnual: true,
          requiresApproval: false
        }],
        ['Y', {
          code: 'Y',
          name: 'Yıllık İzin',
          countAsWorked: false,
          allowDuty: false,
          deductFromAnnual: true,
          requiresApproval: true
        }]
      ])
    },

    // VARDIYA KURALLARI
    shiftRules: {
      type: Map,
      of: new mongoose.Schema({
        code: String,
        name: String,
        start: String,              // HH:MM
        end: String,                // HH:MM
        hours: Number,              // Vardiya saati
        isNight: Boolean,           // Gece vardiyası mı?
        nextDayOptions: [String],   // Ertesi gün yapılabilecek vardiyalar
        preferredNext: [String],    // Tercih edilen ertesi vardiyalar
        maxConsecutive: Number,     // Max ardışık gün
        weekendAllowed: Boolean,    // Haftasonu yapılabilir mi?
        minRestAfter: Number        // Sonrasında minimum dinlenme (saat)
      }, { _id: false }),
      default: new Map([
        ['M', {
          code: 'M',
          name: 'Sabah Vardiyası',
          start: '08:00',
          end: '16:00',
          hours: 8,
          isNight: false,
          nextDayOptions: ['M', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'N', 'V1', 'V2'],
          preferredNext: ['M', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
          maxConsecutive: 6,
          weekendAllowed: true,
          minRestAfter: 0
        }],
        ['M4', {
          code: 'M4',
          name: 'Akşam Vardiyası',
          start: '16:00',
          end: '00:00',
          hours: 8,
          isNight: false,
          nextDayOptions: ['M', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
          preferredNext: ['M', 'M1', 'M2', 'M3'],
          maxConsecutive: 3,
          weekendAllowed: false,
          minRestAfter: 0
        }],
        ['N', {
          code: 'N',
          name: 'Gece Vardiyası',
          start: '08:00',
          end: '08:00',
          hours: 24,
          isNight: true,
          nextDayOptions: [],         // Ertesi gün izin
          preferredNext: [],
          maxConsecutive: 1,          // Gece üstüne gece yasak
          weekendAllowed: true,
          minRestAfter: 24            // 24 saat dinlenme
        }],
        ['V1', {
          code: 'V1',
          name: 'Uzun Vardiya',
          start: '08:00',
          end: '00:00',
          hours: 16,
          isNight: false,
          nextDayOptions: ['M', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
          preferredNext: ['M', 'M1', 'M2', 'M3'],
          maxConsecutive: 2,
          weekendAllowed: true,
          minRestAfter: 12
        }],
        ['V2', {
          code: 'V2',
          name: 'Gece Vardiyası Alt.',
          start: '08:00',
          end: '08:00',
          hours: 24,
          isNight: true,
          nextDayOptions: [],
          preferredNext: [],
          maxConsecutive: 1,
          weekendAllowed: true,
          minRestAfter: 24
        }]
      ])
    },

    // GÖREV GEREKSİNİMLERİ
    taskRequirements: {
      type: Map,
      of: new mongoose.Schema({
        name: String,
        minPersonnelPerShift: mongoose.Schema.Types.Mixed, // Number veya { weekday, weekend }
        allowedRoles: [String],      // Yapabilen roller
        allowedPersonnel: [String],  // Spesifik personel (null = tümü)
        rotationRequired: Boolean,   // Döner görev mi?
        priority: String,            // high, medium, low
        criticalGoal: Boolean        // Hedef karşılaması zorunlu mu?
      }, { _id: false }),
      default: new Map([
        ['Triaj', {
          name: 'Triaj',
          minPersonnelPerShift: 1,
          allowedRoles: ['Hemşire'],
          allowedPersonnel: null,
          rotationRequired: true,
          priority: 'high',
          criticalGoal: true
        }],
        ['Resüsitasyon', {
          name: 'Resüsitasyon',
          minPersonnelPerShift: 2,
          allowedRoles: ['Hemşire', 'Doktor'],
          allowedPersonnel: null,
          rotationRequired: true,
          priority: 'high',
          criticalGoal: true
        }],
        ['Kırmızı Alan', {
          name: 'Kırmızı Alan',
          minPersonnelPerShift: 1,
          allowedRoles: ['Hemşire', 'Doktor', 'Sağlık Memuru'],
          allowedPersonnel: null,
          rotationRequired: true,
          priority: 'high',
          criticalGoal: true
        }],
        ['Yeşil', {
          name: 'Yeşil Alan',
          minPersonnelPerShift: { weekday: 3, weekend: 4 },
          allowedRoles: ['Hemşire', 'Doktor'],
          allowedPersonnel: null,
          rotationRequired: true,
          priority: 'high',
          criticalGoal: true
        }]
      ])
    },

    // PERSONEL KURALLARI
    personnelRules: {
      seniorityExemptions: [String],        // Muaf görevler
      pregnantExemptions: [String],         // Hamile için muaf
      reportRequirements: [String],         // Rapor olanlar için
      rotationRequired: [String]            // Zorunlu döner görevler
    },

    // META
    metadata: {
      version: {
        type: String,
        default: '1.0'
      },
      isActive: {
        type: Boolean,
        default: true
      },
      notes: String
    },

    createdBy: String,
    updatedBy: String
  },
  {
    timestamps: true
  }
);

// Index
DutyRuleSchema.index({ hospitalId: 1, serviceId: 1, departman: 1 });
applyHospitalScope(DutyRuleSchema);

module.exports = mongoose.model('DutyRule', DutyRuleSchema);
