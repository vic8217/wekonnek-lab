'use client';

export default function MerchantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-sm mx-auto px-4">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">⚠️</span>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Something went wrong</h2>
        <p className="text-sm text-gray-500 mb-4">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          className="px-5 py-2.5 bg-[#DB0002] text-white text-sm font-semibold rounded-full hover:bg-[#B80002] transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
