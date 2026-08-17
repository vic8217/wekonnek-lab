import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupTrackedPushToken,
  deactivatePushDevice,
  FCM_TOKEN_KEY,
  pendingCleanupToken,
  pendingTokenMatchesCurrent,
  PENDING_FCM_CLEANUP_KEY,
} from './push-cleanup-state';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function trackedStorage() {
  const storage = new MemoryStorage();
  storage.setItem(FCM_TOKEN_KEY, 'device-token');
  return storage;
}

test('normal logout clears local and pending token state', async () => {
  const storage = trackedStorage();
  const result = await cleanupTrackedPushToken(storage, async () => true, async () => true);
  assert.deepEqual(result, { backendDeactivated: true, firebaseDeleted: true, cleanupComplete: true });
  assert.equal(storage.getItem(FCM_TOKEN_KEY), null);
  assert.equal(pendingCleanupToken(storage), null);
});

test('Firebase success clears state when backend returns a failed status', async () => {
  const storage = trackedStorage();
  const result = await cleanupTrackedPushToken(storage, async () => false, async () => true);
  assert.equal(result.cleanupComplete, true);
  assert.equal(storage.getItem(FCM_TOKEN_KEY), null);
});

test('backend success clears state when Firebase deletion fails', async () => {
  const storage = trackedStorage();
  const result = await cleanupTrackedPushToken(storage, async () => true, async () => false);
  assert.equal(result.cleanupComplete, true);
  assert.equal(storage.getItem(FCM_TOKEN_KEY), null);
});

test('both failures retain the token and create durable pending cleanup state', async () => {
  const storage = trackedStorage();
  const result = await cleanupTrackedPushToken(storage, async () => false, async () => false);
  assert.deepEqual(result, { backendDeactivated: false, firebaseDeleted: false, cleanupComplete: false });
  assert.equal(storage.getItem(FCM_TOKEN_KEY), 'device-token');
  assert.equal(storage.getItem(PENDING_FCM_CLEANUP_KEY), 'device-token');
});

test('network rejection is a backend failure and remains retryable', async () => {
  const storage = trackedStorage();
  const result = await cleanupTrackedPushToken(
    storage,
    async () => { throw new Error('offline'); },
    async () => false,
  );
  assert.equal(result.backendDeactivated, false);
  assert.equal(pendingCleanupToken(storage), 'device-token');
});

test('account switch permits atomic reassignment only for the exact pending token', () => {
  assert.equal(pendingTokenMatchesCurrent('user-a-token', 'user-a-token'), true);
  assert.equal(pendingTokenMatchesCurrent('user-a-token', 'different-token'), false);
});

test('HTTP 500 is not accepted as backend deactivation', async () => {
  const result = await deactivatePushDevice(async () => ({ ok: false }), 'jwt', 'device-token');
  assert.equal(result, false);
});

test('a rejected deactivation request reports backend failure', async () => {
  const result = await deactivatePushDevice(async () => { throw new Error('offline'); }, 'jwt', 'device-token');
  assert.equal(result, false);
});
