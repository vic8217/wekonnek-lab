import Link from 'next/link';
import { Bath, BedDouble, Building2, MapPin, Maximize2, ShieldCheck, Star } from 'lucide-react';
import type { PropertyListing } from '@/lib/property';

const money = (value: string|number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value));

export default function PropertyCard({ listing }: { listing: PropertyListing }) {
  const image = listing.images?.[0]?.imageUrl;
  return <Link href={`/property/${listing.slug || listing.id}`} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
    <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">{image ? <img src={image} alt={listing.title} className="size-full object-cover transition duration-500 group-hover:scale-105"/> : <div className="flex size-full items-center justify-center text-slate-300"><Building2 size={52}/></div>}
      <span className="absolute left-3 top-3 rounded-full bg-slate-950/85 px-3 py-1 text-[11px] font-black text-white">{listing.transactionType === 'FOR_RENT' ? 'FOR RENT' : 'FOR SALE'}</span>
      {listing.isFeatured && <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-black text-slate-950"><Star size={11} fill="currentColor"/> FEATURED</span>}
    </div>
    <div className="p-4"><div className="flex items-start justify-between gap-2"><div><p className="text-xl font-black text-[#DB0002]">{money(listing.price)}{listing.transactionType === 'FOR_RENT' && <span className="text-xs font-bold text-slate-500"> / {listing.pricePeriod.toLowerCase()}</span>}</p><h3 className="mt-1 line-clamp-1 font-black text-slate-950">{listing.title}</h3></div>{listing.isVerified && <ShieldCheck className="mt-1 shrink-0 text-blue-600" size={20}/>}</div>
      <p className="mt-1 text-sm font-semibold text-slate-600">{listing.propertyType?.name}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">{listing.bedrooms != null && <span className="flex items-center gap-1"><BedDouble size={15}/>{listing.bedrooms} Beds</span>}{listing.bathrooms != null && <span className="flex items-center gap-1"><Bath size={15}/>{Number(listing.bathrooms)} Baths</span>}{listing.floorArea != null && <span className="flex items-center gap-1"><Maximize2 size={15}/>{Number(listing.floorArea)} sqm</span>}</div>
      <p className="mt-3 flex items-center gap-1 text-xs text-slate-500"><MapPin size={14}/>{[listing.barangay,listing.city].filter(Boolean).join(', ')}</p>{listing.distanceKm != null && <p className="mt-1 text-xs font-bold text-blue-700">{listing.distanceKm} km away</p>}
    </div>
  </Link>;
}
