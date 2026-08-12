"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronLeft, Printer } from "lucide-react";
import { getToken } from "@/hooks/use-auth";

type Item = { description: string; quantity: number; unitPrice: number; amount: number };
type Receipt = { serialNumber: string; status: string; invoiceDate: string; merchantBusinessName: string; merchantTin: string; merchantAddress: string; merchantBirPermit?: string; merchantRdoCode?: string; customerName?: string; orderNumber: string; orderType?: string; lineItems: Item[]; subtotal: number; discount: number; discountDescription?: string; vatableSales: number; vatAmount: number; vatExemptSales: number; zeroRatedSales: number; totalAmount: number; paymentMethod?: string; paymentReference?: string };

export default function EReceiptPage() {
  const { id } = useParams<{id:string}>(); const [r, setR] = useState<Receipt|null>(null);
  useEffect(() => { fetch(`/api/backend/invoices/my/${id}`, { headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store" }).then(x => x.ok ? x.json() : Promise.reject()).then(setR); }, [id]);
  if (!r) return <main className="grid min-h-screen place-items-center">Loading e-receipt…</main>;
  return <main className="mx-auto min-h-screen max-w-2xl bg-slate-100 p-4 text-slate-950 sm:p-8"><div className="mb-4 flex items-center justify-between print:hidden"><Link href="/customer/e-receipts" className="flex items-center gap-1 font-bold"><ChevronLeft/> E-Receipts</Link><button onClick={() => window.print()} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 font-bold text-white"><Printer size={17}/> Print / Save PDF</button></div>
  <article className="border border-slate-900 bg-white p-6 text-xs shadow-sm"><header className="text-center"><p className="text-[10px] font-black tracking-[.2em] text-red-600">SALES INVOICE · ELECTRONIC RECEIPT</p><h1 className="mt-2 text-xl font-black">{r.merchantBusinessName}</h1><p>{r.merchantAddress}</p><p>TIN: {r.merchantTin} · VAT REGISTERED</p>{r.merchantBirPermit && <p>BIR Permit: {r.merchantBirPermit} · RDO: {r.merchantRdoCode || "—"}</p>}</header>
  <section className="mt-5 grid grid-cols-2 border-y border-slate-900 py-3"><div><b>Invoice no.</b><p>{r.serialNumber}</p><b className="mt-2 block">Sold to</b><p>{r.customerName || "Cash customer"}</p></div><div className="text-right"><b>Transaction date</b><p>{new Date(r.invoiceDate).toLocaleString("en-PH")}</p><b className="mt-2 block">Order</b><p>{r.orderNumber} · {r.orderType}</p></div></section>
  <table className="mt-4 w-full"><thead><tr className="border-b text-left"><th className="py-2">Description</th><th>Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead><tbody>{r.lineItems.map((i,n)=><tr key={n} className="border-b"><td className="py-2">{i.description}</td><td>{i.quantity}</td><td className="text-right">₱{Number(i.unitPrice).toFixed(2)}</td><td className="text-right font-bold">₱{Number(i.amount).toFixed(2)}</td></tr>)}</tbody></table>
  <section className="ml-auto mt-4 max-w-xs space-y-1"><Row l="Gross sales (VAT inclusive)" v={r.subtotal}/>{r.discount>0&&<Row l={`Less: ${r.discountDescription || "Discount"}`} v={-r.discount}/>}<Row l="VATable sales" v={r.vatableSales}/><Row l="VAT amount (12%)" v={r.vatAmount}/><Row l="VAT-exempt sales" v={r.vatExemptSales}/><Row l="Zero-rated sales" v={r.zeroRatedSales}/><div className="mt-2 flex justify-between border-t border-slate-900 pt-2 text-base font-black"><span>Total paid</span><span className="text-red-600">₱{Number(r.totalAmount).toFixed(2)}</span></div></section>
  <footer className="mt-5 border-t pt-3 text-center text-[10px] text-slate-600"><p>Payment: {r.paymentMethod || "—"}{r.paymentReference ? ` · Reference ${r.paymentReference}` : ""}</p><p className="mt-1">This electronic invoice is stored in your WeKonnek customer profile.</p></footer></article></main>;
}
function Row({l,v}:{l:string;v:number}) { return <div className="flex justify-between"><span>{l}</span><span>{v<0?"−":""}₱{Math.abs(Number(v)).toFixed(2)}</span></div> }
