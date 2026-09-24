import {
  isSerializableConflictError,
  withSerializableRetry,
} from './serializable-retry';
import { Prisma } from '@prisma/client';

function known(
  code: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: 'test',
    meta,
  });
}

function adapterP2010(cause: Record<string, unknown>, message = 'unused') {
  return known('P2010', message, {
    driverAdapterError: { cause },
  });
}

describe('serializable-retry classification (Stage 11 repair)', () => {
  it('classifies only Prisma P2034 write conflicts', () => {
    const p2034 = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
      { code: 'P2034', clientVersion: 'test' },
    );
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(isSerializableConflictError(p2034)).toBe(true);
    expect(isSerializableConflictError(p2002)).toBe(false);
  });

  it('classifies DriverAdapterError TransactionWriteConflict shapes', () => {
    const raw = {
      name: 'DriverAdapterError',
      cause: { kind: 'TransactionWriteConflict' },
      message: 'TransactionWriteConflict',
    };
    expect(isSerializableConflictError(raw)).toBe(true);
    expect(
      isSerializableConflictError({
        cause: { kind: 'TransactionWriteConflict' },
      }),
    ).toBe(true);
  });

  it('does not classify ordinary ForbiddenException-like objects', () => {
    expect(
      isSerializableConflictError({
        name: 'ForbiddenException',
        message: 'OPERATIONS_RECOVERY_ACTIVE',
      }),
    ).toBe(false);
  });

  it('does not classify arbitrary driver, raw, or unique errors as retryable', () => {
    expect(isSerializableConflictError({ name: 'DriverAdapterError' })).toBe(
      false,
    );
    expect(isSerializableConflictError({ code: 'P2002' })).toBe(false);
    expect(isSerializableConflictError({ code: 'P2010' })).toBe(false);
    expect(
      isSerializableConflictError({
        cause: { kind: 'SomeOtherDriverFailure' },
      }),
    ).toBe(false);
  });

  it('retries whole operation until success and re-invokes run each time', async () => {
    let calls = 0;
    const result = await withSerializableRetry(async () => {
      calls += 1;
      if (calls < 3) {
        throw {
          name: 'DriverAdapterError',
          cause: { kind: 'TransactionWriteConflict' },
        };
      }
      return 'ok';
    }, 5);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry non-conflict errors', async () => {
    let calls = 0;
    await expect(
      withSerializableRetry(async () => {
        calls += 1;
        throw new Error('OPERATIONS_RECOVERY_ACTIVE');
      }, 5),
    ).rejects.toThrow('OPERATIONS_RECOVERY_ACTIVE');
    expect(calls).toBe(1);
  });
});

