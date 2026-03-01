// services/ruleEngine.js
const DutyRule = require('../models/DutyRule');

class RuleEngine {
  constructor(rules) {
    this.rules = rules || {};
  }

  /**
   * Kuralları yükle
   */
  static async loadRules(serviceId) {
    try {
      const rule = await DutyRule.findOne({ serviceId, 'metadata.isActive': true }).lean();
      return new RuleEngine(rule);
    } catch (err) {
      console.error('[RuleEngine] Kural yükleme hatası:', err);
      return new RuleEngine(null);
    }
  }

  /**
   * 1. Personeli görev için kontrol et
   */
  async checkPersonEligibility(person, taskCode, context = {}) {
    if (!this.rules) {
      return { eligible: true, reason: 'Kurallar yüklenmedi' };
    }

    const { leaveRules, taskRequirements } = this.rules;

    // İzin durumu kontrol
    if (person.leaveType) {
      const leaveRule = leaveRules?.get(person.leaveType);
      if (leaveRule && !leaveRule.allowDuty) {
        return {
          eligible: false,
          reason: `${leaveRule.name} nedeniyle nöbet yazılamaz`
        };
      }
    }

    // Görev gereksinimlerini kontrol et
    if (taskCode) {
      const taskReq = taskRequirements?.get(taskCode);
      if (taskReq?.allowedRoles && person.role) {
        const isRoleAllowed = taskReq.allowedRoles.some(
          role => role.toLowerCase() === person.role.toLowerCase()
        );
        if (!isRoleAllowed) {
          return {
            eligible: false,
            reason: `${taskCode} görevi için ${person.role} yazılamaz`
          };
        }
      }

      // Spesifik personel kontrolü
      if (taskReq?.allowedPersonnel?.length > 0) {
        const isPersonnelAllowed = taskReq.allowedPersonnel.includes(person.id);
        if (!isPersonnelAllowed) {
          return {
            eligible: false,
            reason: `${person.name} bu görev için atanmaya uygun değil`
          };
        }
      }
    }

    // Hamile personel gece nöbeti kontrol
    if (person.pregnant && context.isNightShift) {
      return {
        eligible: false,
        reason: 'Hamile personel gece nöbeti tutamaz'
      };
    }

    // Rapor olanlar hafif görev
    if (person.hasReport && context.taskType === 'heavy') {
      return {
        eligible: false,
        reason: 'Rapor olanlar ağır görevlere yazılamaz'
      };
    }

    return { eligible: true, reason: 'Uygun' };
  }

  /**
   * 2. Ardışık çalışma günlerini kontrol et
   */
  async checkConsecutiveDays(person, assignments, context = {}) {
    const { maxConsecutiveDays } = this.rules?.basicRules || { maxConsecutiveDays: 6 };

    if (!assignments || assignments.length === 0) {
      return { canAssign: true, consecutive: 0, maxAllowed: maxConsecutiveDays };
    }

    let consecutive = 0;
    let lastDate = null;

    // Ters sırayla kontrol (son tarihten başla)
    for (let i = assignments.length - 1; i >= 0; i--) {
      const assign = assignments[i];
      if (assign.personId !== person.id) continue;

      const assignDate = new Date(assign.date);
      
      if (!lastDate) {
        consecutive = 1;
        lastDate = assignDate;
      } else {
        const dayDiff = Math.floor((lastDate - assignDate) / (1000 * 60 * 60 * 24));
        if (dayDiff === 1) {
          consecutive++;
          lastDate = assignDate;
        } else {
          break; // Ardışık dizi kırıldı
        }
      }
    }

    const canAssign = consecutive < maxConsecutiveDays;
    return {
      canAssign,
      consecutive,
      maxAllowed: maxConsecutiveDays,
      message: canAssign
        ? `${consecutive} gün çalışmış (${maxConsecutiveDays} maksimum)`
        : `${consecutive}/${maxConsecutiveDays} gün doldurdu`
    };
  }

