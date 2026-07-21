'use client';

import { AuthProvider } from '@/hooks/use-auth';
import type { ReactNode } from 'react';

/**
 * Single file that wraps all client-side providers.
 * Add future providers (theme, toast, query-client, etc.) here.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
