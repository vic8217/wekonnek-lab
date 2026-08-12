'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';
import { uploadApi } from '@/lib/api';

type Card = { type: 'sc' | 'pwd'; reference: string; name: string; address: string; idPhoto: string };
type Item = { id: number; product_name: string; variant_name?: string | null; image_url?: string | null; quantity: number; price: number; subtotal: number };
type Order = { id: number; order_code: string; status: string; order_type: string; table_number?: string; total_amount: number; discount_type?: 'sc_pwd' | 'voucher' | null; discount_details?: { totalDiners?: number; eligibleDiners?: number; cards?: Card[]; code?: string } | null; order_items: Item[]; merchants?: { name: string } };
type Voucher = { id: string; code: string; title: string; discountType: 'percentage' | 'fixed'; discountValue: number; maxDiscountAmount?: number | null; minOrderAmount?: number };

function DinerCounter({ label, value, onDecrease, onIncrease }: { label: string; value: number; onDecrease: () => void; onIncrease: () => void }) {
  return <div><p className="text-xs font-bold">{label}</p><div className="mt-1 flex h-11 items-center overflow-hidden rounded-xl border bg-white"><button type="button" onClick={onDecrease} className="grid h-full w-10 place-items-center border-r text-xl font-bold text-gray-600" aria-label={`Decrease ${label}`}>−</button><output className="flex-1 text-center text-sm font-bold">{value}</output><button type="button" onClick={onIncrease} className="grid h-full w-10 place-items-center border-l text-xl font-bold text-red-600" aria-label={`Increase ${label}`}>+</button></div></div>;
}