  /**
   * 3. Gece nöbeti kurallarını kontrol et
   */
  async checkNightShiftRules(person, date, assignments, context = {}) {
    const { shiftRules } = this.rules;
    if (!shiftRules) return { valid: true };

    const nightCodes = ['N', 'V2'];
    const dateObj = new Date(date);
    const prevDateObj = new Date(dateObj);
    prevDateObj.setDate(prevDateObj.getDate() - 1);
    const prevDateStr = prevDateObj.toISOString().split('T')[0];

    // Önceki gün gece nöbeti yapıp yapmadığını kontrol et
    const hadNightPrevDay = assignments?.some(
      a => a.personId === person.id &&
           a.date === prevDateStr &&
           nightCodes.includes(a.shiftCode)
    );

    if (hadNightPrevDay) {
      return {
        valid: false,
        reason: 'Gece üstüne gece nöbeti yasak (Önceki gün gece tuttu)',
        conflict: 'NIGHT_CONSECUTIVE'
      };
    }

    return { valid: true };
  }

  /**
   * 4. Saatlik limitleri kontrol et
   */
  async calculateAndCheckHours(person, newShiftHours, assignments, context = {}) {
    const {
      maxDailyHours,
      maxWeeklyHours,
      maxConsecutiveDays
    } = this.rules?.basicRules || {
      maxDailyHours: 24,
      maxWeeklyHours: 72,
      maxConsecutiveDays: 6
    };

    const date = context.date || new Date().toISOString().split('T')[0];
    const dateObj = new Date(date);
    const weekStart = new Date(dateObj);
    weekStart.setDate(weekStart.getDate() - dateObj.getDay());

    // Günlük saatleri hesapla
    const dailyHours = (assignments || [])
      .filter(a => a.personId === person.id && a.date === date)
      .reduce((sum, a) => sum + (Number(a.hours) || 0), 0);

    const dailyTotal = dailyHours + (Number(newShiftHours) || 0);

    // Haftalık saatleri hesapla
    const weeklyHours = (assignments || [])
      .filter(a => {
        const aDate = new Date(a.date);
        return a.personId === person.id &&
               aDate >= weekStart &&
               aDate <= dateObj;
      })
      .reduce((sum, a) => sum + (Number(a.hours) || 0), 0);

    const weeklyTotal = weeklyHours + (Number(newShiftHours) || 0);

    return {
      dailyHours: dailyTotal,
      weeklyHours: weeklyTotal,
      withinDailyLimit: dailyTotal <= maxDailyHours,
      withinWeeklyLimit: weeklyTotal <= maxWeeklyHours,
      dailyWarning: dailyTotal > maxDailyHours
        ? `Günlük limit aşacak: ${dailyTotal}/${maxDailyHours}h`
        : null,
      weeklyWarning: weeklyTotal > maxWeeklyHours
        ? `Haftalık limit aşacak: ${weeklyTotal}/${maxWeeklyHours}h`
        : null
    };
  }

  /**
   * 5. Tüm çakışmaları bul
   */
  async getConflicts(person, shift, date, assignments, context = {}) {
    const conflicts = [];

    // Aynı gün çakışması
    const sameDayAssignment = assignments?.find(
      a => a.personId === person.id && a.date === date
    );
    if (sameDayAssignment) {
      conflicts.push({
        type: 'SAME_DAY_CONFLICT',
        severity: 'critical',
        message: `${date} gün: Zaten "${sameDayAssignment.shiftCode}" vardiyası var`
      });
    }

    // Ardışık gün kontrolü
    const consecutive = await this.checkConsecutiveDays(person, assignments);
    if (!consecutive.canAssign) {
      conflicts.push({
        type: 'CONSECUTIVE_LIMIT',
        severity: 'warning',
        message: `Ardışık ${consecutive.consecutive} gün: Maksimum ${consecutive.maxAllowed} gün`
      });
    }

    // Gece nöbeti kontrolü
    const nightCheck = await this.checkNightShiftRules(person, date, assignments);
    if (!nightCheck.valid) {
      conflicts.push({
        type: nightCheck.conflict,
        severity: 'critical',
        message: nightCheck.reason
      });
    }

    // Saatlik limitler
    const hours = await this.calculateAndCheckHours(person, shift?.hours || 8, assignments, { date });
    if (!hours.withinDailyLimit) {
      conflicts.push({
        type: 'DAILY_HOUR_LIMIT',
        severity: 'critical',
        message: hours.dailyWarning
      });
    }
    if (!hours.withinWeeklyLimit) {
      conflicts.push({
        type: 'WEEKLY_HOUR_LIMIT',
        severity: 'warning',
        message: hours.weeklyWarning
      });
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      criticalCount: conflicts.filter(c => c.severity === 'critical').length,
      warningCount: conflicts.filter(c => c.severity === 'warning').length
    };
  }

