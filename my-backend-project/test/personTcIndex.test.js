'use strict';

// TC'si boş birden fazla personel aynı hastaneye eklenebilmeli (KVKK: TC zorunlu değil).
// Eski { unique, sparse } birleşik indeks bunu engelliyordu (E11000, tc: null / '').

const Person = require('../models/Person');

describe('Person TC indeksi', () => {
  const indexes = Person.schema.indexes();

  test('eski { unique, sparse } hospitalId+tc indeksi tanımlı değil', () => {
    const legacy = indexes.find(([spec, opts]) =>
      spec.hospitalId === 1 && spec.tc === 1 && opts.sparse === true && opts.unique === true);
    expect(legacy).toBeUndefined();
  });

  test('benzersizlik sadece dolu TC için (partialFilterExpression)', () => {
    const idx = indexes.find(([spec, opts]) => spec.hospitalId === 1 && spec.tc === 1 && opts.unique === true);
    expect(idx).toBeDefined();
    const [, opts] = idx;
    expect(opts.name).toBe('hospitalId_1_tc_1_nonempty');
    expect(opts.sparse).toBeUndefined();
    expect(opts.partialFilterExpression).toEqual({ tc: { $type: 'string', $gt: '' } });
  });
});
