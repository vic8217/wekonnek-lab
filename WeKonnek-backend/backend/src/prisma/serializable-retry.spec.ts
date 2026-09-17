import {
  isSerializableConflictError,
  withSerializableRetry,
} from './serializable-retry';
import { Prisma } from '@prisma/client';

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