export default function BillOutPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [discountType, setDiscountType] = useState<'none' | 'sc_pwd' | 'voucher'>('none');
  const [totalDiners, setTotalDiners] = useState(1);
  const [eligibleDiners, setEligibleDiners] = useState(1);
  const [cards, setCards] = useState<Card[]>([{ type: 'sc', reference: '', name: '', address: '', idPhoto: '' }]);
  const [uploadingCard, setUploadingCard] = useState<number | null>(null);
  const [voucherCode, setVoucherCode] = useState('');
  const [showComputation, setShowComputation] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      const token = getToken();
      if (!token) return router.push(`/auth/login?redirect=${encodeURIComponent(`/customer/orders/${id}/bill-out`)}`);
      try {
        const [orderRes, voucherRes] = await Promise.all([
          fetch(`/api/backend/orders/${id}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
          fetch('/api/backend/vouchers/customer/available', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
        ]);
        if (!orderRes.ok) throw new Error('Unable to load the billing statement');
        const loadedOrder = await orderRes.json() as Order;
        setOrder(loadedOrder);
        const savedDiscount = loadedOrder.discount_details;
        if (loadedOrder.discount_type === 'sc_pwd' && savedDiscount) {
          const savedTotal = Math.max(1, Number(savedDiscount.totalDiners || 1));
          const savedEligible = Math.max(1, Math.min(savedTotal, Number(savedDiscount.eligibleDiners || 1)));
          setDiscountType('sc_pwd');
          setTotalDiners(savedTotal);
          setEligibleDiners(savedEligible);
          setCards(Array.from({ length: savedEligible }, (_, index) => savedDiscount.cards?.[index] || { type: 'sc', reference: '', name: '', address: '', idPhoto: '' }));
        } else if (loadedOrder.discount_type === 'voucher' && savedDiscount?.code) {
          setDiscountType('voucher');
          setVoucherCode(savedDiscount.code);
        }
        if (voucherRes.ok) {
          const body = await voucherRes.json();
          setVouchers(Array.isArray(body) ? body : body.data || []);
        }
        setDraftReady(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Unable to load bill-out');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id, router]);

  useEffect(() => {
    if (!draftReady || !order || order.status !== 'ready') return;
    setDraftSaved(false);
    const timer = window.setTimeout(async () => {
      const token = getToken(); if (!token) return;
      const response = await fetch(`/api/backend/orders/${id}/bill-out-draft`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ discountType, totalDiners, eligibleDiners, cards, voucherCode }) });
      if (response.ok) setDraftSaved(true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [cards, discountType, draftReady, eligibleDiners, id, order, totalDiners, voucherCode]);

  const setEligibleCount = (next: number) => {
    const count = Math.max(1, Math.min(totalDiners, next));
    setEligibleDiners(count);
    setCards(current => Array.from({ length: count }, (_, index) => current[index] || { type: 'sc', reference: '', name: '', address: '', idPhoto: '' }));
  };

  const captureId = async (index: number, file?: File) => {
    if (!file) return;
    setUploadingCard(index);
    try {
      const idPhoto = await uploadApi.uploadFile(file, 'document');
      setCards(rows => rows.map((row, cardIndex) => cardIndex === index ? { ...row, idPhoto } : row));
      toast.success('ID image captured');
    } catch {
      toast.error('Unable to upload the ID image');
    } finally {
      setUploadingCard(null);
    }
  };

  const gross = Number(order?.total_amount || 0);
  const selectedVoucher = vouchers.find(voucher => voucher.code === voucherCode);
  const cardDetailsComplete = cards.length === eligibleDiners && cards.every(card => card.reference.trim() && card.name.trim() && card.address.trim());
  const estimatedDiscount = useMemo(() => {
    if (discountType === 'sc_pwd') {
      const eligibleShare = gross * (eligibleDiners / Math.max(1, totalDiners));
      const vatExclusiveShare = eligibleShare / 1.12;
      return Math.round(((eligibleShare - vatExclusiveShare) + (vatExclusiveShare * 0.2)) * 100) / 100;
    }
    if (discountType === 'voucher' && selectedVoucher) {
      const amount = selectedVoucher.discountType === 'percentage' ? gross * selectedVoucher.discountValue / 100 : selectedVoucher.discountValue;
      return Math.min(gross, selectedVoucher.maxDiscountAmount ? Math.min(amount, selectedVoucher.maxDiscountAmount) : amount);
    }
    return 0;
  }, [discountType, eligibleDiners, gross, selectedVoucher, totalDiners]);

  const submit = async () => {
    const token = getToken();
    if (!token) return;
    if (discountType === 'sc_pwd' && !cardDetailsComplete) {
      const missing = cards.flatMap((card, index) => [!card.reference.trim() ? `Cardholder ${index + 1} reference` : '', !card.name.trim() ? `Cardholder ${index + 1} name` : '', !card.address.trim() ? `Cardholder ${index + 1} address` : '']).filter(Boolean);
      toast.error(`Complete: ${missing.join(', ')}`);
      return;
    }
    setSubmitting(true);
    try {
      const submittedTotalDiners = totalDiners;
      const submittedEligibleDiners = eligibleDiners;
      const submittedCards = cards.map(card => ({ ...card }));
      const response = await fetch(`/api/backend/orders/${id}/bill-out`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ discountType, totalDiners: submittedTotalDiners, eligibleDiners: submittedEligibleDiners, cards: submittedCards, voucherCode }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message || 'Bill-out request failed');
      if (body.status !== 'bill_out') throw new Error('The bill-out request was not saved. Please try again.');
      if (discountType === 'sc_pwd') {
        const saved = body.discount_details;
        const countsMatch = Number(saved?.totalDiners) === submittedTotalDiners
          && Number(saved?.eligibleDiners) === submittedEligibleDiners
          && Array.isArray(saved?.cards)
          && saved.cards.length === submittedEligibleDiners;
        if (!countsMatch) throw new Error('The diner and SC/PWD counts were not saved. Please try again.');
      }
      toast.success(discountType === 'sc_pwd' ? `Bill-out saved for ${submittedEligibleDiners} of ${submittedTotalDiners} diners` : 'Bill-out requested');
      router.replace(`/customer/orders/${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bill-out request failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-10 text-center text-sm text-gray-500">Loading billing statement…</div>;
  if (!order) return <div className="p-10 text-center text-sm text-gray-500">Billing statement unavailable.</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
      <div className="rounded-2xl bg-gradient-to-r from-[#171313] via-[#60200c] to-[#1a1717] p-5 text-white shadow-lg">
        <button onClick={() => router.push(`/customer/orders/${id}`)} className="text-xs font-bold text-white/80">‹ Back to order</button>
        <p className="mt-4 text-xs font-bold uppercase tracking-wider text-white/60">Billing statement</p>
        <h1 className="mt-1 text-2xl font-black">{order.merchants?.name || 'Dine-in order'}</h1>
        <p className="mt-1 text-sm text-white/80">{order.order_code}{order.table_number ? ` · ${order.table_number}` : ''}</p>
      </div>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="font-black">Served items</h2>
        <div className="mt-3 divide-y">
          {order.order_items.map(item => <div key={item.id} className="flex items-center gap-3 py-3"><div className="size-14 overflow-hidden rounded-xl bg-gray-100">{item.image_url ? <img src={item.image_url} alt="" className="size-full object-cover" /> : null}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.product_name}</p>{item.variant_name && <p className="text-xs text-gray-500">{item.variant_name}</p>}<p className="text-xs text-gray-500">{item.quantity} × ₱{Number(item.price).toFixed(2)}</p></div><b className="text-sm">₱{Number(item.subtotal).toFixed(2)}</b></div>)}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="font-black">Claim a discount</h2>
        <p className="mt-1 text-xs text-gray-500">Only one discount type may be claimed.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">{([['none','None'],['sc_pwd','SC / PWD'],['voucher','Voucher']] as const).map(([value,label]) => <button key={value} onClick={() => setDiscountType(value)} className={`min-h-11 rounded-xl border-2 text-xs font-bold ${discountType === value ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-200'}`}>{label}</button>)}</div>

        {discountType === 'sc_pwd' && <div className="mt-4 space-y-3"><div className="grid grid-cols-2 gap-3"><DinerCounter label="Total diners" value={totalDiners} onDecrease={() => { const next = Math.max(1, totalDiners - 1); setTotalDiners(next); if (eligibleDiners > next) setEligibleCount(next); }} onIncrease={() => setTotalDiners(current => current + 1)} /><DinerCounter label="SC/PWD diners" value={eligibleDiners} onDecrease={() => setEligibleCount(eligibleDiners - 1)} onIncrease={() => setEligibleCount(eligibleDiners + 1)} /></div><p className="text-[11px] text-gray-500">Enter the details manually, or optionally capture the ID as a reference.</p>{cards.map((card,index) => <div key={index} className="rounded-xl bg-gray-50 p-3"><p className="text-xs font-black">Cardholder {index + 1}</p><div className="mt-2 grid grid-cols-2 gap-2"><select value={card.type} onChange={event => setCards(rows => rows.map((row,i) => i === index ? {...row,type:event.target.value as 'sc'|'pwd'} : row))} className="rounded-lg border p-2 text-sm"><option value="sc">Senior Citizen</option><option value="pwd">PWD</option></select><input value={card.reference} onChange={event => setCards(rows => rows.map((row,i) => i === index ? {...row,reference:event.target.value} : row))} placeholder="Card reference *" className={`rounded-lg border p-2 text-sm ${!card.reference.trim() ? 'border-red-400 bg-red-50' : ''}`} /></div><input value={card.name} onChange={event => setCards(rows => rows.map((row,i) => i === index ? {...row,name:event.target.value} : row))} placeholder="Cardholder name *" className={`mt-2 w-full rounded-lg border p-2 text-sm ${!card.name.trim() ? 'border-red-400 bg-red-50' : ''}`} /><input value={card.address} onChange={event => setCards(rows => rows.map((row,i) => i === index ? {...row,address:event.target.value} : row))} placeholder="Cardholder address *" className={`mt-2 w-full rounded-lg border p-2 text-sm ${!card.address.trim() ? 'border-red-400 bg-red-50' : ''}`} /><label className="mt-2 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 px-3 text-xs font-bold text-blue-700">📷 {uploadingCard === index ? 'Uploading ID…' : card.idPhoto ? 'Retake optional ID photo' : 'Capture ID (optional)'}<input type="file" accept="image/*" capture="environment" disabled={uploadingCard !== null} onChange={event => { void captureId(index,event.target.files?.[0]); event.target.value = ''; }} className="hidden" /></label>{card.idPhoto && <div className="mt-2 overflow-hidden rounded-lg border bg-white"><img src={card.idPhoto} alt={`Captured ID for cardholder ${index + 1}`} className="h-28 w-full object-cover" /><p className="p-2 text-[10px] font-bold text-green-700">✓ Optional ID image attached</p></div>}</div>)}</div>}

        {discountType === 'voucher' && <div className="mt-4"><label className="text-xs font-bold">Voucher wallet<select value={voucherCode} onChange={event => setVoucherCode(event.target.value)} className="mt-1 w-full rounded-xl border p-3 text-sm font-normal"><option value="">Select an available voucher</option>{vouchers.map(voucher => <option key={voucher.id} value={voucher.code}>{voucher.title} · {voucher.code}</option>)}</select></label>{!vouchers.length && <p className="mt-2 text-xs text-gray-500">No eligible vouchers are currently available in your wallet.</p>}</div>}
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex justify-between text-sm text-gray-600"><span>Served items</span><span>₱{gross.toFixed(2)}</span></div>
        {estimatedDiscount > 0 && <><div className="mt-2 flex justify-between text-sm text-green-700"><span>Estimated discount</span><span>−₱{estimatedDiscount.toFixed(2)}</span></div><button type="button" onClick={() => setShowComputation(current => !current)} className="mt-2 text-xs font-bold text-blue-600">{showComputation ? 'Hide computation' : 'How was this computed?'}</button></>}
        {showComputation && estimatedDiscount > 0 && <div className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-950">
          {discountType === 'sc_pwd' ? <div className="space-y-1"><p><b>Eligible share:</b> ₱{gross.toFixed(2)} × {eligibleDiners}/{totalDiners} = ₱{(gross * eligibleDiners / totalDiners).toFixed(2)}</p><p><b>VAT exemption:</b> ₱{((gross * eligibleDiners / totalDiners) - (gross * eligibleDiners / totalDiners / 1.12)).toFixed(2)}</p><p><b>VAT-exclusive eligible sale:</b> ₱{(gross * eligibleDiners / totalDiners / 1.12).toFixed(2)}</p><p><b>20% SC/PWD discount:</b> ₱{((gross * eligibleDiners / totalDiners / 1.12) * 0.2).toFixed(2)}</p><p><b>Total reduction:</b> ₱{estimatedDiscount.toFixed(2)}</p></div> : selectedVoucher ? <div className="space-y-1"><p><b>{selectedVoucher.title}</b> ({selectedVoucher.code})</p><p>{selectedVoucher.discountType === 'percentage' ? `${selectedVoucher.discountValue}% × ₱${gross.toFixed(2)}` : `Fixed discount of ₱${selectedVoucher.discountValue.toFixed(2)}`}{selectedVoucher.maxDiscountAmount ? `, capped at ₱${selectedVoucher.maxDiscountAmount.toFixed(2)}` : ''}</p><p><b>Voucher discount:</b> ₱{estimatedDiscount.toFixed(2)}</p></div> : null}
        </div>}
        <div className="mt-3 flex justify-between border-t pt-3 text-lg font-black"><span>Amount due</span><span className="text-red-600">₱{Math.max(0,gross-estimatedDiscount).toFixed(2)}</span></div>
        {discountType === 'sc_pwd' && !cardDetailsComplete && <p className="mt-3 text-xs font-semibold text-red-600">Complete every cardholder reference, name, and address before requesting the bill.</p>}
        {order.status === 'ready' && <p className={`mt-2 text-[10px] font-bold ${draftSaved ? 'text-green-600' : 'text-gray-400'}`}>{draftSaved ? '✓ Bill-out details saved' : 'Saving bill-out details…'}</p>}
        <button onClick={() => void submit()} disabled={submitting || (discountType === 'voucher' && !voucherCode)} className="mt-4 min-h-12 w-full rounded-xl bg-red-600 font-black text-white disabled:bg-gray-300">{submitting ? 'Requesting bill…' : 'Confirm & Request Bill-Out'}</button>
      </section>
    </div>
  );
}
