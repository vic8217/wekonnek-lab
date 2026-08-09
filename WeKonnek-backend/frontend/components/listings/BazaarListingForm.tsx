'use client';

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Camera, ImagePlus, Images, X } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';
import { merchantCategoriesApi, type MerchantSubCategory } from '@/lib/api';
import AuthGateModal from '@/components/AuthGateModal';
import { notifyHostApp } from '@/lib/listing-host';

type SelectedPhoto = { file?: File; url: string };
type BazaarDraft = { id:string; title:string; description:string; price:string|number; subCategoryId:number; imageUrls:string[]; status:string };

export type ListingDisplayMode = 'pwa' | 'embedded';
export type BazaarListingFormMode = 'create' | 'edit';

export default function BazaarListingForm({ displayMode='pwa', mode='create', listingId }: { displayMode?: ListingDisplayMode; mode?: BazaarListingFormMode; listingId?: string }) {
  const router = useRouter();
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const photosRef = useRef<SelectedPhoto[]>([]);
  const [ready, setReady] = useState(false);
  const [subcategories, setSubcategories] = useState<MerchantSubCategory[]>([]);
  const [categoryError, setCategoryError] = useState('');
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('gcash');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [listing, setListing] = useState<BazaarDraft|null>(null);

  useEffect(() => {
    let cancelled = false;
    const verifyCustomer = async () => {
      const token = getToken();
      const destination=mode==='edit'&&listingId?`/bazaar/listings/${listingId}/edit${displayMode==='embedded'?'?mode=embedded':''}`:`/bazaar/post${displayMode==='embedded'?'?mode=embedded':''}`;
      if (!token) { router.replace(`/auth/login?redirect=${encodeURIComponent(destination)}`); return; }
      const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const account = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok || (account?.userType ?? account?.role) !== 'customer') {
        router.replace(`/auth/login?redirect=${encodeURIComponent(destination)}`);
        return;
      }
      if (cancelled) return;
      try {
        const [category,ownedListing]=await Promise.all([
          merchantCategoriesApi.getBySlug('bazaar'),
          mode==='edit'&&listingId?fetch(`/api/backend/bazaar-listings/mine/${listingId}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'}).then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Unable to load this listing');return body as BazaarDraft;}):Promise.resolve(null),
        ]);
        if(cancelled)return;
        setSubcategories(category.subCategories||[]);
        setListing(ownedListing);
        if(ownedListing)setPhotos((Array.isArray(ownedListing.imageUrls)?ownedListing.imageUrls:[]).map(url=>({url})));
      }catch(error){if(!cancelled)setCategoryError(error instanceof Error?error.message:'Unable to load Bazaar listing details.');}
      if(!cancelled)setReady(true);
    };
    void verifyCustomer();
    return () => { cancelled = true; };
  }, [router,mode,listingId,displayMode]);

  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => photosRef.current.forEach(photo => URL.revokeObjectURL(photo.url)), []);

  const addPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    setPhotos(current => [
      ...current,
      ...selected.slice(0, Math.max(0, 5 - current.length)).map(file => ({ file, url: URL.createObjectURL(file) })),
    ]);
    event.target.value = '';
  };

  const removePhoto = (url: string) => {
    URL.revokeObjectURL(url);
    setPhotos(current => current.filter(photo => photo.url !== url));
  };

  const prepareListing = async (form: HTMLFormElement) => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const token = getToken();
      const session = await fetch('/api/backend/auth/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!token || !session.ok) {
        setAuthOpen(true);
        return;
      }
      const data = new FormData(form);
      const uploadData = new FormData();
      photos.forEach(photo => { if(photo.file) uploadData.append('files', photo.file); });
      uploadData.append('type', 'document');
      let uploadedUrls:string[]=[];
      if(photos.some(photo=>photo.file)){
        const uploadResponse = await fetch('/api/backend/upload/multiple', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: uploadData });
        const uploadBody = await uploadResponse.json().catch(() => ({}));
        if (!uploadResponse.ok || !Array.isArray(uploadBody.urls)) throw new Error(uploadBody.message || 'Unable to upload product photos');
        uploadedUrls=uploadBody.urls;
      }
      const imageUrls = [...photos.filter(photo=>!photo.file).map(photo=>photo.url),...uploadedUrls].slice(0,5);
      const editing=mode==='edit'&&listingId;
      const response = await fetch(editing?`/api/backend/bazaar-listings/mine/${listingId}`:'/api/backend/bazaar-listings/drafts', {
        method: editing?'PATCH':'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: data.get('title'), subCategoryId: Number(data.get('subCategoryId')), price: Number(data.get('price')), description: data.get('description'), imageUrls }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Unable to save your listing draft');
      if(editing){notifyHostApp(displayMode,{event:'LISTING_UPDATED',listingType:'BAZAAR',listingId});if(displayMode==='pwa')router.push(`/bazaar/listings/${listingId}`);return;}
      setDraftId(body.id);
      setPaymentOpen(true);
      notifyHostApp(displayMode,{event:'LISTING_CREATED',listingType:'BAZAAR',listingId:body.id});
      notifyHostApp(displayMode,{event:'LISTING_PAYMENT_REQUIRED',listingType:'BAZAAR',listingId:body.id});
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to prepare the listing');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!photos.length) {
      alert('Please add at least one product photo.');
      return;
    }
    void prepareListing(event.currentTarget);
  };

  const continueToGateway = async () => {
    if (!draftId) return;
    setSubmitting(true); setSubmitError('');
    try {
      const gateway = paymentMethod === 'maya' ? 'maya' : 'paymongo';
      const response = await fetch(`/api/backend/bazaar-listings/${draftId}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ gateway, paymentMethod }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) { setPaymentOpen(false); setAuthOpen(true); return; }
      if (!response.ok) throw new Error(body.message || 'Unable to start payment');
      if (!body.paymentUrl) throw new Error('The payment provider did not return a checkout link');
      window.location.href = body.paymentUrl;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to start payment');
    } finally { setSubmitting(false); }
  };

  if (!ready) return <div className="flex min-h-screen items-center justify-center"><div className="size-9 animate-spin rounded-full border-4 border-red-600 border-t-transparent" /></div>;

  return <main className="min-h-screen bg-slate-50 px-4 py-8">
    <form ref={formRef} onSubmit={submit} className="mx-auto max-w-2xl rounded-2xl border bg-white p-6 shadow-sm">
      {displayMode==='pwa'&&<Link href="/customer/explore/bazaar" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={17} /> Back to Bazaar</Link>}
      <h1 className={`${displayMode==='pwa'?'mt-5':''} text-3xl font-black`}>{mode==='edit'?'Edit Item':'Post an Item'}</h1>
      <p className="mt-2 text-sm text-slate-500">Create a searchable Bazaar listing for ₱15 for 7 days.</p>

      <div className="mt-6 grid gap-5">
        <label className="text-sm font-bold">Item title<input name="title" required defaultValue={listing?.title||''} className="mt-2 w-full rounded-xl border px-4 py-3 font-normal" placeholder="What are you selling?" /></label>

        <label className="text-sm font-bold">Bazaar subcategory
          <select name="subCategoryId" required defaultValue={listing?.subCategoryId||''} disabled={!subcategories.length} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 font-normal disabled:bg-slate-50">
            <option value="" disabled>{categoryError || (subcategories.length ? 'Select a subcategory' : 'Loading subcategories…')}</option>
            {subcategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {categoryError && <span className="mt-1 block text-xs font-normal text-red-600">{categoryError}</span>}
        </label>

        <label className="text-sm font-bold">Price<input name="price" required type="number" min="0" step="0.01" defaultValue={listing?.price||''} className="mt-2 w-full rounded-xl border px-4 py-3 font-normal" placeholder="₱0.00" /></label>
        <label className="text-sm font-bold">Description<textarea name="description" required rows={5} defaultValue={listing?.description||''} className="mt-2 w-full rounded-xl border px-4 py-3 font-normal" placeholder="Describe the condition, details, and pickup options." /></label>

        <fieldset>
          <legend className="text-sm font-bold">Product photos <span className="font-normal text-slate-500">({photos.length}/5)</span></legend>
          <input ref={galleryInput} type="file" accept="image/jpeg,image/png" multiple onChange={addPhotos} className="sr-only" aria-label="Choose product photos from gallery" />
          <input ref={cameraInput} type="file" accept="image/jpeg,image/png" capture="environment" onChange={addPhotos} className="sr-only" aria-label="Take a product photo with camera" />

          {photos.length > 0 && <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">{photos.map((photo, index) => <div key={photo.url} className="relative aspect-square overflow-hidden rounded-xl border bg-slate-100"><img src={photo.url} alt={`Selected product photo ${index + 1}`} className="size-full object-cover" /><button type="button" onClick={() => removePhoto(photo.url)} aria-label={`Remove product photo ${index + 1}`} className="absolute right-1 top-1 rounded-full bg-slate-950/75 p-1 text-white"><X size={14} /></button></div>)}</div>}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <button type="button" disabled={photos.length >= 5} onClick={() => galleryInput.current?.click()} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-sm font-bold text-slate-600 transition hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"><Images /> Choose from Gallery</button>
            <button type="button" disabled={photos.length >= 5} onClick={() => cameraInput.current?.click()} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-sm font-bold text-slate-600 transition hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"><Camera /> Take a Picture</button>
          </div>
          <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><ImagePlus size={14} /> Add up to 5 clear photos. The first photo will be your cover image.</p>
        </fieldset>

        {submitError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{submitError}</p>}
        <button disabled={submitting} className="min-h-12 rounded-xl bg-red-600 font-black text-white transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60">{submitting ? 'Preparing your listing…' : mode==='edit'?'Save Listing Changes':'Continue to Listing Payment'}</button>
      </div>
    </form>
    {paymentOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"><section role="dialog" aria-modal="true" aria-labelledby="listing-payment-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 id="listing-payment-title" className="text-2xl font-black">Listing Payment</h2><p className="mt-1 text-sm text-slate-500">Activate your Bazaar listing for seven days.</p></div><button onClick={() => setPaymentOpen(false)} aria-label="Close payment review" className="rounded-full p-2 hover:bg-slate-100"><X /></button></div><div className="mt-5 rounded-xl bg-slate-50 p-4"><div className="flex justify-between text-sm"><span>7-day Bazaar listing</span><b>₱15.00</b></div><div className="mt-3 flex justify-between border-t pt-3 font-black"><span>Total</span><span>₱15.00</span></div></div><fieldset className="mt-5"><legend className="text-sm font-black">Payment method</legend><div className="mt-2 grid grid-cols-3 gap-2">{[['gcash','GCash'],['card','Card'],['maya','Maya']].map(([value,label]) => <label key={value} className={`cursor-pointer rounded-xl border p-3 text-center text-sm font-bold ${paymentMethod === value ? 'border-red-500 bg-red-50 text-red-700' : ''}`}><input type="radio" name="paymentMethod" value={value} checked={paymentMethod === value} onChange={() => setPaymentMethod(value)} className="sr-only" />{label}</label>)}</div></fieldset>{submitError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{submitError}</p>}<button onClick={continueToGateway} disabled={submitting} className="mt-5 min-h-12 w-full rounded-xl bg-red-600 font-black text-white disabled:opacity-60">{submitting ? 'Opening secure checkout…' : 'Pay ₱15.00 & Publish'}</button><p className="mt-3 text-center text-[11px] text-slate-500">Your listing remains a private draft until payment is confirmed.</p></section></div>}
    <AuthGateModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthenticated={() => { setAuthOpen(false); if (draftId) setPaymentOpen(true); else if (formRef.current) void prepareListing(formRef.current); }} title="Sign in to continue your listing" subtitle="Your form and selected photos are still here. Sign in to save the draft and continue to payment." />
  </main>;
}
