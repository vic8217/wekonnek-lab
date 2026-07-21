import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy · WeKonnek',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <Link href="/customer/profile" className="text-gray-700 p-1" aria-label="Back">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-base font-bold text-gray-900">Privacy Policy</h1>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-6 space-y-5 text-sm text-gray-600 leading-relaxed">
        <p className="text-gray-400">Last updated: June 2026</p>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-1">1. Information We Collect</h2>
          <p>
            We collect information you provide when you create an account, place orders or
            reservations, and use WeKonnek — including your name, email, phone number, and
            approximate location (used to show nearby shops).
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-1">2. How We Use It</h2>
          <p>
            Your data is used to operate the marketplace: processing orders and payments,
            connecting you with merchants, sending order updates, and improving the service.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-1">3. Location</h2>
          <p>
            Location access is optional and used only to estimate distance to merchants. You can
            deny or revoke it at any time in your browser settings; distance will simply be hidden.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-1">4. Data Sharing</h2>
          <p>
            We share order details with the relevant merchant to fulfill your request. We do not
            sell your personal information.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-1">5. Contact</h2>
          <p>
            For privacy questions or data requests, contact us at{' '}
            <a href="mailto:support@wekonnek.com" className="text-[#DB0002] font-medium">support@wekonnek.com</a>.
          </p>
        </section>
      </div>
    </div>
  );
}
