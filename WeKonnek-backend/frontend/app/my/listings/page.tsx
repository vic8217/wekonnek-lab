"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getToken } from "@/hooks/use-auth";
import { propertyApi, type PropertyListing } from "@/lib/property";
import { listerTypeLabel } from "@/lib/property-classification";
import { publicAssetUrl } from "@/lib/public-asset-url";

type BazaarListing = {
  id: string;
  title: string;
  price: string | number;
  status: string;
  subCategoryName: string;
  imageUrls: string[];
  thumbnailUrls?: string[];
};
export default function MyListingsPage() {
  const router = useRouter(),
    [bazaar, setBazaar] = useState<BazaarListing[]>([]),
    [property, setProperty] = useState<PropertyListing[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/auth/login?redirect=%2Fmy%2Flistings");
      return;
    }
    Promise.all([
      fetch("/api/backend/bazaar-listings/mine", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(body.message || "Unable to load Bazaar listings");
        return body;
      }),
      propertyApi.mine(),
    ])
      .then(([bazaarRows, propertyRows]) => {
        setBazaar(bazaarRows);
        setProperty(propertyRows);
      })
      .catch((error) => setError(error.message));
  }, [router]);
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">My Listings</h1>
          <p className="text-slate-500">
            Bazaar and Property listings owned by your account.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/bazaar/post"
            className="rounded-xl bg-red-600 px-4 py-3 font-black text-white"
          >
            + Bazaar Item
          </Link>
          <Link
            href="/property/post"
            className="rounded-xl bg-blue-700 px-4 py-3 font-black text-white"
          >
            + Property
          </Link>
        </div>
      </div>
      {error && (
        <p className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>
      )}
      <section className="mt-8">
        <h2 className="text-xl font-black">Bazaar</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bazaar.map((item) => (
            <article key={item.id} className="rounded-xl border bg-white p-4">
              <div className="flex gap-3">
                <img
                  src={publicAssetUrl(item.thumbnailUrls?.[0] || item.imageUrls?.[0]) || ""}
                  alt=""
                  className="size-16 rounded-lg bg-slate-100 object-cover"
                />
                <div className="min-w-0">
                  <h3 className="truncate font-black">{item.title}</h3>
                  <p className="text-sm text-red-600">
                    ₱{Number(item.price).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.subCategoryName} · {item.status.replaceAll("_", " ")}
                  </p>
                </div>
              </div>
              {["draft", "payment_failed"].includes(item.status) && (
                <Link
                  href={`/bazaar/listings/${item.id}/edit`}
                  className="mt-3 inline-block text-sm font-bold text-blue-700"
                >
                  Edit listing →
                </Link>
              )}
            </article>
          ))}
        </div>
        {!bazaar.length && !error && (
          <p className="mt-3 text-sm text-slate-500">No Bazaar listings yet.</p>
        )}
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-black">Property</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {property.map((item) => (
            <article key={item.id} className="rounded-xl border bg-white p-4">
              <h3 className="font-black">{item.title}</h3>
              <p className="text-sm text-red-600">
                ₱{Number(item.price).toLocaleString()}
              </p>
              <p className="text-xs text-slate-500">
                {item.transactionType === "FOR_RENT" ? "For Rent" : "For Sale"}{" "}
                · {item.propertyType.name}
              </p>
              <p className="text-xs text-slate-500">
                {listerTypeLabel(item.sellerType)} ·{" "}
                {item.listingStatus.replaceAll("_", " ")} ·{" "}
                {item._count?.viewingRequests || 0} inquiries
              </p>
              <Link
                href={`/property/listings/${item.id}/edit`}
                className="mt-3 inline-block text-sm font-bold text-blue-700"
              >
                Edit listing →
              </Link>
            </article>
          ))}
        </div>
        {!property.length && !error && (
          <p className="mt-3 text-sm text-slate-500">
            No Property listings yet.
          </p>
        )}
      </section>
    </main>
  );
}
