"use client";
import { useCallback, useEffect, useState } from "react";
import { getToken } from "@/hooks/use-auth";
import type { PropertyListing } from "@/lib/property";
import PropertyPlanManager from "@/components/PropertyPlanManager";
import { listerTypeLabel } from "@/lib/property-classification";

export default function AdminPropertyPage() {
  const [items, setItems] = useState<PropertyListing[]>([]),
    [status, setStatus] = useState("ALL"),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    const p = new URLSearchParams({ status });
    if (search) p.set("search", search);
    const r = await fetch(`/api/backend/property/admin/listings?${p}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.message || "Unable to load properties");
    setItems(b.items || []);
  }, [status, search]);
  useEffect(() => {
    const t = setTimeout(() => load().catch((e) => setError(e.message)), 200);
    return () => clearTimeout(t);
  }, [load]);
  const act = async (
    item: PropertyListing,
    action: string,
    value?: boolean,
  ) => {
    let reason = "";
    if (["SUSPEND", "REJECT"].includes(action)) {
      reason =
        window.prompt(`Reason to ${action.toLowerCase()} this listing:`) || "";
      if (!reason) return;
    }
    try {
      const r = await fetch(
        `/api/backend/property/admin/listings/${item.id}/moderate`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ action, reason, value }),
        },
      );
      const b = await r.json();
      if (!r.ok) throw new Error(b.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Moderation failed");
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black">Property Management</h1>
        <p className="text-sm text-slate-500">
          Review, verify, feature and suspend property listings and reports.
        </p>
      </div>
      <PropertyPlanManager />
      <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_220px]">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, location, owner or phone"
          className="rounded-xl border p-3"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl border bg-white p-3"
        >
          <option>ALL</option>
          {[
            "DRAFT",
            "PENDING",
            "ACTIVE",
            "RESERVED",
            "SOLD",
            "RENTED",
            "EXPIRED",
            "INACTIVE",
            "REJECTED",
            "SUSPENDED",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-red-700">{error}</div>
      )}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-4">Property</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Performance</th>
              <th>Validity</th>
              <th>Moderation</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="p-4">
                  <div className="flex gap-3">
                    <img
                      src={item.images?.[0]?.imageUrl || ""}
                      alt=""
                      className="size-14 rounded-lg bg-slate-100 object-cover"
                    />
                    <div>
                      <p className="font-black">{item.title}</p>
                      <p className="text-xs text-slate-500">
                        {item.propertyType.name} ·{" "}
                        {item.transactionType.replace("_", " ")} · ₱
                        {Number(item.price).toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.barangay}, {item.city}
                      </p>
                    </div>
                  </div>
                </td>
                <td>
                  <p className="font-bold">
                    {[item.owner?.firstName, item.owner?.lastName]
                      .filter(Boolean)
                      .join(" ") || "Customer"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {listerTypeLabel(item.sellerType)}
                    {item.agencyName ? ` · ${item.agencyName}` : ""}
                  </p>
                </td>
                <td>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black">
                    {item.listingStatus}
                  </span>
                  <div className="mt-2 flex gap-1">
                    {item.isVerified && (
                      <span className="text-xs font-bold text-blue-700">
                        Verified
                      </span>
                    )}
                    {item.isFeatured && (
                      <span className="text-xs font-bold text-amber-600">
                        Featured
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {item.viewCount} views
                  <br />
                  <span className="text-xs text-slate-500">
                    {item._count?.savedBy || 0} saves ·{" "}
                    {item._count?.viewingRequests || 0} viewings ·{" "}
                    {item._count?.reports || 0} reports
                  </span>
                </td>
                <td className="text-xs">
                  {item.expiresAt
                    ? new Date(item.expiresAt).toLocaleDateString("en-PH")
                    : "—"}
                </td>
                <td>
                  <div className="flex max-w-64 flex-wrap gap-1">
                    {item.listingStatus === "PENDING" && (
                      <button
                        onClick={() => act(item, "APPROVE")}
                        className="rounded border px-2 py-1 font-bold text-green-700"
                      >
                        Approve
                      </button>
                    )}
                    {item.listingStatus === "SUSPENDED" ? (
                      <button
                        onClick={() => act(item, "RESTORE")}
                        className="rounded border px-2 py-1 font-bold text-green-700"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => act(item, "SUSPEND")}
                        className="rounded border px-2 py-1 font-bold text-red-700"
                      >
                        Suspend
                      </button>
                    )}
                    <button
                      onClick={() => act(item, "VERIFY", !item.isVerified)}
                      className="rounded border px-2 py-1 font-bold text-blue-700"
                    >
                      {item.isVerified ? "Unverify" : "Verify"}
                    </button>
                    <button
                      onClick={() => act(item, "FEATURE", !item.isFeatured)}
                      className="rounded border px-2 py-1 font-bold text-amber-700"
                    >
                      {item.isFeatured ? "Unfeature" : "Feature"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && (
          <p className="p-10 text-center text-slate-500">
            No property listings match these filters.
          </p>
        )}
      </div>
    </div>
  );
}
