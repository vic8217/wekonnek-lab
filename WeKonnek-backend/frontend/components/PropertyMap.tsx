'use client';
import Link from 'next/link';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import type { PropertyListing } from '@/lib/property';

export default function PropertyMap({ listings, center, embedded=false }: { listings: PropertyListing[]; center?: {lat:number;lng:number}|null; embedded?: boolean }) {
  const mapped=listings.filter(item=>Number.isFinite(Number(item.latitude))&&Number.isFinite(Number(item.longitude)));
  const initial:centerTuple = center ? [center.lat,center.lng] : mapped[0] ? [Number(mapped[0].latitude),Number(mapped[0].longitude)] : [14.5995,120.9842];
  return <div className={embedded?'h-full min-h-[520px] overflow-hidden':'mt-5 h-[560px] overflow-hidden rounded-2xl border'}><MapContainer center={initial} zoom={center||mapped.length?13:10} className="size-full" scrollWheelZoom><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>{mapped.map(item=><CircleMarker key={item.id} center={[Number(item.latitude),Number(item.longitude)]} radius={12} pathOptions={{color:'#fff',weight:3,fillColor:item.isFeatured?'#f59e0b':'#DB0002',fillOpacity:1}}><Popup><div className="min-w-44"><p className="text-base font-black text-red-700">₱{Number(item.price).toLocaleString()}</p><p className="font-bold">{item.title}</p><p className="text-xs text-slate-500">{item.propertyType.name} · {item.city}</p><Link href={`/property/${item.slug}`} className="mt-2 inline-block font-bold text-blue-700">View property →</Link></div></Popup></CircleMarker>)}</MapContainer></div>;
}

type centerTuple = [number,number];
