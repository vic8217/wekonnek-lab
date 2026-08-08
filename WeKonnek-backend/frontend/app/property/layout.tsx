'use client';
import CustomerHeader from '@/components/CustomerHeader';
import MobileBottomNav from '@/components/MobileBottomNav';
export default function PropertyLayout({ children }: { children: React.ReactNode }) { return <div className="min-h-screen bg-slate-50"><CustomerHeader/><main className="pb-24">{children}</main><div className="xl:hidden"><MobileBottomNav/></div></div>; }
