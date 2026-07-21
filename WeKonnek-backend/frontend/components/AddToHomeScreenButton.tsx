'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function AddToHomeScreenButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    const iOS =
      /iphone|ipad|ipod/.test(ua) ||
      // iPadOS reports as Mac; detect via touch support
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIOS(iOS);

    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setInstalled(standalone);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleClick = async () => {
    if (installed) return;
    // Chromium browsers give us a deferred prompt we can trigger directly.
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      return;
    }
    // iOS Safari (and browsers without beforeinstallprompt) need manual steps.
    setShowHelp(true);
  };

  return (
    <>
      <button type="button" onClick={handleClick} className={className}>
        <Download size={18} />
        {installed ? 'App Installed' : 'Add to Home Screen'}
      </button>

      {showHelp && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowHelp(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 text-slate-900 shadow-2xl">
            <h4 className="text-lg font-bold">Add WeKonnek to your Home Screen</h4>
            {isIOS ? (
              <ol className="mt-4 space-y-3 text-sm text-slate-600">
                <li>
                  1. Tap the <span className="font-semibold">Share</span> button in Safari (the
                  square with an up arrow).
                </li>
                <li>
                  2. Scroll and tap <span className="font-semibold">Add to Home Screen</span>.
                </li>
                <li>
                  3. Tap <span className="font-semibold">Add</span> in the top-right corner.
                </li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-3 text-sm text-slate-600">
                <li>
                  1. Open your browser menu (⋮ or ⋯).
                </li>
                <li>
                  2. Tap <span className="font-semibold">Install app</span> or{' '}
                  <span className="font-semibold">Add to Home screen</span>.
                </li>
                <li>3. Confirm to install.</li>
              </ol>
            )}
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="mt-6 w-full rounded-xl bg-[#DB0002] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B80002]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
