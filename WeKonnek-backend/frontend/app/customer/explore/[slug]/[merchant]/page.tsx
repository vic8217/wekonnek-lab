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
import {
  merchantsApi,
  productsApi,
  type Merchant,
  type Product,
} from "@/lib/api";
import {
  hasMerchantFeature,
  hasPlatinumAccess,
  merchantSubscriptionFromProfile,
} from "@/lib/merchant-subscription";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { getToken } from "@/hooks/use-auth";

interface MerchantPromotion {
  id: number;
  title: string;
  description?: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  min_order_amount: number;
  voucher_code: string;
  end_date?: string | null;
}

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
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Overview");
  const [tabInteracted, setTabInteracted] = useState(false);
  const [variantProduct, setVariantProduct] = useState<Product | null>(null);
  const [promotions, setPromotions] = useState<MerchantPromotion[]>([]);
  const [claimingVoucher, setClaimingVoucher] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const merchantName = merchant?.name || titleCase(merchantSlug);
  const merchantId = merchant?.id || numericId(`${category}-${merchantSlug}`);
  useEffect(() => {
    const refreshCartCount = () => setCartCount(getCartCount(merchantId));
    refreshCartCount();
    return onCartChange(refreshCartCount);
  }, [merchantId]);
  const activeShop =
    merchant?.branches?.find((branch) => branch.isDefault) ||
    merchant?.branches?.[0];
  const shopOpen = Boolean(activeShop?.is_open);
  const subscription = merchant
    ? merchantSubscriptionFromProfile(
        merchant as unknown as Record<string, unknown>,
      )
    : { tier: "basic", active: false };
  const platinumAccess = hasPlatinumAccess(subscription);
  const onlineOrdering = hasMerchantFeature(subscription, "online-ordering");
  const discountVouchers = hasMerchantFeature(subscription, "discount-vouchers");
  const serviceFeatures = [
    { icon: Truck, title: "Door Delivery", mobileTitle: "Delivery" },
    { icon: PackageCheck, title: "Pick-Up", mobileTitle: "Pick-Up" },
    ...(platinumAccess
      ? [
          {
            icon: CalendarDays,
            title: "Reserve a Table",
            mobileTitle: "Reserve",
          },
          {
            icon: UsersRound,
            title: "Group Reservation",
            mobileTitle: "Groups",
          },
        ]
      : []),
  ];
  const productPhotoSet = categoryPhotos[category] || [
    "/images/partner-green-market.png",
    "/images/partner-wellness-spa.png",
    "/images/partner-sakura-garden.png",
    "/images/partner-le-petit-bistro.png",
  ];
  useEffect(() => {
    let active = true;
    setLoading(true);
    merchantsApi
      .getBySlug(merchantSlug)
      .then(async (record) => {
        if (!active) return;
        setMerchant(record);
        const defaultShop =
          record.branches?.find((branch) => branch.isDefault) ||
          record.branches?.[0];
        const menu = defaultShop
          ? await productsApi.getForShop(record.id, defaultShop.id)
          : await productsApi.getByMerchant(record.id);
        if (active) setProducts(menu);
        if (active && hasMerchantFeature(
          merchantSubscriptionFromProfile(record as unknown as Record<string, unknown>),
          "discount-vouchers",
        )) {
          const response = await fetch(`/api/backend/promotions/merchant/${record.id}/active`, {
            cache: "no-store",
          });
          if (response.ok) {
            const body = await response.json();
            if (active) setPromotions(Array.isArray(body) ? body : body.data || []);
          }
        }
      })
      .catch((error) => {
        if (active) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Unable to load merchant menu",
          );
          setProducts([]);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [merchantSlug]);

  useEffect(() => {
    if (!tabInteracted) return;
    const target = activeTab.startsWith("Reviews")
      ? "merchant-reviews"
      : activeTab === "About"
        ? "merchant-about"
        : activeTab === "Menu"
          ? "merchant-menu"
          : "merchant-overview";
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(target);
      if (!element) return;
      element.focus({ preventScroll: true });
      const top = element.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, tabInteracted]);
  const productPrice = (product: Product) =>
    Number(product.discountPrice ?? product.sellingPrice ?? product.price ?? 0);
  const productImage = (product: Product, index = 0) =>
    publicAssetUrl(product.imageUrl) ||
    productPhotoSet[index % productPhotoSet.length];
  const variantName = (variant: NonNullable<Product["variants"]>[number]) =>
    variant.optionValues
      ?.map((link) => link.optionValue.value)
      .filter(Boolean)
      .join(" / ") || variant.sku;
  const add = (
    product: Product,
    variant?: NonNullable<Product["variants"]>[number],
  ) => {
    const defaultShop =
      merchant?.branches?.find((branch) => branch.isDefault) ||
      merchant?.branches?.[0];
    addToCart(merchantId, {
      product_id: product.id,
      product_name: product.name,
      price: Number(variant?.price ?? productPrice(product)),
      image_url: publicAssetUrl(variant?.imageUrl || product.imageUrl),
      merchant_id: merchantId,
      shop_id: defaultShop?.id,
      variant_id: variant?.id,
      variant_name: variant ? variantName(variant) : undefined,
    });
    setVariantProduct(null);
    toast.success(
      `${product.name}${variant ? ` (${variantName(variant)})` : ""} added to cart`,
    );
  };

  const startAdd = (product: Product) => {
    const variants = (product.variants || []).filter(
      (variant) =>
        variant.isActive && variant.availabilityStatus !== "Out of Stock",
    );
    if (variants.length > 0) {
      setVariantProduct(product);
      return;
    }
    add(product);
  };

  const claimVoucher = async (code: string) => {
    const token = getToken();
    if (!token) {
      toast.error("Sign in to add this voucher to your wallet");
      return;
    }
    setClaimingVoucher(code);
    try {
      const response = await fetch("/api/backend/vouchers/customer/claim", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Voucher could not be added");
      toast.success(body.alreadyClaimed ? "Voucher is already in your wallet" : "Voucher added to your wallet");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Voucher could not be added");
    } finally {
      setClaimingVoucher(null);
    }
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
            <Link
              href="/customer/cart"
              className="relative flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-red-600"
            >
              <ShoppingCart size={18} />
              <span className="hidden sm:inline">Cart</span>
              {cartCount > 0 && (
                <span className="flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-black text-white">
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
            </Link>
            <button className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-red-600">
              <Heart size={18} /> Save
            </button>
            <button className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-red-600">
              <Share2 size={18} /> Share
            </button>
          </div>
        </div>

        <section
          id="merchant-overview"
          tabIndex={-1}
          className="relative mt-3 min-h-[210px] scroll-mt-20 overflow-hidden rounded-2xl bg-gradient-to-r from-[#171313] via-[#60200c] to-[#1a1717] p-7 text-white shadow-xl outline-none sm:min-h-[230px]"
        >
          {merchant?.coverImageUrl ? (
            <>
              <Image
                src={publicAssetUrl(merchant.coverImageUrl)!}
                alt={`${merchantName} banner`}
                fill
                priority
                sizes="(max-width: 1280px) 100vw, calc(100vw - 244px)"
                className="object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
            </>
          ) : (
            <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:28px_28px]" />
          )}
          <div className="relative z-10 flex min-h-[154px] items-center gap-6 sm:min-h-[174px]">
            <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-white">
              <Image
                src={
                  publicAssetUrl(merchant?.logoUrl) ||
                  publicAssetUrl(merchant?.coverImageUrl) ||
                  productPhotoSet[merchantId % productPhotoSet.length]
                }
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
                {merchant?.subCategory?.name ||
                  merchant?.category?.name ||
                  titleCase(category)}
                {merchant?.description ? ` · ${merchant.description}` : ""}
              </p>
              <p className="mt-3 text-sm">
                <Star
                  className="mr-1 inline fill-amber-400 text-amber-400"
                  size={18}
                />{" "}
                <b>{Number(merchant?.rating || 0).toFixed(1)}</b> &nbsp; (
                {merchant?.totalReviews || 0} reviews) ·{" "}
                <b className={shopOpen ? "text-emerald-400" : "text-red-300"}>
                  {shopOpen ? "Open now" : "Closed"}
                </b>
              </p>
              <p className="mt-2 flex items-center gap-1 text-xs text-white/80">
                <MapPin size={15} />{" "}
                {merchant?.address || merchant?.city || "Local merchant"}
              </p>
            </div>
          </div>
        </section>

        <nav className="mt-3 flex overflow-x-auto border-b border-slate-200 bg-white no-scrollbar">
          {tabs.map(({ icon: Icon, label }) => (
            <button
              key={label}
              onClick={() => {
                setActiveTab(label);
                setTabInteracted(true);
              }}
              className={`flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-7 text-sm font-bold ${activeTab === label ? "border-red-600 text-red-600" : "border-transparent text-slate-600"}`}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>

        {onlineOrdering && (
          <section
            className="grid border-b border-slate-200 bg-white px-2 py-3 xl:hidden"
            style={{
              gridTemplateColumns: `repeat(${serviceFeatures.length}, minmax(0, 1fr))`,
            }}
          >
            {serviceFeatures.map(({ icon: Icon, title, mobileTitle }) => (
              <button
                key={title}
                type="button"
                className="flex min-w-0 flex-col items-center gap-1 px-1 py-1 text-center"
              >
                <span className="grid size-8 place-items-center rounded-full bg-red-50 text-red-600">
                  <Icon size={17} />
                </span>
                <span className="truncate text-[10px] font-bold text-slate-700">
                  {mobileTitle}
                </span>
              </button>
            ))}
          </section>
        )}

        <section
          id="merchant-menu"
          tabIndex={-1}
          className="mt-5 scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm outline-none"
        >
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
            {products.map((product, index) => (
              <article
                key={product.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="relative h-28 overflow-hidden">
                  <Image
                    src={productImage(product, index)}
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
                    <b>₱{productPrice(product).toFixed(2)}</b>
                    <span className="text-slate-500">
                      {product.availabilityStatus || "Available"}
                    </span>
                  </div>
                  <button
                    onClick={() => startAdd(product)}
                    disabled={!shopOpen || !product.isAvailable}
                    className="mt-3 min-h-9 w-full rounded-xl bg-[#ff0730] text-xs font-bold text-white transition active:scale-[.98] disabled:bg-slate-300"
                  >
                    {!shopOpen
                      ? "Shop Closed"
                      : product.isAvailable
                        ? "＋ Add to cart"
                        : "Unavailable"}
                  </button>
                  {!!product.variants?.length && (
                    <p className="mt-2 line-clamp-2 text-[10px] text-slate-500">
                      {product.variants
                        .map((variant) =>
                          variant.optionValues
                            ?.map((link) => link.optionValue.value)
                            .join(" / "),
                        )
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              </article>
            ))}
            {!loading && products.length === 0 && (
              <div className="col-span-full py-12 text-center text-sm text-slate-500">
                This merchant has no customer-visible menu items yet.
              </div>
            )}
            {loading && (
              <div className="col-span-full py-12 text-center text-sm text-slate-500">
                Loading menu…
              </div>
            )}
          </div>
        </section>

        {discountVouchers && promotions.length > 0 && (
          <section className="mt-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black">Exclusive Discounts</h2>
              <Link href="/customer/vouchers" className="text-xs font-bold text-red-600">
                Voucher wallet
              </Link>
            </div>
            <div className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 no-scrollbar xl:grid xl:grid-cols-3 xl:overflow-visible">
              {promotions.map((promotion) => (
                <article key={promotion.id} className="min-w-[250px] flex-1 snap-start overflow-hidden rounded-2xl border border-red-100 bg-red-50 xl:min-w-0">
                  <div className="relative h-24 overflow-hidden bg-red-950">
                    {merchant?.coverImageUrl && <Image src={publicAssetUrl(merchant.coverImageUrl)!} alt={`${merchantName} banner`} fill sizes="300px" className="object-cover" />}
                    <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-black/20" />
                    <div className="absolute bottom-2 left-3 flex items-center gap-2 text-white">
                      <div className="relative grid size-9 place-items-center overflow-hidden rounded-lg border-2 border-white bg-white text-sm font-black text-slate-800">
                        {merchant?.logoUrl ? <Image src={publicAssetUrl(merchant.logoUrl)!} alt={`${merchantName} logo`} fill sizes="36px" className="object-contain" /> : merchantName.charAt(0)}
                      </div>
                      <span className="text-xs font-black">{merchantName}</span>
                    </div>
                  </div>
                  <div className="p-4">
                  <p className="text-xs font-black uppercase text-red-600">{promotion.title}</p>
                  <h3 className="mt-2 text-2xl font-black text-red-600">
                    {promotion.discount_type === "percentage"
                      ? `${Number(promotion.discount_value)}% OFF`
                      : `₱${Number(promotion.discount_value).toFixed(2)} OFF`}
                  </h3>
                  {promotion.description && <p className="mt-1 text-sm text-slate-600">{promotion.description}</p>}
                  <button
                    type="button"
                    onClick={() => claimVoucher(promotion.voucher_code)}
                    disabled={claimingVoucher !== null}
                    className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {claimingVoucher === promotion.voucher_code ? "Adding…" : "Add to wallet"}
                  </button>
                  <p className="mt-2 text-xs text-slate-500">
                    Min. spend ₱{Number(promotion.min_order_amount || 0).toFixed(2)} · {promotion.end_date ? `Until ${new Date(promotion.end_date).toLocaleDateString("en-PH")}` : "No expiration"}
                  </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {onlineOrdering && (
          <section
            className={`mt-5 hidden grid-cols-2 gap-3 xl:grid ${platinumAccess ? "xl:grid-cols-4" : "xl:grid-cols-2"}`}
          >
            {serviceFeatures.map(({ icon: Icon, title }) => (
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
        )}

        <section
          id="merchant-about"
          tabIndex={-1}
          className={`${activeTab === "About" ? "grid" : "hidden"} mt-5 scroll-mt-20 gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm outline-none sm:grid-cols-2 xl:grid xl:grid-cols-4`}
        >
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

        <section
          id="merchant-reviews"
          tabIndex={-1}
          className={`${activeTab.startsWith("Reviews") ? "block" : "hidden"} mt-7 scroll-mt-20 outline-none xl:block`}
        >
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

      {variantProduct && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="variant-dialog-title"
          onClick={() => setVariantProduct(null)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase text-red-600">
                  Choose a variant
                </p>
                <h2 id="variant-dialog-title" className="mt-1 text-xl font-black">
                  {variantProduct.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setVariantProduct(null)}
                className="grid size-9 place-items-center rounded-full bg-slate-100 text-xl text-slate-600"
                aria-label="Close variant selection"
              >
                ×
              </button>
            </div>
            <div className="mt-5 grid gap-3">
              {(variantProduct.variants || [])
                .filter(
                  (variant) =>
                    variant.isActive &&
                    variant.availabilityStatus !== "Out of Stock",
                )
                .map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => add(variantProduct, variant)}
                    className="flex min-h-14 items-center justify-between rounded-2xl border border-slate-200 px-4 text-left transition hover:border-red-500 hover:bg-red-50 active:scale-[.99]"
                  >
                    <span className="font-bold">{variantName(variant)}</span>
                    <span className="font-black text-red-600">
                      ₱{Number(variant.price ?? productPrice(variantProduct)).toFixed(2)}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
