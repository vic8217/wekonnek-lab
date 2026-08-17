export const FCM_TOKEN_KEY = 'wk_fcm_device_token';
export const PENDING_FCM_CLEANUP_KEY = 'wk_fcm_pending_cleanup';

export type PushCleanupResult = {
  backendDeactivated: boolean;
  firebaseDeleted: boolean;
  cleanupComplete: boolean;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Pick<Response, 'ok'>>;

export function pendingCleanupToken(storage: StorageLike): string | null {
  const token = storage.getItem(PENDING_FCM_CLEANUP_KEY);
  return token?.trim() || null;
}

export function clearTrackedPushToken(storage: StorageLike) {
  storage.removeItem(FCM_TOKEN_KEY);
  storage.removeItem(PENDING_FCM_CLEANUP_KEY);
}

export function pendingTokenMatchesCurrent(pendingToken: string, currentToken: string) {
  return pendingToken === currentToken;
}

export async function deactivatePushDevice(
  fetcher: FetchLike,
  authToken: string | null,
  fcmToken: string,
) {
  if (!authToken) return false;
  try {
    const response = await fetcher('/api/backend/notifications/devices/current', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ fcmToken }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function cleanupTrackedPushToken(
  storage: StorageLike,
  backendDeactivate: () => Promise<boolean>,
  firebaseDelete: () => Promise<boolean>,
): Promise<PushCleanupResult> {
  const token = storage.getItem(FCM_TOKEN_KEY) || pendingCleanupToken(storage);
  if (!token) {
    return { backendDeactivated: true, firebaseDeleted: true, cleanupComplete: true };
  }

  const backendDeactivated = await backendDeactivate().catch(() => false);
  const firebaseDeleted = await firebaseDelete().catch(() => false);
  const cleanupComplete = backendDeactivated || firebaseDeleted;

  if (cleanupComplete) clearTrackedPushToken(storage);
  else {
    storage.setItem(FCM_TOKEN_KEY, token);
    storage.setItem(PENDING_FCM_CLEANUP_KEY, token);
  }

  return { backendDeactivated, firebaseDeleted, cleanupComplete };
}
