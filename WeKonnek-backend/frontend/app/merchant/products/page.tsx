'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProductsPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the new product page
    router.push('/merchant/products/new');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <p className="text-gray-500">Redirecting to product registration...</p>
    </div>
  );
}
