'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken as getFcmToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import {
  cleanupTrackedPushToken,
  clearTrackedPushToken,
  deactivatePushDevice,
  FCM_TOKEN_KEY,
  pendingCleanupToken,
  pendingTokenMatchesCurrent,
  PENDING_FCM_CLEANUP_KEY,
  type PushCleanupResult,
} from './push-cleanup-state';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function firebaseMessagingConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId && process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY);
}

async function messaging() {
  if (!firebaseMessagingConfigured() || !(await isSupported())) return null;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getMessaging(app);
}

export async function enablePushNotifications(authToken: string | null) {
  const instance = await messaging();
  if (!instance || !('serviceWorker' in navigator)) throw new Error('Push notifications are not supported on this device.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { permission };
  const registration = await navigator.serviceWorker.getRegistration('/') || await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const pendingToken = pendingCleanupToken(localStorage);
  let pendingFirebaseDeleted = false;
  if (pendingToken) {
    pendingFirebaseDeleted = await deleteToken(instance).catch(() => false);
    if (pendingFirebaseDeleted) clearTrackedPushToken(localStorage);
    else console.warn('[push] Pending device cleanup could not delete the Firebase token; ownership transfer will be verified');
  }
  const fcmToken = await getFcmToken(instance, { vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
  if (!fcmToken) throw new Error('Firebase did not return a device token.');
  if (!authToken) throw new Error('Sign in before enabling notifications.');
  if (pendingToken && !pendingFirebaseDeleted && !pendingTokenMatchesCurrent(pendingToken, fcmToken)) {
    throw new Error('A previous notification registration is still pending cleanup. Please try again.');
  }
  const response = await fetch('/api/backend/notifications/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ fcmToken, platform: 'web', deviceName: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || 'Web browser', browser: navigator.userAgent.slice(0, 160), operatingSystem: navigator.platform || undefined }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Unable to register this device.');
  // A successful upsert atomically makes the authenticated user the sole owner
  // of this unique token, so a reused pending token is now safe to clear.
  localStorage.setItem(FCM_TOKEN_KEY, fcmToken);
  localStorage.removeItem(PENDING_FCM_CLEANUP_KEY);
  return { permission, fcmToken };
}

export async function deactivateCurrentPushDevice(authToken: string | null): Promise<PushCleanupResult> {
  const fcmToken = typeof window !== 'undefined'
    ? localStorage.getItem(FCM_TOKEN_KEY) || pendingCleanupToken(localStorage)
    : null;
  if (!fcmToken) return { backendDeactivated: true, firebaseDeleted: true, cleanupComplete: true };

  return cleanupTrackedPushToken(
    localStorage,
    () => deactivatePushDevice(fetch, authToken, fcmToken),
    async () => {
      const instance = await messaging().catch(() => null);
      if (!instance) return false;
      const deleted = await deleteToken(instance).catch(() => false);
      if (!deleted) console.warn('[push] Firebase device-token deletion failed; cleanup remains retryable');
      return deleted;
    },
  );
}

export async function listenForForegroundPush(handler: (payload: MessagePayload) => void) {
  const instance = await messaging();
  return instance ? onMessage(instance, handler) : () => undefined;
}
