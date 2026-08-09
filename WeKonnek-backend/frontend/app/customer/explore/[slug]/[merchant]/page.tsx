"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  CakeSlice,
  CircleDollarSign,
  Coffee,
  Crown,
  Heart,
  Home,
  Info,
  Map,
  MapPin,
  Package,
  PackageCheck,
  QrCode,
  Sandwich,
  Share2,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Tag,
  Truck,
  UserRound,
  UsersRound,
  UtensilsCrossed,
  Wifi,
} from "lucide-react";
import { addToCart, getCartCount, onCartChange } from "@/lib/cart";

const foodProductPhotos = [
  "/images/menu-caramel-macchiato.png",
  "/images/menu-club-sandwich.png",
  "/images/menu-blueberry-cheesecake.png",
  "/images/menu-house-pasta.png",
  "/images/menu-family-meal.png",
];
const categoryPhotos: Record<string, string[]> = {
  food: foodProductPhotos,
  restaurants: [
    "/images/partner-sakura-garden.png",
    "/images/partner-le-petit-bistro.png",
    "/images/menu-house-pasta.png",
    "/images/menu-family-meal.png",
  ],
  groceries: ["/images/partner-green-market.png"],
  pharmacy: ["/images/partner-wellness-spa.png"],
  wellness: ["/images/partner-wellness-spa.png"],
  services: [
    "/images/merchantPickupOrder.png",
    "/images/weKonnekPickupOrders.png",
    "/images/merchantTakeOutOrder.png",
  ],
};
const productNames: Record<string, string[]> = {
  food: [
    "Caramel Macchiato",
    "Club Sandwich",
    "Blueberry Cheesecake",
    "House Pasta",
    "Family Meal",
  ],
  restaurants: [
    "Chef Special",
    "Signature Plate",
    "Seafood Platter",
    "House Pasta",
    "Family Feast",
  ],
  groceries: [
    "Fresh Produce Box",
    "Pantry Bundle",
    "Organic Selection",
    "Daily Essentials",
    "Family Basket",
  ],
  pharmacy: [
    "Wellness Kit",
    "Daily Vitamins",
    "Personal Care Set",
    "First Aid Kit",
    "Family Essentials",
  ],
  services: [
    "Basic Service",
    "Standard Package",
    "Premium Care",
    "Home Visit",
    "Family Package",
  ],
  wellness: [
    "Relaxation Session",
    "Wellness Package",
    "Signature Treatment",
    "Care Bundle",
    "Premium Experience",
  ],
};

const nav = [
  { icon: Home, label: "Home", href: "/customer/dashboard" },
  { icon: Map, label: "Explore Map", href: "/customer/map" },
  { icon: Tag, label: "Vouchers & Deals", href: "/customer/deals" },
  { icon: Package, label: "My Orders", href: "/customer/orders" },
  { icon: UserRound, label: "Profile", href: "/customer/profile" },
];
const tabs = [
  { icon: Store, label: "Overview" },
  { icon: UtensilsCrossed, label: "Menu" },
  { icon: Package, label: "Reviews (236)" },
  { icon: Camera, label: "Photos (128)" },
  { icon: Info, label: "About" },
];
const titleCase = (value: string) =>
  decodeURIComponent(value)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
const numericId = (value: string) =>
  Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 1000);

