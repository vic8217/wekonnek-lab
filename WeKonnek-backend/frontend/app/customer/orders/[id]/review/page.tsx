"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, ChevronLeft, ImagePlus, Star, X } from "lucide-react";
import toast from "react-hot-toast";
import { getToken } from "@/hooks/use-auth";
import { uploadApi } from "@/lib/api";

type Order = { id:number; status:string; merchant_id:number; order_code:string; merchants?:{name?:string}|null };
type Photo = { file: File; preview: string };

export default function OrderReviewPage() {
  const { id } = useParams<{id:string}>(); const router = useRouter();
  const [order,setOrder]=useState<Order|null>(null); const [rating,setRating]=useState(0); const [text,setText]=useState(""); const [photos,setPhotos]=useState<Photo[]>([]); const [saving,setSaving]=useState(false);
  useEffect(()=>{fetch(`/api/backend/orders/${id}`,{headers:{Authorization:`Bearer ${getToken()}`},cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then(setOrder).catch(()=>toast.error("Unable to load order"));},[id]);
  function addPhotos(e:ChangeEvent<HTMLInputElement>){const chosen=Array.from(e.target.files||[]).slice(0,5-photos.length); setPhotos(p=>[...p,...chosen.map(file=>({file,preview:URL.createObjectURL(file)}))]); e.target.value="";}
  async function submit(){if(!order||rating<1)return toast.error("Choose a rating"); setSaving(true); try {const urls=await Promise.all(photos.map(p=>uploadApi.uploadFile(p.file,"review"))); const response=await fetch("/api/backend/reviews",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},body:JSON.stringify({merchant_id:order.merchant_id,order_id:String(order.id),rating,review_text:text,photo_urls:urls})}); const body=await response.json().catch(()=>({})); if(!response.ok)throw new Error(body.message||"Unable to submit review"); toast.success("Thank you for your review"); router.replace("/customer/reviews");}catch(e){toast.error(e instanceof Error?e.message:"Unable to submit review");}finally{setSaving(false)}}
  if(!order)return <main className="grid min-h-screen place-items-center">Loading order…</main>;
  return <main className="mx-auto min-h-screen max-w-xl bg-slate-50 p-4 text-slate-950 sm:p-6"><header className="flex items-center gap-3"><Link href={`/customer/orders/${id}`} className="grid size-11 place-items-center rounded-full bg-white shadow"><ChevronLeft/></Link><div><h1 className="text-xl font-black">Rate your experience</h1><p className="text-xs text-slate-500">{order.merchants?.name || "Merchant"} · {order.order_code}</p></div></header>
  {order.status!=="completed"?<section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900">You can submit a review after the transaction is completed.</section>:<section className="mt-6 space-y-5 rounded-2xl bg-white p-5 shadow-sm"><div className="text-center"><p className="font-bold">How was your dining experience?</p><div className="mt-3 flex justify-center gap-2">{[1,2,3,4,5].map(n=><button key={n} onClick={()=>setRating(n)} aria-label={`${n} stars`} className="p-1"><Star className={n<=rating?"fill-amber-400 text-amber-400":"text-slate-300"} size={36}/></button>)}</div></div>
  <label className="block"><span className="text-sm font-black">Tell us more</span><textarea value={text} onChange={e=>setText(e.target.value)} rows={5} maxLength={1000} placeholder="Food served, service, and ambiance…" className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-red-500"/></label>
  <div><p className="text-sm font-black">Add photos <span className="font-normal text-slate-400">(optional, up to 5)</span></p><p className="mt-1 text-xs text-slate-500">Share the food served or the restaurant ambiance.</p><div className="mt-3 grid grid-cols-3 gap-2">{photos.map((p,i)=><div key={p.preview} className="relative aspect-square"><Image src={p.preview} alt={`Review photo ${i+1}`} fill unoptimized className="rounded-xl object-cover"/><button onClick={()=>setPhotos(x=>x.filter((_,n)=>n!==i))} className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/70 text-white"><X size={15}/></button></div>)}</div>
  {photos.length<5&&<div className="mt-3 grid grid-cols-2 gap-2"><label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-red-500 font-bold text-red-600"><Camera size={19}/> Take photo<input type="file" accept="image/*" capture="environment" onChange={addPhotos} className="hidden"/></label><label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 font-bold"><ImagePlus size={19}/> Upload photos<input type="file" accept="image/*" multiple onChange={addPhotos} className="hidden"/></label></div>}</div>
  <button disabled={saving||rating<1} onClick={()=>void submit()} className="min-h-12 w-full rounded-xl bg-[#DB0002] font-black text-white disabled:bg-slate-300">{saving?"Submitting…":"Submit review"}</button></section>}</main>;
}
