"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  FileText,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { getToken } from "@/hooks/use-auth";
import { publicAssetUrl } from "@/lib/public-asset-url";
import Link from "next/link";
import { Megaphone } from "lucide-react";

type Listing = {
  id: string;
  title: string;
  description: string;
  price: string | number;
  imageUrls: string[];
  thumbnailUrls?: string[];
  status: string;
  paymentStatus: string;
  paymentGateway?: string;
  paymentMethod?: string;
  paymentRef?: string;
  publishedAt?: string;
  expiresAt?: string;
  createdAt: string;
  suspendedAt?: string;
  suspensionReason?: string;
  subCategoryName: string;
  seller: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone: string;
  };
};

const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const statusLabel = (status: string) =>
  status === "payment_pending"
    ? "Pending"
    : status === "payment_failed"
      ? "Draft"
      : status.replaceAll("_", " ");
const sellerName = (listing: Listing) =>
  [listing.seller.firstName, listing.seller.lastName]
    .filter(Boolean)
    .join(" ") || "Unnamed customer";
const statusStyle: Record<string, string> = {
  draft: "bg-amber-100 text-amber-800",
  payment_failed: "bg-amber-100 text-amber-800",
  payment_pending: "bg-orange-100 text-orange-800",
  active: "bg-emerald-100 text-emerald-800",
  suspended: "bg-red-100 text-red-800",
  expired: "bg-red-50 text-red-700",
};

