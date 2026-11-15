const mockExecuteCommand = jest.fn();

jest.mock('../services/aiCommandService', () => ({
  parseCommand: jest.fn(),
  clearSession: jest.fn(),
}));
jest.mock('../services/aiExecutorService', () => ({ executeCommand: mockExecuteCommand }));
jest.mock('../services/llmService', () => ({ AI_PROVIDER: 'test' }));
jest.mock('../src/api/ai.service.js', () => ({
  aiSuggest: jest.fn(),
  parseRequest: jest.fn(),
}));
jest.mock('../src/api/validators/ajv.js', () => ({
  validateParsedRequest: jest.fn(),
}));

const router = require('../src/api/ai.routes');

function responseMock() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function confirmActionHandlers() {
  const layer = router.stack.find((item) => item.route?.path === '/confirm-action');
  return layer.route.stack.map((item) => item.handle);
}

describe('POST /api/ai/confirm-action role guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(['admin', 'superadmin', 'super-admin', 'staff', 'authorized', 'authorised', 'yetkili'])(
    'allows %s to reach existing validation',
    async (role) => {
      const [guard, handler] = confirmActionHandlers();
      const req = { user: { role }, body: {} };
      const res = responseMock();
      const next = jest.fn();

      guard(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalledWith(403);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'intent zorunlu' });
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    },
  );

  test('rejects user without executing AI mutation logic', () => {
    const [guard] = confirmActionHandlers();
    const req = { user: { role: 'user' }, body: { intent: 'assign_shift' } };
    const res = responseMock();
    const next = jest.fn();

    guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Bu işlem için yetkiniz yok.',
    });
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  test('preserves unauthenticated guard behavior', () => {
    const [guard] = confirmActionHandlers();
    const req = { body: { intent: 'assign_shift' } };
    const res = responseMock();
    const next = jest.fn();

    guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Auth gerekli' });
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });
});
