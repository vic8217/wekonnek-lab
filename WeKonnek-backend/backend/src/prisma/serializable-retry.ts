import { Prisma } from '@prisma/client';

/**
 * Classify Serializable / write-conflict errors as retryable across Prisma
 * client wrappers and driver-adapter shapes (Stage 11 repair).
 *
 * Prefer structured properties over message-only matching.
 */
export function isSerializableConflictError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === 'P2034';
  }

  // Raw / nested DriverAdapterError (before or without PrismaClientKnownRequestError wrap)
  const candidates: unknown[] = [err];
  if (err && typeof err === 'object') {
    const e = err as {
      name?: string;
      code?: string;
      kind?: string;
      cause?: unknown;
      message?: string;
    };
    if (e.cause) candidates.push(e.cause);
    if (e.code === 'P2034' || e.kind === 'TransactionWriteConflict') {
      return true;
    }
  }

  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const cause = c as { kind?: string; code?: string };
    if (
      cause.kind === 'TransactionWriteConflict' ||
      cause.code === 'P2034'
    ) {
      return true;
    }
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