describe('UCE-C1 Prisma adapter P2010 serialization classification', () => {
  it('classifies live adapter P2010 by kind and originalCode, ignoring originalMessage', () => {
    expect(
      isSerializableConflictError(
        adapterP2010({
          kind: 'TransactionWriteConflict',
          originalCode: '40001',
          originalMessage:
            'could not serialize access due to concurrent update',
        }),
      ),
    ).toBe(true);
    expect(
      isSerializableConflictError(
        adapterP2010({
          kind: 'TransactionWriteConflict',
          originalCode: '40001',
          originalMessage: 'unrelated adapter text',
        }),
      ),
    ).toBe(true);
  });

  it('requires both adapter kind and originalCode 40001', () => {
    expect(
      isSerializableConflictError(
        adapterP2010({ kind: 'TransactionWriteConflict' }),
      ),
    ).toBe(false);
    expect(
      isSerializableConflictError(
        adapterP2010({
          kind: 'TransactionWriteConflict',
          originalCode: '40P01',
        }),
      ),
    ).toBe(false);
    expect(
      isSerializableConflictError(
        adapterP2010({
          kind: 'TransactionWriteConflict',
          originalCode: '23505',
        }),
      ),
    ).toBe(false);
    expect(
      isSerializableConflictError(adapterP2010({ originalCode: '40001' })),
    ).toBe(false);
    expect(
      isSerializableConflictError(
        adapterP2010({
          kind: 'UnsupportedNativeDataType',
          originalCode: '40001',
        }),
      ),
    ).toBe(false);
    expect(
      isSerializableConflictError(
        adapterP2010({
          originalMessage: 'Raw query failed. Code: `40001`.',
        }),
      ),
    ).toBe(false);
    expect(
      isSerializableConflictError(
        known(
          'P2010',
          'Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`',
        ),
      ),
    ).toBe(false);
  });

  it('does not classify non-serialization SQLSTATEs, schema, auth, or empty values', () => {
    expect(isSerializableConflictError(known('P2010', 'raw failed'))).toBe(
      false,
    );
    expect(isSerializableConflictError({ code: '23505' })).toBe(false);
    expect(isSerializableConflictError({ code: '23503' })).toBe(false);
    expect(isSerializableConflictError({ code: '23502' })).toBe(false);
    expect(isSerializableConflictError({ code: '22P02' })).toBe(false);
    expect(isSerializableConflictError({ code: '42501' })).toBe(false);
    expect(isSerializableConflictError({ code: '42P01' })).toBe(false);
    expect(isSerializableConflictError({ code: '42703' })).toBe(false);
    expect(isSerializableConflictError({ code: '40P01' })).toBe(false);
    expect(isSerializableConflictError({ code: '40001' })).toBe(false);
    expect(isSerializableConflictError({ cause: { code: '40001' } })).toBe(
      false,
    );
    expect(isSerializableConflictError({ code: 'ECONNREFUSED' })).toBe(false);
    expect(
      isSerializableConflictError({
        name: 'ForbiddenException',
        status: 403,
        message: 'denied',
      }),
    ).toBe(false);
    expect(
      isSerializableConflictError({ status: 400, message: 'bad request' }),
    ).toBe(false);
    expect(
      isSerializableConflictError({ status: 404, message: 'missing' }),
    ).toBe(false);
    expect(
      isSerializableConflictError({ status: 409, message: 'conflict' }),
    ).toBe(false);
    expect(
      isSerializableConflictError({
        message: 'Raw query failed. Code: `40001`. Message: `could not serialize`',
      }),
    ).toBe(false);
    expect(isSerializableConflictError({})).toBe(false);
    expect(isSerializableConflictError(null)).toBe(false);
    expect(isSerializableConflictError(undefined)).toBe(false);
    expect(isSerializableConflictError('40001')).toBe(false);
  });

  it('does not walk arbitrary nested objects for 40001', () => {
    expect(
      isSerializableConflictError({
        cause: { cause: { originalCode: '40001' } },
      }),
    ).toBe(false);
    expect(
      isSerializableConflictError(
        known('P2010', 'x', {
          nested: {
            driverAdapterError: {
              cause: {
                kind: 'TransactionWriteConflict',
                originalCode: '40001',
              },
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it('retries structured adapter 40001 until success with default attempt bound', async () => {
    let calls = 0;
    const result = await withSerializableRetry(async () => {
      calls += 1;
      if (calls < 2) {
        throw adapterP2010({
          kind: 'TransactionWriteConflict',
          originalCode: '40001',
        });
      }
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('propagates persistent structured adapter 40001 after exactly five attempts', async () => {
    let calls = 0;
    const err = adapterP2010({
      kind: 'TransactionWriteConflict',
      originalCode: '40001',
    });
    await expect(
      withSerializableRetry(async () => {
        calls += 1;
        throw err;
      }),
    ).rejects.toBe(err);
    expect(calls).toBe(5);
  });

  it('retries existing P2034 until success', async () => {
    let calls = 0;
    const result = await withSerializableRetry(async () => {
      calls += 1;
      if (calls < 2) {
        throw known(
          'P2034',
          'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
        );
      }
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not retry unique, deadlock, or application errors', async () => {
    for (const failure of [
      known('P2002', 'Unique'),
      { code: '40P01' },
      { status: 403, message: 'forbidden' },
    ]) {
      let calls = 0;
      await expect(
        withSerializableRetry(async () => {
          calls += 1;
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(calls).toBe(1);
    }
  });
});
