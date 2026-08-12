"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ReceiptText } from "lucide-react";
import { getToken } from "@/hooks/use-auth";

type Receipt = { id: string; serialNumber: string; orderId: string; orderNumber: string; merchantBusinessName: string; invoiceDate: string; totalAmount: number; status: string };

export default function EReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/backend/invoices/my", { headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store" })
      .then(async r => { if (!r.ok) throw new Error("Unable to load e-receipts"); return r.json(); })
      .then(setReceipts).finally(() => setLoading(false));
  }, []);
  const requestedOrder = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("order");
  const sorted = useMemo(() => requestedOrder ? [...receipts].sort((a) => a.orderId === `wk-order:${requestedOrder}` ? -1 : 1) : receipts, [receipts, requestedOrder]);
  return <main className="mx-auto min-h-screen max-w-3xl bg-slate-50 p-4 text-slate-900 sm:p-6">
    <header className="flex items-center gap-3"><Link href="/customer/profile" className="grid size-11 place-items-center rounded-full bg-white shadow"><ChevronLeft /></Link><div><h1 className="text-xl font-black">E-Receipts</h1><p className="text-xs text-slate-500">Saved electronic receipts from completed transactions</p></div></header>
    <div className="mt-6 space-y-3">{loading ? <p className="text-sm text-slate-500">Loading receipts…</p> : sorted.length === 0 ? <div className="rounded-2xl bg-white p-8 text-center shadow-sm"><ReceiptText className="mx-auto text-slate-400"/><p className="mt-3 font-bold">No e-receipts yet</p></div> : sorted.map(r => <Link key={r.id} href={`/customer/e-receipts/${r.id}`} className={`flex items-center justify-between rounded-2xl border bg-white p-4 shadow-sm ${r.orderId === `wk-order:${requestedOrder}` ? "border-green-500 ring-2 ring-green-100" : "border-slate-200"}`}><div><p className="font-black">{r.merchantBusinessName}</p><p className="text-xs text-slate-500">{r.orderNumber} · {new Date(r.invoiceDate).toLocaleString("en-PH")}</p><p className="mt-1 text-[11px] text-slate-400">Invoice {r.serialNumber}</p></div><div className="text-right"><p className="font-black text-red-600">₱{Number(r.totalAmount).toFixed(2)}</p><span className="text-xs font-bold text-green-600">View receipt →</span></div></Link>)}</div>
  </main>;
}
