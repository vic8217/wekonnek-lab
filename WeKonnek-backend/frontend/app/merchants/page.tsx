import { redirect } from 'next/navigation';

/** Legacy merchant directory: preserve no public directory surface. */
export default function LegacyMerchantDirectoryPage() {
  redirect('/customer/dashboard');
}
