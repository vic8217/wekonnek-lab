'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useRequireAuth } from '@/hooks/use-auth';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === '/admin/login') return children;

  return <ProtectedAdminLayout>{children}</ProtectedAdminLayout>;
}

function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(['admin', 'staff'], '/admin/login');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <img src="/logo/weKonnekLogov1.png" alt="WeKonnek" className="w-24 h-16 mb-4 animate-pulse object-contain" />
        <div className="w-8 h-8 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-gray-50">
      <div className="sticky top-0 z-50"><AdminHeader onMenuClick={() => setSidebarOpen(true)} /></div>
      <div className="flex min-w-0">
        <AdminSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
