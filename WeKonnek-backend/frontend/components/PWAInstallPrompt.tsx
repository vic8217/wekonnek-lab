'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'wk_install_dismissed';

export default function PWAInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    const onInstalled = () => setVisible(false);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 flex items-center gap-3">
        <img src="/logo/weKonnekLogov1.png" alt="WeKonnek" className="w-16 h-12 rounded-xl flex-shrink-0 object-contain" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 leading-tight">Install WeKonnek</p>
          <p className="text-sm text-gray-500 leading-tight">Add to your home screen for the full app experience.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={dismiss}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            aria-label="Dismiss install prompt"
          >
            Not now
          </button>
          <button
            onClick={install}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#DB0002] rounded-lg hover:bg-[#B80002] transition-colors"
          >
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
