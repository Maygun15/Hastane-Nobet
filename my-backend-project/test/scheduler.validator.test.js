'use strict';

const { validateAssignments } = require('../services/scheduler/validator');

describe('validateAssignments slot capacity guard', () => {
  test('keeps only one assignment per day and row slot', () => {
    const defs = [
      { id: 'row-resu-n', label: 'RESÜSİTASYON', shiftCode: 'N' },
    ];

    const assignments = [
      {
        date: '2026-05-05',
        shiftId: 'row-resu-n',
        shiftCode: 'N',
        roleLabel: 'RESÜSİTASYON',
        personId: 'p1',
        personName: 'Ayşe Yılmaz',
      },
      {
        date: '2026-05-05',
        shiftId: 'row-resu-n',
        shiftCode: 'N',
        roleLabel: 'RESÜSİTASYON',
        personId: 'p2',
        personName: 'Fatma Demir',
      },
    ];

    const staff = [
      { id: 'p1', name: 'Ayşe Yılmaz' },
      { id: 'p2', name: 'Fatma Demir' },
    ];

    const result = validateAssignments({
      assignments,
      defs,
      staff,
      leavesByPerson: {},
      holidayKindByDate: {},
      shiftMetaByCode: {},
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].personId).toBe('p1');
    expect(result.issues.some((issue) => issue.reason === 'SLOT_CAPACITY_EXCEEDED')).toBe(true);
  });

  test('preserves two separate service supervisor rows on the same day', () => {
    const defs = [
      { id: 'sup-1', label: 'SERVİS SORUMLUSU', shiftCode: 'M' },
      { id: 'sup-2', label: 'SERVİS SORUMLUSU', shiftCode: 'M' },
    ];

    const assignments = [
      {
        date: '2026-05-05',
        shiftId: 'sup-1',
        shiftCode: 'M',
        roleLabel: 'SERVİS SORUMLUSU',
        personId: 'p1',
        personName: 'Gamze Öztürk',
      },
      {
        date: '2026-05-05',
        shiftId: 'sup-2',
        shiftCode: 'M',
        roleLabel: 'SERVİS SORUMLUSU',
        personId: 'p2',
        personName: 'Ergül Aydın',
      },
    ];

    const staff = [
      { id: 'p1', name: 'Gamze Öztürk' },
      { id: 'p2', name: 'Ergül Aydın' },
    ];

    const result = validateAssignments({
      assignments,
      defs,
      staff,
      leavesByPerson: {},
      holidayKindByDate: {},
      shiftMetaByCode: {},
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.issues.some((issue) => issue.reason === 'SUPERVISOR_CAPACITY')).toBe(false);
  });
});
