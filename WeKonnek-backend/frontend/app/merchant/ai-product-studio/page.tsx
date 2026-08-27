"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { Check, CreditCard, Layers3, Loader2, Package, Palette, Shirt, Sparkles, Upload, WandSparkles } from "lucide-react";
import { getToken } from "@/hooks/use-auth";
import { productsApi, type Merchant, type Product } from "@/lib/api";
import { aiProductStudioService, type ProductStudioGeneration, type ProductStudioStatus } from "@/lib/ai-product-studio";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const optionsByCategory: Record<string, string[]> = {
  Apparel: ["AI Model", "Mannequin", "Studio Product Shot"],
  Food: ["Menu Ready", "Clean Background", "Premium Food Presentation", "Promotional / Lifestyle"],
  "Grocery / FMCG": ["Clean Catalogue", "White Background", "Studio", "Lifestyle"],
  Beverages: ["Clean Catalogue", "White Background", "Studio", "Lifestyle"],
  default: ["Clean Catalogue", "Studio", "Lifestyle", "Promotional"],
};

const iconForCategory = (name: string) => {
  const value = name.toLowerCase();
  if (/(apparel|fashion|clothing|textile)/.test(value)) return Shirt;
  if (/(grocery|fmcg|retail)/.test(value)) return Layers3;
  if (/(beauty|cosmetic|personal care)/.test(value)) return Sparkles;
  if (/(home|living|furniture|decor)/.test(value)) return Palette;
  if (/(other|misc)/.test(value)) return WandSparkles;
  return Package;
};

const enhancementOptionsFor = (name: string) => {
  const value = name.toLowerCase();
  if (/(apparel|fashion|clothing|textile)/.test(value)) return optionsByCategory.Apparel;
  if (/(food|restaurant|meal|dish)/.test(value)) return optionsByCategory.Food;
  if (/(grocery|fmcg|retail)/.test(value)) return optionsByCategory["Grocery / FMCG"];
  if (/(beverage|drink)/.test(value)) return optionsByCategory.Beverages;
  return optionsByCategory.default;
};

