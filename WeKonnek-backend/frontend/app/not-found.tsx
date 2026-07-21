import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-5xl">🔍</span>
        </div>
        <h1 className="text-4xl font-bold text-gray-900 mb-2">404</h1>
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Page not found</h2>
        <p className="text-sm text-gray-500 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="px-6 py-3 bg-[#DB0002] text-white text-sm font-semibold rounded-full hover:bg-[#B80002] transition-colors"
          >
            Go to Home
          </Link>
          <Link
            href="/customer/dashboard"
            className="px-6 py-3 border-2 border-gray-300 text-gray-700 text-sm font-semibold rounded-full hover:bg-gray-100 transition-colors"
          >
            My Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
