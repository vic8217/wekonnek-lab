'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2 } from 'lucide-react';

type Listing={id:string;title:string;description:string;price:string|number;imageUrls:string[];subCategoryName:string;status:string};
export default function BazaarListingPage(){
 const id=String(useParams().listingId||''),[listing,setListing]=useState<Listing|null>(null),[error,setError]=useState('');
 useEffect(()=>{fetch(`/api/backend/bazaar-listings/public/${id}`,{cache:'no-store'}).then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Unable to load listing');setListing(body);}).catch(error=>setError(error.message));},[id]);
 if(error)return <main className="mx-auto max-w-3xl px-4 py-12"><Link href="/customer/explore/bazaar" className="font-bold text-slate-600">← Back to Bazaar</Link><p className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p></main>;
 if(!listing)return <div className="flex min-h-screen items-center justify-center"><div className="size-9 animate-spin rounded-full border-4 border-red-600 border-t-transparent"/></div>;
 const image=listing.imageUrls?.[0];
 return <main className="mx-auto max-w-4xl px-4 py-8"><Link href="/customer/explore/bazaar" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={17}/>Back to Bazaar</Link><article className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="aspect-video bg-slate-100">{image?<img src={image} alt={listing.title} className="size-full object-cover"/>:<div className="flex size-full items-center justify-center text-slate-300"><Building2 size={60}/></div>}</div><div className="p-6"><p className="text-3xl font-black text-red-600">₱{Number(listing.price).toLocaleString()}</p><h1 className="mt-2 text-3xl font-black">{listing.title}</h1><p className="mt-2 text-sm font-bold text-slate-500">{listing.subCategoryName}</p><p className="mt-6 whitespace-pre-wrap text-slate-700">{listing.description}</p></div></article></main>;
}
