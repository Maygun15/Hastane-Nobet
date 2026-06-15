'use strict';

const {
  ERROR_CODE,
  ERROR_MESSAGE,
  assertSpecificServiceId,
  specificServiceErrorPayload,
} = require('../utils/serviceScopeGuard');

describe('assertSpecificServiceId', () => {
  test.each([
    undefined,
    null,
    '',
    '   ',
    'all',
    ' ALL ',
    'all services',
    'All Services',
    'tümü',
    'TÜMÜ',
    'tüm servisler',
    'TÜM SERVİSLER',
    '  Tüm   Servisler  ',
  ])('rejects invalid operational service value %p', (value) => {
    try {
      assertSpecificServiceId(value);
      throw new Error('Expected service scope validation to fail');
    } catch (error) {
      expect(error).toMatchObject({
        code: ERROR_CODE,
        status: 400,
        message: ERROR_MESSAGE,
      });
    }
  });

  test('accepts and trims a specific service id', () => {
    expect(assertSpecificServiceId('  service-123  ')).toBe('service-123');
  });

  test('returns the stable API error contract', () => {
    expect(specificServiceErrorPayload()).toEqual({
      ok: false,
      code: ERROR_CODE,
      message: ERROR_MESSAGE,
    });
  });
});