export default function MerchantAIProductStudioPage() {
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("");
  const [style, setStyle] = useState(optionsByCategory.default[0]);
  const [model, setModel] = useState("Female");
  const [background, setBackground] = useState("White Studio");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [status, setStatus] = useState<ProductStudioStatus>("ready");
  const [generation, setGeneration] = useState<ProductStudioGeneration | null>(null);
  const [creditModal, setCreditModal] = useState(false);
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch(`${API}/api/merchants/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setMerchant(data))
      .catch(() => setMerchant(null));
  }, []);
  useEffect(() => {
    if (!merchant?.id) return;
    productsApi.getByMerchant(merchant.id).then(setProducts).catch(() => setProducts([]));
  }, [merchant?.id]);
  useEffect(() => {
    const productId = searchParams.get("productId");
    const product = products.find(item => String(item.id) === productId);
    if (!product?.imageUrl) return;
    setSelectedProduct(String(product.id)); setPreview(product.imageUrl); setFile(new File([], "existing-product-image.png", { type: "image/png" })); setCategory(product.subCategory?.name || product.category?.name || "");
  }, [products, searchParams]);
  const merchantCategories = [
    merchant?.subCategory?.name,
    merchant?.category?.name,
    ...products
      .filter((product) => product.merchantId === merchant?.id)
      .map((product) => product.subCategory?.name || product.category?.name),
  ].filter((name): name is string => Boolean(name));
  const availableCategories = Array.from(new Set(merchantCategories));
  const activeCategory = category || availableCategories[0] || "Product";
  const styles = enhancementOptionsFor(activeCategory);
  const chooseFile = async (picked?: File) => { if (!picked) return; try { setStatus("validating"); await aiProductStudioService.validateProductImage(picked); setFile(picked); setPreview(URL.createObjectURL(picked)); setStatus("ready"); } catch (error) { setStatus("failed"); toast.error(error instanceof Error ? error.message : "Unable to validate image"); } };
  const generate = async () => { if (!preview || !file) return; try { setStatus("generating"); const result = await aiProductStudioService.createGeneration({ originalImageUrl: preview, category: activeCategory }); setGeneration({ ...result, productName: products.find(product => String(product.id) === selectedProduct)?.name }); setStatus("review"); toast.success("Your image is ready for review."); } catch { setStatus("failed"); toast.error("Generation failed. Your credit was not deducted."); } };
  const isBusy = ["uploading", "validating", "queued", "generating"].includes(status);
  return <div className="space-y-6 pb-12">
    <section className="rounded-2xl bg-gradient-to-r from-red-600 via-red-600 to-purple-700 p-6 text-white shadow-sm md:flex md:items-center md:justify-between md:p-8"><div><div className="flex items-center gap-2 text-sm font-bold text-red-100"><Sparkles size={18} /> NEW FEATURE</div><h1 className="mt-2 text-3xl font-black">AI Product Studio</h1><p className="mt-2 max-w-2xl text-red-50">Turn simple product photos into catalogue-ready images using AI.</p><p className="mt-1 text-sm text-red-100">Take a photo. WeKonnek helps make it catalogue-ready.</p></div><div className="mt-5 flex items-center gap-3 md:mt-0"><div className="rounded-xl bg-white/15 px-4 py-3 text-center"><p className="text-xs font-bold uppercase tracking-wide text-red-100">AI Credits</p><p className="text-2xl font-black">18</p></div><button type="button" onClick={() => setCreditModal(true)} className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-red-700">Credit History</button></div></section>
    <section><h2 className="text-xl font-black text-gray-900">Choose a merchant product category</h2><p className="mt-1 text-sm text-gray-500">Categories are based on your merchant profile and existing products.</p>{availableCategories.length ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">{availableCategories.map((name) => { const Icon = iconForCategory(name); return <button key={name} type="button" onClick={() => { setCategory(name); setStyle(enhancementOptionsFor(name)[0]); }} className={`rounded-xl border p-4 text-left transition ${activeCategory === name ? "border-red-600 bg-red-50 text-red-700 ring-1 ring-red-600" : "border-gray-200 bg-white text-gray-700 hover:border-red-300"}`}><Icon size={22} /><span className="mt-3 block text-sm font-bold">{name}</span></button>; })}</div> : <p className="mt-3 rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">Add your merchant category or a product category to see tailored enhancement options.</p>}</section>
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:p-6"><div className="grid gap-6 xl:grid-cols-[1fr_1fr]"><div><h2 className="text-lg font-black text-gray-900">1. Upload Product Photo</h2><p className="mt-1 text-sm text-gray-500">JPG, JPEG, PNG or WebP. Keep the full product visible, well-lit, sharp, and unobstructed.</p><button type="button" onClick={() => inputRef.current?.click()} className="mt-4 flex min-h-52 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-red-200 bg-red-50/40 text-red-700 hover:bg-red-50"><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => chooseFile(event.target.files?.[0])} />{preview ? <Image src={preview} alt="Original product upload" width={300} height={180} unoptimized className="h-44 w-full object-contain" /> : <><Upload size={34} /><span className="mt-3 font-bold">Upload Photo</span></>}</button><label className="mt-4 block text-sm font-bold text-gray-700">Or select an existing product<select value={selectedProduct} onChange={event => { setSelectedProduct(event.target.value); const product = products.find(item => String(item.id) === event.target.value); if (product?.imageUrl) { const productCategory = product.subCategory?.name || product.category?.name || "Product"; setPreview(product.imageUrl); setFile(new File([], "existing-product-image.png", { type: "image/png" })); setCategory(productCategory); setStyle(enhancementOptionsFor(productCategory)[0]); } }} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="">Select Existing Product</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label></div>
      <div><h2 className="text-lg font-black text-gray-900">2. Enhancement Options</h2><label className="mt-4 block text-sm font-bold text-gray-700">{/(apparel|fashion|clothing|textile)/.test(activeCategory.toLowerCase()) ? "Presentation Style" : "Enhancement Style"}<select value={style} onChange={event => setStyle(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2">{styles.map(item => <option key={item}>{item}</option>)}</select></label>{/(apparel|fashion|clothing|textile)/.test(activeCategory.toLowerCase()) && style === "AI Model" && <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-gray-700">Model<select value={model} onChange={event => setModel(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2">{["Male", "Female", "Kids"].map(item => <option key={item}>{item}</option>)}</select></label><label className="text-sm font-bold text-gray-700">Background<select value={background} onChange={event => setBackground(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2">{["White Studio", "Light Studio", "Lifestyle", "Custom"].map(item => <option key={item}>{item}</option>)}</select></label></div>}{/(grocery|fmcg|retail|beverage|drink)/.test(activeCategory.toLowerCase()) && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Brand names, packaging, labels, product claims, size and important package details should remain consistent with the original product.</p>}<div className="mt-6 rounded-xl bg-gray-50 p-4"><p className="text-sm font-bold text-gray-800">This generation will use 1 AI Credit.</p><button disabled={!file || isBusy} type="button" onClick={generate} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{isBusy ? <><Loader2 className="animate-spin" size={18} /> {status === "validating" ? "Validating Photo" : "Generating"}</> : <><WandSparkles size={18} /> Generate AI Image — 1 Credit</>}</button></div></div></div>
      {generation && <ReviewPanel generation={generation} onApprove={() => { setGeneration(current => current ? { ...current, status: "approved" } : current); toast.success("Approved for your catalogue."); }} onDiscard={() => { setGeneration(null); setStatus("ready"); }} onRegenerate={() => { if (window.confirm("Generating another version will use another AI Credit. Continue?")) generate(); }} />}
    </section>
    <section><div className="flex items-center justify-between"><h2 className="text-xl font-black text-gray-900">Recent Creations</h2><span className="text-sm text-gray-500">Mocked until provider integration is connected</span></div><div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{generation ? <CreationCard generation={generation} /> : <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">Your recent generated catalogue images will appear here.</p>}</div></section>
    {creditModal && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"><CreditCard className="text-red-600" /><h2 className="mt-3 text-xl font-black">AI Credits</h2><p className="mt-2 text-gray-600">AI Credit purchasing will be available soon.</p><button type="button" onClick={() => setCreditModal(false)} className="mt-5 rounded-lg bg-red-600 px-4 py-2 font-bold text-white">Close</button></div></div>}
  </div>;
}
function ReviewPanel({ generation, onApprove, onDiscard, onRegenerate }: { generation: ProductStudioGeneration; onApprove: () => void; onDiscard: () => void; onRegenerate: () => void }) { return <div className="mt-6 border-t pt-6"><h2 className="text-lg font-black">Ready for Review</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{[["Original Product", generation.originalImageUrl], ["AI Generated", generation.generatedImageUrl || generation.originalImageUrl]].map(([label, src]) => <div key={label} className="rounded-xl border p-3"><p className="mb-2 text-sm font-bold">{label}</p><Image src={src} alt={label} width={600} height={360} unoptimized className="h-52 w-full rounded-lg object-contain bg-gray-50" /></div>)}</div><div className="mt-4 rounded-xl bg-gray-50 p-4"><p className="font-bold">Please confirm the AI image accurately represents your product:</p><div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">{["Color", "Design / Pattern", "Logo / Branding", "Product shape", "Important product details", "Packaging / Label"].map(item => <label key={item} className="flex items-center gap-2"><input type="checkbox" className="accent-red-600" /> {item}</label>)}</div></div><div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={onApprove} className="rounded-lg bg-red-600 px-4 py-2 font-bold text-white"><Check size={16} className="mr-1 inline" />Approve & Add to Catalogue</button><button type="button" onClick={onRegenerate} className="rounded-lg border border-red-600 px-4 py-2 font-bold text-red-600">Generate Another — 1 Credit</button><button type="button" onClick={onDiscard} className="rounded-lg border border-gray-300 px-4 py-2 font-bold text-gray-700">Discard</button></div><p className="mt-2 text-xs text-gray-500">Generating another version will use another AI Credit.</p></div> }
function CreationCard({ generation }: { generation: ProductStudioGeneration }) { return <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="relative h-36 overflow-hidden rounded-lg bg-gray-50"><Image src={generation.generatedImageUrl || generation.originalImageUrl} alt="Generated product" fill unoptimized className="object-contain" /></div><h3 className="mt-3 font-bold">{generation.productName || "Product Studio creation"}</h3><p className="mt-1 text-sm text-gray-500">{generation.category} · {new Date(generation.createdAt).toLocaleDateString()} · {generation.creditsUsed} credit</p><span className="mt-3 inline-block rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">{generation.status === "approved" ? "Approved" : "Ready for Review"}</span></article> }
