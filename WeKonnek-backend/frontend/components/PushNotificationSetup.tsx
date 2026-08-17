'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getToken, useAuth } from '@/hooks/use-auth';
import { enablePushNotifications, firebaseMessagingConfigured, listenForForegroundPush } from '@/lib/firebase-messaging';
import { usePathname } from 'next/navigation';

const DISMISSED_KEY = 'wk_push_prompt_dismissed';

export default function PushNotificationSetup() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !firebaseMessagingConfigured() || typeof Notification === 'undefined' || Notification.permission !== 'default' || localStorage.getItem(DISMISSED_KEY)) return;
    const timer = window.setTimeout(() => setVisible(true), 2500);
    return () => window.clearTimeout(timer);
  }, [user]);

  useEffect(() => {
    const respondToWorker = (event: MessageEvent) => {
      if (event.data?.type !== 'WK_NOTIFICATION_CONTEXT_REQUEST' || !event.ports[0]) return;
      const portal = pathname.startsWith('/shop/') ? 'shop'
        : pathname.startsWith('/merchant/') ? 'merchant'
          : pathname.startsWith('/admin/') ? 'admin'
            : pathname.startsWith('/coordinator/') ? 'coordinator' : 'customer';
      let shopId: number | undefined;
      if (portal === 'shop') {
        try { shopId = Number(JSON.parse(sessionStorage.getItem('wk_active_shop') || '{}').id) || undefined; } catch { /* ignore invalid stale context */ }
      }
      event.ports[0].postMessage({ authenticated: Boolean(user && getToken()), portal, shopId });
    };
    navigator.serviceWorker?.addEventListener('message', respondToWorker);
    return () => navigator.serviceWorker?.removeEventListener('message', respondToWorker);
  }, [pathname, user]);

  useEffect(() => {
    if (!user || Notification.permission !== 'granted') return;
    let unsubscribe: () => void = () => undefined;
    void enablePushNotifications(getToken()).catch(() => undefined);
    void listenForForegroundPush(payload => {
      window.dispatchEvent(new CustomEvent('wk:notifications-updated'));
      toast(payload.notification?.body || payload.notification?.title || 'You have a new notification', { icon: '🔔', id: payload.messageId || undefined });
    }).then(stop => { unsubscribe = stop; });
    return () => unsubscribe();
  }, [user]);

  const enable = async () => {
    setBusy(true);
    try {
      const result = await enablePushNotifications(getToken());
      setVisible(false);
      if (result.permission === 'granted') toast.success('Notifications enabled on this device.');
      else {
        localStorage.setItem(DISMISSED_KEY, 'denied');
        toast.error('Notification permission was not granted.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to enable notifications.');
    } finally { setBusy(false); }
  };

  if (!visible) return null;
  return <aside className="fixed bottom-20 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" aria-label="Enable push notifications">
    <p className="font-black text-slate-900">Get instant alerts</p>
    <p className="mt-1 text-sm text-slate-600">Receive important order, reservation, inquiry, and account updates even when WeKonnek is in the background.</p>
    <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => { localStorage.setItem(DISMISSED_KEY, '1'); setVisible(false); }} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600">Not now</button><button type="button" disabled={busy} onClick={() => void enable()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Enabling…' : 'Enable notifications'}</button></div>
  </aside>;
}
