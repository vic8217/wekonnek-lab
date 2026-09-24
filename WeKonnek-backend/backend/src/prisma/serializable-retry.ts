import { Prisma } from '@prisma/client';

const SQLSTATE_SERIALIZATION_FAILURE = '40001';
const ADAPTER_WRITE_CONFLICT = 'TransactionWriteConflict';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Prisma 7 adapter-pg P2010: meta.driverAdapterError.cause.{kind,originalCode}. */
function isP2010AdapterSerializationConflict(err: {
  meta?: unknown;
}): boolean {
  if (!isObject(err.meta)) return false;
  const adapterError = err.meta.driverAdapterError;
  if (!isObject(adapterError)) return false;
  const cause = adapterError.cause;
  if (!isObject(cause)) return false;
  return (
    cause.kind === ADAPTER_WRITE_CONFLICT &&
    String(cause.originalCode) === SQLSTATE_SERIALIZATION_FAILURE
  );
}

function isWriteConflictKind(value: unknown): boolean {
  return isObject(value) && value.kind === ADAPTER_WRITE_CONFLICT;
}

/**
 * Classify Serializable / write-conflict errors as retryable across Prisma
 * client wrappers and driver-adapter shapes (Stage 11 repair + UCE-C1).
 *
 * Prefer structured properties over message-only matching.
 */
export function isSerializableConflictError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2034') return true;
    if (err.code === 'P2010') {
      return isP2010AdapterSerializationConflict(err);
    }
    return false;
  }

  // Unwrapped DriverAdapterError / cause.kind (Stage 11). One cause level only.
  const candidates: unknown[] = [err];
  if (isObject(err) && err.cause !== undefined) {
    candidates.push(err.cause);
  }
  for (const c of candidates) {
    if (!isObject(c)) continue;
    if (c.code === 'P2034' || isWriteConflictKind(c)) return true;
  }
  return false;
}

/** Bounded whole-operation Serializable retry (re-runs `run` fully each attempt). */
export async function withSerializableRetry<T>(
  run: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (err) {
      last = err;
      if (!isSerializableConflictError(err) || i === attempts - 1) throw err;
    }
  }
  throw last;
}
