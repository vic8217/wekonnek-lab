'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Footer from './Footer';

export default function ConditionalFooter() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const hideFooter = pathname === '/' ||
                     pathname?.startsWith('/admin') || 
                     pathname?.startsWith('/merchant') || 
                     pathname?.startsWith('/customer') ||
                     pathname?.startsWith('/auth') ||
                     pathname === '/coordinator' ||
                     pathname?.startsWith('/coordinator/');

  if (hideFooter) {
    return null;
  }

  return <Footer />;
}