export default function BazaarListingsAdminPage() {
  const [items, setItems] = useState<Listing[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [payment, setPayment] = useState("all");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [details, setDetails] = useState<Listing | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<Listing | null>(null);
  const [reasonType, setReasonType] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      status,
      paymentStatus: payment,
      page: String(page),
      limit: String(rowsPerPage),
    });
    if (search.trim()) query.set("search", search.trim());
    try {
      const response = await fetch(
        `/api/backend/bazaar-listings/admin?${query}`,
        {
          headers: { Authorization: `Bearer ${getToken()}` },
          cache: "no-store",
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.message || "Unable to load Bazaar listings.");
      setItems(body.items || []);
      setCounts(body.counts || {});
      setPagination(body.pagination || { page: 1, pages: 1, total: 0 });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load Bazaar listings.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, payment, rowsPerPage, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const moderate = async (
    action: "suspend" | "reinstate",
    listing: Listing,
  ) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/backend/bazaar-listings/admin/${listing.id}/${action}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body:
            action === "suspend"
              ? JSON.stringify({
                  reason: reasonType === "Other" ? reason.trim() : reasonType,
                })
              : undefined,
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.message || `Unable to ${action} listing.`);
      setSuspendTarget(null);
      setDetails(null);
      setReasonType("");
      setReason("");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Unable to ${action} listing.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const cards: Array<[string, number, string, typeof FileText, string]> = [
    ["All", total, "Total listings", FileText, "bg-blue-50 text-blue-600"],
    [
      "Draft",
      (counts.draft || 0) + (counts.payment_failed || 0),
      "Draft listings",
      Clock3,
      "bg-amber-50 text-amber-600",
    ],
    [
      "Pending",
      counts.payment_pending || 0,
      "Awaiting activation",
      CircleAlert,
      "bg-orange-50 text-orange-600",
    ],
    [
      "Active",
      counts.active || 0,
      "Currently active",
      CheckCircle2,
      "bg-emerald-50 text-emerald-600",
    ],
    [
      "Suspended",
      counts.suspended || 0,
      "Temporarily blocked",
      ShieldAlert,
      "bg-orange-50 text-orange-600",
    ],
    [
      "Expired",
      counts.expired || 0,
      "Validity ended",
      Clock3,
      "bg-red-50 text-red-600",
    ],
  ];
  const rangeStart = pagination.total ? (page - 1) * rowsPerPage + 1 : 0;
  const reasons = [
    "Prohibited item",
    "Misleading information",
    "Fraud/scam concern",
    "Duplicate listing",
    "Incorrect category",
    "Policy violation",
    "Seller request",
    "Other",
  ];

  return (
    <div className="space-y-4 text-[#101a33]">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
            Bazaar Listings Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Monitor Bazaar postings, payment status, validity periods, sellers,
            and policy violations.
          </p>
        </div>
        <Link href="/admin/bazaar-promos" className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#e60012] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-700">
          <Megaphone size={17} />
          Promo Cards
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, count, description, Icon, iconClass]) => (
          <article
            key={label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className={`rounded-xl p-2.5 ${iconClass}`}>
                <Icon size={18} />
              </span>
              <strong className="text-2xl font-black text-[#101a33]">
                {count}
              </strong>
            </div>
            <p className="mt-3 text-sm font-black">{label}</p>
            <p className="mt-1 text-xs text-slate-500">{description}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <label className="relative">
            <Search
              size={17}
              className="absolute left-3 top-3 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search item, seller, email, or phone..."
              className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#e60012] focus:ring-2 focus:ring-red-100"
            />
          </label>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#e60012]"
          >
            <option value="all">All listing statuses</option>
            {["draft", "payment_pending", "active", "suspended", "expired"].map(
              (value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ),
            )}
          </select>
          <select
            value={payment}
            onChange={(event) => {
              setPayment(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#e60012]"
          >
            <option value="all">All payments</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"
        >
          {error}{" "}
          <button onClick={() => void load()} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1150px] w-full text-left text-sm">
            <thead className="bg-[#e60012] text-xs font-bold uppercase text-white">
              <tr>
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all listings"
                    className="size-4 accent-white"
                  />
                </th>
                {[
                  "Posting",
                  "Posted By",
                  "Payment",
                  "Status",
                  "Validity",
                  "Action",
                ].map((column) => (
                  <th key={column} className="px-4 py-3">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-slate-500">
                    Loading Bazaar postings…
                  </td>
                </tr>
              ) : !items.length ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-slate-500">
                    {search || status !== "all" || payment !== "all"
                      ? "No listings match the selected filters."
                      : "No Bazaar listings found."}
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.title}`}
                        className="size-4 accent-[#e60012]"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-3">
                        <button onClick={() => setDetails(item)}>
                          <img
                            src={
                              publicAssetUrl(
                                item.thumbnailUrls?.[0] || item.imageUrls?.[0],
                              ) || ""
                            }
                            alt=""
                            className="size-12 rounded-lg border border-slate-200 bg-slate-100 object-cover"
                          />
                        </button>
                        <div>
                          <button
                            onClick={() => setDetails(item)}
                            className="text-left font-black hover:text-[#e60012]"
                          >
                            {item.title}
                          </button>
                          <p className="text-xs text-slate-500">
                            {item.subCategoryName} · ₱
                            {Number(item.price).toLocaleString()}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            ID: {item.id}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-bold">{sellerName(item)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.seller.email || "No email"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.seller.phone}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.paymentStatus === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-red-50 text-red-700"}`}
                      >
                        {item.paymentStatus === "paid" ? "Paid" : "Unpaid"}
                      </span>
                      <p className="mt-2 text-xs text-slate-400">
                        {item.paymentStatus === "paid"
                          ? formatDate(item.publishedAt)
                          : "—"}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle[item.status] || "bg-slate-100 text-slate-700"}`}
                      >
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-xs">
                      <p>
                        <b>Start:</b> {formatDate(item.publishedAt)}
                      </p>
                      <p className="mt-1">
                        <b>End:</b> {formatDate(item.expiresAt)}
                      </p>
                      <p className="mt-2 text-slate-400">
                        Posted {formatDate(item.createdAt)}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setDetails(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"
                        >
                          <Eye size={15} />
                          View
                        </button>
                        {item.status === "active" && (
                          <button
                            disabled={saving}
                            onClick={() => {
                              setSuspendTarget(item);
                              setReasonType("");
                              setReason("");
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
                          >
                            <Trash2 size={15} />
                            Suspend
                          </button>
                        )}
                        {item.status === "suspended" && (
                          <button
                            disabled={saving}
                            onClick={() => void moderate("reinstate", item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                          >
                            <CheckCircle2 size={15} />
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">
            Showing {rangeStart} to{" "}
            {Math.min(page * rowsPerPage, pagination.total)} of{" "}
            {pagination.total} listings
          </span>
          <div className="flex items-center gap-3">
            <button
              aria-label="Previous page"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => current - 1)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="flex size-9 items-center justify-center rounded-lg bg-[#e60012] font-bold text-white">
              {page}
            </span>
            <button
              aria-label="Next page"
              disabled={page >= pagination.pages || loading}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
            <label className="flex items-center gap-2 text-slate-500">
              Rows per page:
              <select
                value={rowsPerPage}
                onChange={(event) => {
                  setRowsPerPage(Number(event.target.value));
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-slate-700"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
          </div>
        </footer>
      </section>

      {details && (
        <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/55">
          <section
            role="dialog"
            aria-modal="true"
            className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">
                  Bazaar listing
                </p>
                <h2 className="text-2xl font-black">{details.title}</h2>
              </div>
              <button
                onClick={() => setDetails(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold"
              >
                Close
              </button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {details.imageUrls.map((url, index) => (
                <img
                  key={`${url}-${index}`}
                  src={publicAssetUrl(url) || ""}
                  alt={`${details.title} photo ${index + 1}`}
                  className="aspect-square w-full rounded-xl border border-slate-200 object-cover"
                />
              ))}
            </div>
            <div className="mt-6 space-y-5 text-sm">
              <section>
                <h3 className="font-black">Listing information</h3>
                <p className="mt-2">
                  {details.subCategoryName} · ₱
                  {Number(details.price).toLocaleString()}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-slate-600">
                  {details.description}
                </p>
              </section>
              <section>
                <h3 className="font-black">Seller information</h3>
                <p className="mt-2">
                  {sellerName(details)} · {details.seller.phone}
                </p>
                <p>{details.seller.email || "No email"}</p>
              </section>
              <section>
                <h3 className="font-black">Payment and validity</h3>
                <p className="mt-2">
                  Payment status:{" "}
                  {details.paymentStatus === "paid" ? "Paid" : "Unpaid"}
                </p>
                <p>
                  Gateway: {details.paymentGateway || "—"} · Reference:{" "}
                  {details.paymentRef || "—"}
                </p>
                <p>
                  Start: {formatDate(details.publishedAt)} · End:{" "}
                  {formatDate(details.expiresAt)}
                </p>
              </section>
              {details.suspensionReason && (
                <section>
                  <h3 className="font-black">Moderation</h3>
                  <p className="mt-2 text-red-700">
                    Reason: {details.suspensionReason}
                  </p>
                </section>
              )}
            </div>
          </section>
        </div>
      )}
      {suspendTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4">
          <section
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h2 className="text-xl font-black">Suspend Bazaar posting</h2>
            <p className="mt-2 text-sm text-slate-600">
              “{suspendTarget.title}” will stop appearing to customers.
            </p>
            <label className="mt-5 block text-sm font-bold">
              Reason
              <select
                value={reasonType}
                onChange={(event) => {
                  setReasonType(event.target.value);
                  setReason("");
                }}
                className="mt-2 w-full rounded-xl border border-slate-200 p-3 font-normal"
              >
                <option value="">Select a reason</option>
                {reasons.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            {reasonType === "Other" && (
              <textarea
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Enter the policy reason"
                className="mt-3 w-full rounded-xl border border-slate-200 p-3"
              />
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setSuspendTarget(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                disabled={
                  saving ||
                  (reasonType === "Other"
                    ? reason.trim().length < 5
                    : reasonType.length < 5)
                }
                onClick={() => void moderate("suspend", suspendTarget)}
                className="rounded-lg bg-[#e60012] px-4 py-2 text-sm font-black text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "Suspending…" : "Confirm suspension"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