export default function MerchantMarketplacePage() {
  const params = useParams();
  const category = String(params.slug || "food");
  const merchantSlug = String(params.merchant || "local-merchant");
  const merchantName = titleCase(merchantSlug);
  const merchantId = numericId(`${category}-${merchantSlug}`);
  const [cartCount, setCartCount] = useState(0);
  const baseNames = productNames[category] || [
    "Featured Item",
    "Local Favorite",
    "Premium Selection",
    "Best Seller",
    "Family Bundle",
  ];
  const productPhotoSet = categoryPhotos[category] || [
    "/images/partner-green-market.png",
    "/images/partner-wellness-spa.png",
    "/images/partner-sakura-garden.png",
    "/images/partner-le-petit-bistro.png",
  ];
  const products = [
    ...baseNames,
    ...baseNames.map((name) => `${name} Bundle`),
  ].map((name, index) => ({
    id: merchantId * 100 + index,
    name,
    price: 99 + index * 25,
    rating: (4.5 + (index % 5) / 10).toFixed(1),
    image: productPhotoSet[index % productPhotoSet.length],
  }));

  useEffect(() => {
    const refresh = () => setCartCount(getCartCount(merchantId));
    refresh();
    return onCartChange(refresh);
  }, [merchantId]);
  const add = (product: (typeof products)[number]) => {
    addToCart(merchantId, {
      product_id: product.id,
      product_name: product.name,
      price: product.price,
      image_url: product.image,
      merchant_id: merchantId,
    });
    toast.success(`${product.name} added to cart`);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#111827] xl:grid xl:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="hidden min-h-screen border-r border-slate-200 bg-white p-5 xl:flex xl:flex-col">
        <Link href="/customer/dashboard" className="flex items-center gap-3">
          <Image
            src="/images/weKonnekLogov1.png"
            alt="WeKonnek"
            width={58}
            height={58}
            className="size-14 object-contain"
          />
          <div>
            <b className="text-blue-700">
              WE<span className="text-red-600">KONNEK</span>
            </b>
            <p className="text-xs text-slate-500">Customer App</p>
          </div>
        </Link>
        <div className="mt-10 rounded-2xl bg-red-50 p-4">
          <p className="text-xs font-bold text-red-600">BROWSING NEAR</p>
          <p className="mt-2 font-black">Your City</p>
          <p className="text-xs text-slate-500">Local shops and offers</p>
        </div>
        <nav className="mt-6 space-y-2">
          {nav.map(({ icon: Icon, label, href }) => (
            <Link
              key={label}
              href={href}
              className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
        <Link
          href="/customer/scan"
          className="mt-auto flex min-h-12 items-center justify-center gap-3 rounded-xl bg-slate-950 text-sm font-bold text-white"
        >
          <QrCode size={19} /> Scan QR
        </Link>
        <Link
          href="/customer/profile"
          className="mt-4 flex items-center gap-3 px-3 text-sm font-semibold text-slate-600"
        >
          <UserRound size={19} /> My Account
        </Link>
      </aside>

      <main className="min-w-0 p-4 pb-28 lg:p-7">
        <div className="flex items-center justify-between">
          <Link
            href={`/customer/explore/${category}`}
            className="flex min-h-11 items-center gap-2 text-sm font-bold text-red-600"
          >
            <ArrowLeft size={19} /> Back to {titleCase(category)}
          </Link>
          <div className="flex gap-2">
            <button className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-red-600">
              <Heart size={18} /> Save
            </button>
            <button className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-red-600">
              <Share2 size={18} /> Share
            </button>
          </div>
        </div>

        <section className="relative mt-3 overflow-hidden rounded-2xl bg-gradient-to-r from-[#171313] via-[#60200c] to-[#1a1717] p-7 text-white shadow-xl">
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="relative flex items-center gap-6">
            <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-white">
              <Image
                src={productPhotoSet[merchantId % productPhotoSet.length]}
                alt={`${merchantName} storefront`}
                fill
                sizes="112px"
                className="object-cover"
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-black">{merchantName}</h1>
                <span className="rounded-full bg-[#ff0719] px-3 py-1 text-xs font-bold">
                  Featured
                </span>
              </div>
              <p className="mt-1 text-sm text-white/80">
                {titleCase(category)} · Local favorites · Premium service
              </p>
              <p className="mt-3 text-sm">
                <Star
                  className="mr-1 inline fill-amber-400 text-amber-400"
                  size={18}
                />{" "}
                <b>4.8</b> &nbsp; (236 reviews) ·{" "}
                <b className="text-emerald-400">Open now</b> &nbsp; 7:00 AM –
                10:00 PM
              </p>
              <p className="mt-2 flex items-center gap-1 text-xs text-white/80">
                <MapPin size={15} /> Your City · 0.8 km
              </p>
            </div>
          </div>
        </section>

        <nav className="mt-3 flex overflow-x-auto border-b border-slate-200 bg-white no-scrollbar">
          {tabs.map(({ icon: Icon, label }) => (
            <button
              key={label}
              className={`flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-7 text-sm font-bold ${label === "Overview" ? "border-red-600 text-red-600" : "border-transparent text-slate-600"}`}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-red-600">BROWSE FIRST</p>
              <h2 className="text-2xl font-black">Menu</h2>
            </div>
            <button className="rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">
              View all menu
            </button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {products.map((product) => (
              <article
                key={product.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="relative h-28 overflow-hidden">
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    sizes="(max-width:640px) 50vw, 20vw"
                    className="object-cover"
                  />
                </div>
                <div className="p-3">
                  <h3 className="truncate text-sm font-black">
                    {product.name}
                  </h3>
                  <div className="mt-2 flex justify-between text-xs">
                    <b>₱{product.price}</b>
                    <span className="text-slate-500">
                      <span className="text-amber-400">★</span> {product.rating}
                    </span>
                  </div>
                  <button
                    onClick={() => add(product)}
                    className="mt-3 min-h-9 w-full rounded-xl bg-[#ff0730] text-xs font-bold text-white transition active:scale-[.98]"
                  >
                    ＋ Add to cart
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black">Exclusive Discounts</h2>
            <p className="text-xs text-slate-500">
              Available to WeKonnek customers
            </p>
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-3">
            <article className="rounded-2xl border border-red-100 bg-red-50 p-5">
              <p className="text-xs font-black text-red-600">
                REGULAR DISCOUNT
              </p>
              <h3 className="mt-2 text-2xl font-black text-red-600">10% OFF</h3>
              <p className="text-sm text-slate-600">On all purchases</p>
              <span className="mt-3 inline-flex rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white">
                Use Code: WKC10
              </span>
              <p className="mt-2 text-xs text-slate-500">Min. spend ₱200</p>
            </article>
            <article className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
              <p className="text-xs font-black text-amber-600">VIP DISCOUNT</p>
              <h3 className="mt-2 text-2xl font-black text-orange-600">
                15% OFF
              </h3>
              <p className="text-sm text-slate-600">On all purchases</p>
              <span className="mt-3 inline-flex rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white">
                Use Code: VIP15
              </span>
              <p className="mt-2 text-xs text-slate-500">Min. spend ₱300</p>
            </article>
            <article className="flex flex-col items-center justify-center rounded-2xl border border-red-100 bg-red-50 p-5 text-center">
              <Crown className="fill-red-600 text-red-600" size={38} />
              <h3 className="mt-2 text-lg font-black text-red-600">
                Become a VIP
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Unlock bigger discounts and exclusive perks.
              </p>
              <button className="mt-3 rounded-xl bg-[#ff0730] px-5 py-2.5 text-sm font-bold text-white">
                Learn More
              </button>
            </article>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            { icon: Truck, title: "Door Delivery" },
            { icon: PackageCheck, title: "Pick-Up" },
            { icon: CalendarDays, title: "Reserve a Table" },
            { icon: UsersRound, title: "Group Reservation" },
          ].map(({ icon: Icon, title }) => (
            <article
              key={title}
              className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm"
            >
              <Icon className="text-red-600" size={29} />
              <h3 className="mt-3 font-black">{title}</h3>
              <p className="mt-1 text-xs text-slate-500">Available today</p>
            </article>
          ))}
        </section>

        <section className="mt-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              icon: Store,
              label: "Specialty",
              value: `${titleCase(category)}, Local favorites`,
            },
            {
              icon: CircleDollarSign,
              label: "Price Range",
              value: "₱₱ (₱100 – ₱500)",
            },
            {
              icon: UsersRound,
              label: "Best For",
              value: "Solo, Friends, Dates, Work",
            },
            {
              icon: Wifi,
              label: "Amenities",
              value: "Free Wi-Fi, AC, Parking",
            },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <Icon size={18} />
              </span>
              <div>
                <b className="block text-xs">{label}</b>
                <p className="text-xs text-slate-500">{value}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-7">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black">What customers are saying</h2>
            <button className="text-xs font-bold text-red-600">
              See all reviews
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              {
                name: "Ana D.",
                initials: "AD",
                icon: Coffee,
                text: "Excellent quality and genuinely warm service.",
              },
              {
                name: "John R.",
                initials: "JR",
                icon: Sandwich,
                text: "Fast service and everything arrived fresh.",
              },
              {
                name: "Maria S.",
                initials: "MS",
                icon: CakeSlice,
                text: "Love the selection and the friendly team!",
              },
              {
                name: "Kevin L.",
                initials: "KL",
                icon: Coffee,
                text: "Great value. Perfect for work or study.",
              },
              {
                name: "Claire T.",
                initials: "CT",
                icon: Sparkles,
                text: "I always come back. Highly recommended!",
              },
            ].map(({ name, initials, icon: Icon, text }, index) => (
              <article
                key={name}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center gap-2 p-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-red-50 text-[10px] font-black text-red-600">
                    {initials}
                  </span>
                  <div>
                    <b className="block text-xs">{name}</b>
                    <p className="text-[10px] text-slate-500">
                      {index < 2 ? "1 week ago" : "2 weeks ago"}
                    </p>
                  </div>
                </div>
                <div className="flex h-24 items-center justify-center bg-amber-100">
                  <Icon size={42} className="text-amber-600" />
                </div>
                <div className="p-3">
                  <p className="text-sm tracking-wider text-amber-400">★★★★★</p>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {text}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-16 z-40 flex items-center gap-3 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,.1)] xl:bottom-0 xl:left-[244px]">
        <div className="hidden min-w-64 sm:block">
          <b>{merchantName}</b>
          <p className="text-xs text-slate-500">★ 4.8 · 236 reviews · 0.8 km</p>
        </div>
        <Link
          href={`/customer/scan`}
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 font-bold text-white"
        >
          <QrCode size={19} /> In-Store Ordering
        </Link>
        <Link
          href={`/customer/cart`}
          className="relative flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff0730] font-bold text-white"
        >
          <ShoppingCart size={19} /> Cart
          {cartCount > 0 && (
            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-red-600">
              {cartCount}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
