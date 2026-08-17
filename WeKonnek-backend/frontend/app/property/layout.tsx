'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import CustomerHeader from '@/components/CustomerHeader';
import MobileBottomNav from '@/components/MobileBottomNav';
export default function PropertyLayout({ children }: { children: React.ReactNode }) {
 const pathname=usePathname();
 const standalone=pathname==='/property';
 const isPostingFlow=pathname==='/property/post'||pathname.startsWith('/property/listings/');
 const [embedded,setEmbedded]=useState(false);
 useEffect(()=>setEmbedded(new URLSearchParams(window.location.search).get('mode')==='embedded'),[]);
 return <div className="min-h-screen overflow-x-hidden bg-slate-50">{!embedded&&<div className={standalone?'xl:hidden':''}><CustomerHeader hideMobileSearch={isPostingFlow}/></div>}<main className={`min-w-0 overflow-x-hidden ${embedded?'':standalone?'pb-24 xl:pb-0':'pb-24'}`}>{children}</main>{!embedded&&<div className="xl:hidden"><MobileBottomNav/></div>}</div>;
}
