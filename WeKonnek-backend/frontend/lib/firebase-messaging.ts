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
const REGISTRATION_VERSION_KEY = 'wk_fcm_registration_version';
const ROOT_WORKER_REGISTRATION_VERSION = 'root-sw-v1';

export function firebaseMessagingConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId && process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY);
}

async function messaging() {
  if (!firebaseMessagingConfigured() || !(await isSupported())) return null;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getMessaging(app);
}

async function rootServiceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const registration = await navigator.serviceWorker.ready;
  const scriptUrl = registration.active?.scriptURL || '';
  if (!scriptUrl || new URL(scriptUrl).pathname !== '/sw.js') {
    throw new Error('The active WEKONNEK service worker is unavailable.');
  }
  return registration;
}

export async function enablePushNotifications(authToken: string | null) {
  const instance = await messaging();
  if (!instance || !('serviceWorker' in navigator)) throw new Error('Push notifications are not supported on this device.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { permission };
  const registration = await rootServiceWorkerRegistration();
  let pendingToken = pendingCleanupToken(localStorage);
  let pendingFirebaseDeleted = false;
  if (pendingToken) {
    pendingFirebaseDeleted = await deleteToken(instance).catch(() => false);
    if (pendingFirebaseDeleted) clearTrackedPushToken(localStorage);
    else console.warn('[push] Pending device cleanup could not delete the Firebase token; ownership transfer will be verified');
  }
  if (!pendingToken && localStorage.getItem(REGISTRATION_VERSION_KEY) !== ROOT_WORKER_REGISTRATION_VERSION) {
    const trackedToken = localStorage.getItem(FCM_TOKEN_KEY);
    if (trackedToken) {
      const cleanup = await deactivateCurrentPushDevice(authToken);
      if (!cleanup.cleanupComplete) {
        throw new Error('The previous notification registration is still pending cleanup. Please try again.');
      }
    }
    pendingToken = pendingCleanupToken(localStorage);
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
  localStorage.setItem(REGISTRATION_VERSION_KEY, ROOT_WORKER_REGISTRATION_VERSION);
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