  /**
   * 6. İzin kurallarını uygula
   */
  async applyLeaveRules(person, date, context = {}) {
    if (!person.leaveType) {
      return { canWork: true, countsAsWorked: false };
    }

    const leaveRule = this.rules?.leaveRules?.get(person.leaveType);
    if (!leaveRule) {
      return { canWork: true, countsAsWorked: false };
    }

    return {
      canWork: leaveRule.allowDuty || false,
      countsAsWorked: leaveRule.countAsWorked || false,
      leaveType: person.leaveType,
      name: leaveRule.name
    };
  }

  /**
   * 7. Vardiya geçişlerini kontrol et
   */
  async validateShiftTransition(person, currentShift, nextShift, gap = 0) {
    if (!this.rules?.shiftRules) {
      return { valid: true };
    }

    const currentShiftRule = this.rules.shiftRules.get(currentShift);
    if (!currentShiftRule) {
      return { valid: true };
    }

    const { minRestAfter, nextDayOptions } = currentShiftRule;

    // Dinlenme süresi kontrol
    if (minRestAfter && gap < minRestAfter) {
      return {
        valid: false,
        reason: `Yeterli dinlenme yok: ${gap}h < ${minRestAfter}h`,
        conflict: 'INSUFFICIENT_REST'
      };
    }

    // Ertesi gün vardiya seçenekleri
    if (nextDayOptions && nextDayOptions.length > 0) {
      if (!nextDayOptions.includes(nextShift)) {
        return {
          valid: false,
          reason: `${currentShift} sonrası ${nextShift} yazılamaz`,
          validOptions: nextDayOptions,
          conflict: 'INVALID_NEXT_SHIFT'
        };
      }
    }

    return { valid: true };
  }

  /**
   * 8. Kuralları test et (Simulator)
   */
  async testRules(testScenario) {
    const results = {
      passed: 0,
      failed: 0,
      warnings: [],
      errors: [],
      details: []
    };

    const { personId, shifts, dates, person } = testScenario;

    if (!person) {
      results.errors.push('Personel bilgisi eksik');
      return results;
    }

    // Her shift'i test et
    for (let i = 0; i < (shifts || []).length; i++) {
      const shift = shifts[i];
      const date = dates[i];

      const conflicts = await this.getConflicts(person, { code: shift, hours: 8 }, date, []);

      if (conflicts.hasConflicts) {
        results.failed++;
        results.details.push({
          date,
          shift,
          status: 'FAIL',
          conflicts: conflicts.conflicts
        });
      } else {
        results.passed++;
        results.details.push({
          date,
          shift,
          status: 'PASS'
        });
      }
    }

    return results;
  }

  /**
   * Kuralları string olarak getir (Admin UI için)
   */
  getRulesAsJSON() {
    if (!this.rules) return null;

    return {
      departman: this.rules.departman,
      basicRules: this.rules.basicRules,
      leaveRules: Object.fromEntries(this.rules.leaveRules || []),
      shiftRules: Object.fromEntries(this.rules.shiftRules || []),
      taskRequirements: Object.fromEntries(this.rules.taskRequirements || []),
      personnelRules: this.rules.personnelRules,
      metadata: this.rules.metadata
    };
  }
}

module.exports = RuleEngine;
