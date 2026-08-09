"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Car,
  Heart,
  MapPin,
  Maximize2,
  MessageCircle,
  Phone,
  Share2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { listerTypeLabel } from "@/lib/property-classification";
import { getToken, getUser } from "@/hooks/use-auth";
import { propertyApi, type PropertyListing } from "@/lib/property";

export default function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    router = useRouter();
  const [item, setItem] = useState<PropertyListing | null>(null),
    [error, setError] = useState(""),
    [photo, setPhoto] = useState(0),
    [viewing, setViewing] = useState(false),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    propertyApi
      .detail(id)
      .then(setItem)
      .catch((e) => setError(e.message));
  }, [id]);
  const requireAuth = () => {
    if (!getToken()) {
      router.push(
        `/auth/login?redirect=${encodeURIComponent(`/property/${id}`)}`,
      );
      return false;
    }
    return true;
  };
  const toggleSave = async () => {
    if (!requireAuth()) return;
    try {
      if (saved) await propertyApi.unsave(item!.id);
      else await propertyApi.save(item!.id);
      setSaved(!saved);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save");
    }
  };
  const submitViewing = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!requireAuth()) return;
    const data = new FormData(e.currentTarget);
    try {
      await propertyApi.requestViewing(item!.id, Object.fromEntries(data));
      setViewing(false);
      setMessage("Your viewing request was sent to the seller.");
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Unable to request viewing",
      );
    }
  };
  if (error)
    return (
      <div className="mx-auto max-w-4xl p-10 text-center text-red-700">
        {error}
      </div>
    );
  if (!item)
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="size-10 animate-spin rounded-full border-4 border-red-600 border-t-transparent" />
      </div>
    );
  const price = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(Number(item.price));
  const facts: { Icon: LucideIcon; label: string }[] = [
    {
      Icon: BedDouble,
      label: item.bedrooms != null ? `${item.bedrooms} Bedrooms` : "—",
    },
    {
      Icon: Bath,
      label:
        item.bathrooms != null ? `${Number(item.bathrooms)} Bathrooms` : "—",
    },
    {
      Icon: Car,
      label: item.parkingSpaces != null ? `${item.parkingSpaces} Parking` : "—",
    },
    {
      Icon: Maximize2,
      label: item.floorArea ? `${Number(item.floorArea)} sqm` : "—",
    },
  ];
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Link href="/property" className="text-sm font-bold text-slate-600">
        ← Back to Property
      </Link>
      <div className="mt-4 grid gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-slate-200">
          {item.images[photo] ? (
            <img
              src={item.images[photo].imageUrl}
              alt={item.title}
              className="size-full object-cover"
            />
          ) : (
            <Building2 className="m-auto size-full p-24 text-slate-300" />
          )}
          <span className="absolute left-4 top-4 rounded-full bg-slate-950/80 px-3 py-1 text-xs font-black text-white">
            {item.transactionType === "FOR_RENT" ? "FOR RENT" : "FOR SALE"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          {item.images.slice(1, 5).map((image, index) => (
            <button
              key={image.id}
              onClick={() => setPhoto(index + 1)}
              className="overflow-hidden rounded-xl bg-slate-200"
            >
              <img
                src={image.imageUrl}
                alt=""
                className="size-full object-cover"
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_360px]">
        <article>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-black text-[#DB0002]">
                {price}
                {item.transactionType === "FOR_RENT" && (
                  <span className="text-base text-slate-500">
                    {" "}
                    / {item.pricePeriod.toLowerCase()}
                  </span>
                )}
              </p>
              <h1 className="mt-2 text-2xl font-black sm:text-3xl">
                {item.title}
              </h1>
              <p className="mt-2 flex items-center gap-1 text-slate-500">
                <MapPin size={17} />
                {[item.barangay, item.city, item.province]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
            <button
              onClick={toggleSave}
              aria-label="Save property"
              className={`rounded-full border p-3 ${saved ? "bg-red-50 text-red-600" : ""}`}
            >
              <Heart fill={saved ? "currentColor" : "none"} />
            </button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {facts.map(({ Icon, label }) => (
              <div key={label} className="rounded-xl bg-slate-100 p-4">
                <Icon size={21} className="text-blue-700" />
                <p className="mt-2 text-sm font-bold">{label}</p>
              </div>
            ))}
          </div>
          <section className="mt-8">
            <h2 className="text-xl font-black">Property details</h2>
            <dl className="mt-3 grid grid-cols-2 gap-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Property type</dt>
                <dd className="font-bold">{item.propertyType.name}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Furnished</dt>
                <dd className="font-bold">
                  {item.furnishedStatus || "Not specified"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Lot area</dt>
                <dd className="font-bold">
                  {item.lotArea ? `${Number(item.lotArea)} sqm` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Lister type</dt>
                <dd className="font-bold">
                  {listerTypeLabel(item.sellerType)}
                </dd>
              </div>
            </dl>
          </section>
          <section className="mt-8">
            <h2 className="text-xl font-black">Description</h2>
            <p className="mt-3 whitespace-pre-wrap leading-7 text-slate-700">
              {item.description}
            </p>
          </section>
          <section className="mt-8 rounded-2xl border bg-blue-50 p-6">
            <h2 className="flex items-center gap-2 text-xl font-black">
              <MapPin className="text-blue-700" />
              Approximate location
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              The exact residential address is protected. Contact the seller to
              arrange a viewing.
            </p>
            {item.latitude && item.longitude && (
              <a
                target="_blank"
                rel="noreferrer"
                href={`https://www.openstreetmap.org/?mlat=${item.latitude}&mlon=${item.longitude}#map=15/${item.latitude}/${item.longitude}`}
                className="mt-4 inline-block font-bold text-blue-700"
              >
                Open location map →
              </a>
            )}
          </section>
        </article>
        <aside>
          <div className="sticky top-5 rounded-2xl border bg-white p-5 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-blue-100 font-black text-blue-700">
                {item.owner?.firstName?.[0] || "P"}
              </div>
              <div>
                <p className="font-black">
                  {[item.owner?.firstName, item.owner?.lastName]
                    .filter(Boolean)
                    .join(" ") || "Property Seller"}
                </p>
                <p className="text-xs text-slate-500">
                  {item.agencyName || listerTypeLabel(item.sellerType)}
                </p>
              </div>
              {item.isVerified && (
                <ShieldCheck className="ml-auto text-blue-600" />
              )}
            </div>
            <div className="mt-5 grid gap-2">
              <button
                onClick={() => {
                  if (requireAuth())
                    setMessage("WEKONNEK messaging will open for this seller.");
                }}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#DB0002] py-3 font-black text-white"
              >
                <MessageCircle size={18} />
                Message
              </button>
              <button
                onClick={() => setViewing(true)}
                className="flex items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 font-black text-white"
              >
                <CalendarDays size={18} />
                Request Viewing
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    setMessage(
                      "The seller’s number stays private until they accept contact.",
                    )
                  }
                  className="flex items-center justify-center gap-1 rounded-xl border py-2.5 font-bold"
                >
                  <Phone size={16} />
                  Call
                </button>
                <button
                  onClick={() =>
                    void navigator.share?.({
                      title: item.title,
                      url: location.href,
                    })
                  }
                  className="flex items-center justify-center gap-1 rounded-xl border py-2.5 font-bold"
                >
                  <Share2 size={16} />
                  Share
                </button>
              </div>
            </div>
            {message && (
              <p className="mt-3 text-center text-xs font-semibold text-blue-700">
                {message}
              </p>
            )}
            <button
              onClick={async () => {
                if (!requireAuth()) return;
                const reason = window.prompt(
                  "Report reason: Incorrect information, Suspected scam, Duplicate listing, Property no longer available, Misleading photos, Wrong price, or Other",
                );
                if (reason)
                  try {
                    await propertyApi.report(item.id, { reason });
                    setMessage(
                      "Thank you. The report was sent for admin review.",
                    );
                  } catch (e) {
                    setMessage(
                      e instanceof Error ? e.message : "Unable to report",
                    );
                  }
              }}
              className="mt-5 w-full text-xs font-bold text-slate-500 underline"
            >
              Report Listing
            </button>
          </div>
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-16 z-30 flex gap-2 border-t bg-white p-3 shadow-2xl lg:hidden">
        <button onClick={toggleSave} className="rounded-xl border px-4">
          <Heart size={19} />
        </button>
        <button
          onClick={() =>
            setMessage("WEKONNEK messaging will open for this seller.")
          }
          className="flex-1 rounded-xl bg-slate-900 py-3 font-black text-white"
        >
          Message
        </button>
        <button
          onClick={() => setViewing(true)}
          className="flex-1 rounded-xl bg-[#DB0002] py-3 font-black text-white"
        >
          Request Viewing
        </button>
      </div>
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={submitViewing}
            className="w-full max-w-md rounded-2xl bg-white p-6"
          >
            <h2 className="text-xl font-black">Request a Viewing</h2>
            <div className="mt-5 grid gap-3">
              <input
                name="preferredDate"
                type="date"
                required
                className="rounded-xl border p-3"
              />
              <input
                name="preferredTime"
                type="time"
                required
                className="rounded-xl border p-3"
              />
              <input
                name="name"
                required
                defaultValue={[getUser()?.firstName, getUser()?.lastName]
                  .filter(Boolean)
                  .join(" ")}
                placeholder="Your name"
                className="rounded-xl border p-3"
              />
              <input
                name="contactNumber"
                required
                defaultValue={getUser()?.phone || ""}
                placeholder="Contact number"
                className="rounded-xl border p-3"
              />
              <textarea
                name="message"
                rows={3}
                placeholder="Optional message"
                className="rounded-xl border p-3"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setViewing(false)}
                className="flex-1 rounded-xl border py-3 font-bold"
              >
                Cancel
              </button>
              <button className="flex-1 rounded-xl bg-[#DB0002] py-3 font-black text-white">
                Send Request
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
