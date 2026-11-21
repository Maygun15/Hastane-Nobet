'use strict';
// .lean() ile okunan DutyRule belgesinde Map alanları düz nesne gelir; motor ikisini de desteklemeli.
// (Önceden "taskRequirements?.get is not a function" ile plan üretimi çöküyordu.)
const RuleEngine = require('../services/ruleEngine');

describe('RuleEngine Map/düz nesne uyumu', () => {
  const person = { id: 'p1', role: 'Nurse', leaveType: 'R' };
  test('düz nesne (lean) ile çökmez ve kuralı uygular', () => {
    const engine = new RuleEngine({
      leaveRules: { R: { name: 'Rapor', allowDuty: false } },
      taskRequirements: { TRIAJ: { allowedRoles: ['Doctor'] } },
    });
    const res = engine.checkPersonEligibility(person, 'TRIAJ', '2026-12-01');
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/Rapor/);
  });
  test('Map ile aynı sonuç', () => {
    const engine = new RuleEngine({
      leaveRules: new Map([['R', { name: 'Rapor', allowDuty: false }]]),
      taskRequirements: new Map(),
    });
    expect(engine.checkPersonEligibility(person, 'TRIAJ', '2026-12-01').eligible).toBe(false);
  });
  test('kural belgesi boşsa uygun', () => {
    const engine = new RuleEngine({ leaveRules: {}, taskRequirements: {} });
    expect(engine.checkPersonEligibility({ id: 'p2', role: 'Nurse' }, 'TRIAJ', '2026-12-01').eligible).toBe(true);
  });
});
