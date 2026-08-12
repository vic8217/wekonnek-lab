'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const TAMBOBBQ_IN_STORE_TEST_ROUTE = '/merchants/tambobbq?table=Table%201';

/** Resolve a scanned QR value to a merchant route, preserving a table tag. */
function resolveTarget(raw: string): string {
  const value = raw.trim();
  // Full URL containing /merchants/<slug> — keep any ?table=<label> so dine-in
  // QR codes carry the table context into the storefront and checkout.
  const match = value.match(/\/merchants\/([^/?#]+)/);
  if (match) {
    let table: string | null = null;
    try {
      const url = new URL(value);
      table = url.searchParams.get('table');
    } catch {
      const q = value.match(/[?&]table=([^&#]+)/);
      if (q) table = decodeURIComponent(q[1]);
    }
    return table
      ? `/merchants/${match[1]}?table=${encodeURIComponent(table)}`
      : `/merchants/${match[1]}`;
  }
  // Bare URL we don't recognize — open as-is is unsafe, so fall back to slug
  const slug = value.replace(/^https?:\/\/[^/]+\//, '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  return `/merchants/${slug || value.toLowerCase()}`;
}

export default function CustomerScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const scanningRef = useRef(false);

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [decoderSupported, setDecoderSupported] = useState(true);

  const getDetector = useCallback(() => {
    if (detectorRef.current) return detectorRef.current;
    const BD = (globalThis as any).BarcodeDetector;
    if (!BD) {
      setDecoderSupported(false);
      return null;
    }
    detectorRef.current = new BD({ formats: ['qr_code'] });
    return detectorRef.current;
  }, []);

  const handleDetected = useCallback(
    (value: string) => {
      setScannedResult(value);
      stopCamera();
      router.push(resolveTarget(value));
    },
    [router],
  );

  const scanLoop = useCallback(async () => {
    if (!scanningRef.current || !videoRef.current) return;
    const detector = getDetector();
    if (detector && videoRef.current.readyState >= 2) {
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes && codes.length > 0 && codes[0].rawValue) {
          handleDetected(codes[0].rawValue);
          return;
        }
      } catch {
        /* transient detect errors are safe to ignore */
      }
    }
    rafRef.current = requestAnimationFrame(scanLoop);
  }, [getDetector, handleDetected]);

  const startCamera = async () => {
    try {
      setCameraError(null);
      setScannedResult(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorchSupported(!!caps.torch);
      setScanning(true);
      scanningRef.current = true;
      getDetector();
      rafRef.current = requestAnimationFrame(scanLoop);
    } catch (err: any) {
      console.error('Camera error:', err);
      if (err.name === 'NotAllowedError') {
        setCameraError('Camera access denied. Please allow camera permissions in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        setCameraError('No camera found on this device.');
      } else {
        setCameraError('Unable to access camera. Please check your device settings.');
      }
    }
  };

  const stopCamera = () => {
    scanningRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
    setTorchOn(false);
    setTorchSupported(false);
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] as any });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const detector = getDetector();
    if (!detector) {
      setCameraError('QR decoding from images is not supported on this browser.');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      if (codes && codes.length > 0 && codes[0].rawValue) {
        handleDetected(codes[0].rawValue);
      } else {
        setCameraError('No QR code found in that image. Try another photo.');
      }
    } catch {
      setCameraError('Could not read that image. Please try again.');
    }
  };

  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      router.push(resolveTarget(manualCode));
    }
  };

  const handleScanAgain = () => {
    setScannedResult(null);
    startCamera();
  };

  const openTambobbqTestOrder = () => {
    stopCamera();
    router.push(TAMBOBBQ_IN_STORE_TEST_ROUTE);
  };

  return (
    <>
      {/* Shared hidden file input for image upload decoding */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

      {/* ========== MOBILE SCAN PAGE ========== */}
      <div className="lg:hidden min-h-screen bg-gray-900 relative">
        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between px-4 py-3 bg-black/50">
          <Link href="/customer/dashboard" className="text-white p-1" title="Back">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-white font-bold text-base">Scan QR</h1>
          <button type="button" className="text-white p-1" title="Help" aria-label="Help">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>

        {/* Camera viewfinder area */}
        <div className="relative flex items-center justify-center" style={{ height: 'calc(100vh - 240px)' }}>
          <button
            type="button"
            onClick={openTambobbqTestOrder}
            className="absolute top-4 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-300/60 bg-amber-400 px-4 py-2 text-xs font-bold text-gray-950 shadow-lg"
          >
            Test TambobBQ in-store order
          </button>
          {scanning ? (
            <>
              <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
              <div className="absolute inset-0 bg-black/30" />
              {/* Scan frame overlay */}
              <div className="relative z-10 w-64 h-64">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#DB0002] rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#DB0002] rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#DB0002] rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#DB0002] rounded-br-lg" />
                <div className="absolute top-0 left-2 right-2 h-0.5 bg-[#DB0002] animate-scan-line" />
              </div>
              <div className="absolute bottom-6 left-0 right-0 text-center z-10 px-8">
                <p className="text-white text-sm font-semibold">Align the QR code within the frame</p>
                <p className="text-gray-300 text-xs mt-1">
                  {decoderSupported ? 'The menu will open automatically once recognized' : 'Auto-scan unavailable — use Upload or enter a code below'}
                </p>
              </div>
            </>
          ) : scannedResult ? (
            <div className="text-center px-6">
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-white text-xl font-bold mb-2">QR Code Scanned!</h2>
              <p className="text-gray-300 text-sm mb-4 break-all">{scannedResult}</p>
              <button onClick={handleScanAgain} className="bg-[#DB0002] text-white px-6 py-2.5 rounded-full font-semibold text-sm">
                Scan Again
              </button>
            </div>
          ) : (
            <div className="text-center px-6">
              {cameraError ? (
                <>
                  <div className="w-20 h-20 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <p className="text-gray-300 text-sm mb-4">{cameraError}</p>
                </>
              ) : (
                <>
                  <div className="w-24 h-24 bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <h2 className="text-white text-lg font-bold mb-2">Scan QR Code</h2>
                  <p className="text-gray-400 text-sm mb-4">
                    Scan a merchant&apos;s QR code to view their store, menu, or claim rewards
                  </p>
                </>
              )}
              <button onClick={startCamera} className="bg-[#DB0002] text-white px-6 py-3 rounded-full font-semibold text-sm">
                {cameraError ? 'Try Again' : 'Start Camera'}
              </button>
            </div>
          )}
        </div>

        {/* Bottom section */}
        <div className="absolute bottom-0 left-0 right-0 bg-gray-900 px-4 py-5 space-y-3 safe-area-bottom">
          {/* Flashlight + Upload */}
          <div className="flex gap-3">
            <button
              onClick={toggleTorch}
              disabled={!scanning || !torchSupported}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-colors disabled:opacity-40 ${
                torchOn ? 'bg-amber-400 text-gray-900' : 'bg-gray-800 text-white'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3h6l-1 6h3l-7 12 2-8H8l1-10z" />
              </svg>
              Flashlight
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-800 text-white font-semibold text-sm"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Upload
            </button>
          </div>

          {scanning && (
            <button onClick={stopCamera} className="w-full py-2.5 bg-gray-700 text-white rounded-full font-semibold text-sm">
              Stop Camera
            </button>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-700" />
            <span className="text-gray-500 text-xs font-medium">OR ENTER CODE MANUALLY</span>
            <div className="flex-1 h-px bg-gray-700" />
          </div>

          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Enter merchant code..."
              className="flex-1 bg-gray-800 text-white placeholder-gray-500 px-4 py-2.5 rounded-full text-sm outline-none focus:ring-2 focus:ring-[#DB0002]/50"
            />
            <button type="submit" className="bg-[#DB0002] text-white px-5 py-2.5 rounded-full text-sm font-semibold">
              Go
            </button>
          </form>
        </div>
      </div>

      {/* ========== DESKTOP SCAN PAGE ========== */}
      <div className="hidden lg:block space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Scan QR Code</h1>
          <p className="text-gray-600">Scan a merchant&apos;s QR code to quickly access their store</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Camera */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Camera Scanner</h2>
              <div className="relative bg-gray-900 rounded-xl overflow-hidden" style={{ height: '350px' }}>
                {scanning ? (
                  <>
                    <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="relative w-52 h-52">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#DB0002] rounded-tl-lg" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#DB0002] rounded-tr-lg" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#DB0002] rounded-bl-lg" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#DB0002] rounded-br-lg" />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <svg className="w-16 h-16 text-gray-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                      </svg>
                      {cameraError && <p className="text-red-400 text-sm mb-3">{cameraError}</p>}
                      <p className="text-gray-400 text-sm">Camera is not active</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-4 flex gap-3">
                {scanning ? (
                  <button onClick={stopCamera} className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-colors">
                    Stop Camera
                  </button>
                ) : (
                  <button onClick={startCamera} className="flex-1 py-3 bg-[#DB0002] text-white rounded-lg font-semibold hover:bg-[#B80002] transition-colors">
                    Start Camera
                  </button>
                )}
                <button onClick={() => fileInputRef.current?.click()} className="px-5 py-3 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200 transition-colors">
                  Upload Image
                </button>
              </div>
            </div>
          </div>

          {/* Manual entry */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Enter Code Manually</h2>
            <p className="text-gray-600 text-sm mb-6">Can&apos;t scan? Enter the merchant code manually below.</p>
            <button
              type="button"
              onClick={openTambobbqTestOrder}
              className="mb-4 w-full rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-bold text-amber-950 hover:bg-amber-200"
            >
              Test TambobBQ in-store order
            </button>
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Enter merchant code or slug..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
              />
              <button type="submit" className="w-full py-3 bg-[#DB0002] text-white rounded-lg font-semibold hover:bg-[#B80002] transition-colors">
                Go to Merchant
              </button>
            </form>

            {scannedResult && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-green-800 font-medium text-sm break-all">Scanned: {scannedResult}</span>
                </div>
              </div>
            )}

            <div className="mt-8">
              <h3 className="text-sm font-bold text-gray-900 mb-3">How it works</h3>
              <div className="space-y-3">
                {[
                  { step: '1', text: 'Look for the QR code at the merchant\'s store' },
                  { step: '2', text: 'Scan the code with your camera or upload a photo of it' },
                  { step: '3', text: 'View their menu, products, and exclusive offers' },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-[#DB0002] rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-bold">{item.step}</span>
                    </div>
                    <p className="text-sm text-gray-600">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
