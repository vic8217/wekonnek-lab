'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { categoriesApi, CreateProductData, Product, productsApi, subCategoriesApi, uploadApi } from '@/lib/api';
import { syncProductCategories } from '@/lib/product-categories';

const UNITS = ['Piece', 'Pack', 'Bottle', 'Can', 'Cup', 'Glass', 'Plate', 'Serving', 'Bowl', 'Kilogram', 'Gram', 'Liter', 'Milliliter', 'Box', 'Pair', 'Roll', 'Meter', 'Set'];
const VARIANT_EXAMPLES = [
  { category: 'Food & Beverages', option: 'Size', values: 'Regular, Large', variant: 'Large Iced Latte — LATTE-LG' },
  { category: 'Groceries', option: 'Weight', values: '250 g, 500 g, 1 kg', variant: 'Rice 1 kg — RICE-1KG' },
  { category: 'Services', option: 'Package', values: 'Basic, Standard, Premium', variant: 'Premium Haircut — CUT-PREM' },
  { category: 'Retail & Shopping', option: 'Size / Color', values: 'S, M, L / Black, White', variant: 'Black Shirt, M — SHIRT-BLK-M' },
  { category: 'Health & Wellness', option: 'Duration', values: '30 min, 60 min, 90 min', variant: '60-minute Massage — MASSAGE-60' },
];
type OptionRow = { name: string; values: string };
type VariantRow = { sku: string; barcode: string; price: string; imageUrl: string; isActive: boolean; optionValues: Record<string, string> };

export default function ProductCatalogueForm({ productId }: { productId?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const basePath = pathname.startsWith('/shop') ? '/shop' : '/merchant';
  const fileRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [subcategories, setSubcategories] = useState<Array<{ id: number; name: string }>>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<'category' | 'subcategory' | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [loading, setLoading] = useState(Boolean(productId));
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [form, setForm] = useState({ name: '', description: '', brand: '', categoryId: '', subCategoryId: '', unit: 'Piece', sellingPrice: '', costPrice: '', discountPrice: '', baseSku: '', barcode: '', hasVariants: false, trackInventory: false, availabilityStatus: 'Available' });

  useEffect(() => { categoriesApi.getMine().then(data => setCategories(data || [])).catch(() => toast.error('Unable to load categories')); }, []);
  useEffect(() => {
    if (!form.categoryId) return;
    subCategoriesApi.getMineByCategory(Number(form.categoryId)).then(data => setSubcategories((data || []).map(item => ({ id: item.id, name: item.name }))));
  }, [form.categoryId]);
  useEffect(() => {
    if (!productId) return;
    productsApi.getById(productId).then((product: Product) => {
      setForm({
        name: product.name || '', description: product.description || '', brand: product.brand || '', categoryId: String(product.categoryId || ''), subCategoryId: String(product.subCategoryId || ''), unit: product.unit || 'Piece', sellingPrice: String(product.sellingPrice ?? product.price ?? ''), costPrice: String(product.costPrice ?? ''), discountPrice: String(product.discountPrice ?? ''), baseSku: product.baseSku || product.sku || product.productCode || '', barcode: product.barcode || '', hasVariants: Boolean(product.hasVariants), trackInventory: Boolean(product.trackInventory), availabilityStatus: product.availabilityStatus || (product.isAvailable ? 'Available' : 'Unavailable'),
      });
      setPreview(product.imageUrl || null);
      setOptions((product.options || []).map(option => ({ name: option.name, values: option.values.map(value => value.value).join(', ') })));
      setVariants((product.variants || []).map(variant => ({ sku: variant.sku, barcode: variant.barcode || '', price: String(variant.price ?? ''), imageUrl: variant.imageUrl || '', isActive: variant.isActive, optionValues: Object.fromEntries((variant.optionValues || []).map(link => [link.optionValue.option.name, link.optionValue.value])) })));
    }).catch(() => toast.error('Unable to load product')).finally(() => setLoading(false));
  }, [productId]);

  const optionValues = (option: OptionRow) => option.values.split(',').map(value => value.trim()).filter(Boolean);
  const update = (name: string, value: string | boolean) => setForm(current => ({ ...current, [name]: value }));
  const openCategoryDialog = (type: 'category' | 'subcategory') => { setCategoryName(''); setCategoryDialog(type); };
  const createCategoryOption = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) return;
    setSavingCategory(true);
    try {
      if (categoryDialog === 'category') {
        const created = await categoriesApi.createMine(name);
        setCategories(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
        setSubcategories([]);
        setForm(current => ({ ...current, categoryId: String(created.id), subCategoryId: '' }));
        toast.success('Category created and selected');
      } else if (form.categoryId) {
        const created = await subCategoriesApi.createMine(Number(form.categoryId), name);
        setSubcategories(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
        update('subCategoryId', String(created.id));
        toast.success('Subcategory created and selected');
      }
      setCategoryDialog(null);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Unable to create category');
    } finally { setSavingCategory(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.hasVariants && (!options.length || !variants.length)) return toast.error('Add at least one option and variant.');
    if (form.hasVariants && variants.some(variant => !variant.sku.trim())) return toast.error('Every variant needs a unique SKU.');
    setSaving(true);
    try {
      let imageUrl = preview || undefined;
      if (fileRef.current?.files?.[0]) imageUrl = await uploadApi.uploadFile(fileRef.current.files[0], 'establishment');
      const payload: CreateProductData = {
        name: form.name, description: form.description || undefined, brand: form.brand || undefined,
        categoryId: form.categoryId ? Number(form.categoryId) : undefined, subCategoryId: form.subCategoryId ? Number(form.subCategoryId) : undefined,
        unit: form.unit, sellingPrice: Number(form.sellingPrice), costPrice: form.costPrice ? Number(form.costPrice) : undefined, discountPrice: form.discountPrice ? Number(form.discountPrice) : undefined,
        baseSku: form.baseSku || undefined, barcode: form.barcode || undefined, imageUrl, hasVariants: form.hasVariants, trackInventory: form.trackInventory, availabilityStatus: form.availabilityStatus,
        options: form.hasVariants ? options.filter(option => option.name.trim()).map(option => ({ name: option.name.trim(), values: optionValues(option) })) : [],
        variants: form.hasVariants ? variants.map(variant => ({ sku: variant.sku.trim(), barcode: variant.barcode || undefined, price: variant.price ? Number(variant.price) : undefined, imageUrl: variant.imageUrl || undefined, isActive: variant.isActive, optionValues: variant.optionValues })) : [],
      };
      const saved = productId ? await productsApi.update(productId, payload) : await productsApi.create(payload);
      if (form.categoryId) await syncProductCategories(Number(saved.id), [{ categoryId: Number(form.categoryId), subCategoryId: form.subCategoryId ? Number(form.subCategoryId) : null, isPrimary: true }]);
      toast.success(productId ? 'Product updated' : 'Product added');
      router.push(`${basePath}/inventory`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save product'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="py-12 text-center text-gray-500">Loading product...</div>;
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold text-gray-900">{productId ? 'Edit' : 'Add'} Product / Service</h1><p className="mt-1 text-gray-600">Build an industry-neutral catalogue item.</p></div>
    <form onSubmit={submit} className="space-y-6">
      <Section title="Basic Information"><div className="grid gap-4 md:grid-cols-2">
        <Field label="Product Name" required><input required value={form.name} onChange={e => update('name', e.target.value)} className="input" /></Field>
        <Field label="Brand (optional)"><input value={form.brand} onChange={e => update('brand', e.target.value)} className="input" /></Field>
        <Field label="Unit" required><select required value={form.unit} onChange={e => update('unit', e.target.value)} className="input">{UNITS.map(value => <option key={value}>{value}</option>)}</select></Field>
        <Field label="Category"><div className="flex gap-2"><select value={form.categoryId} onChange={e => { update('categoryId', e.target.value); update('subCategoryId', ''); }} className="input"><option value="" disabled>{categories.length ? 'Select a category' : 'Create a category first'}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select><button type="button" onClick={() => openCategoryDialog('category')} className="shrink-0 rounded-lg border border-red-600 px-4 text-sm font-semibold text-red-600 hover:bg-red-50">+ Create</button></div></Field>
        <Field label="Subcategory (optional)"><div className="flex gap-2"><select value={form.subCategoryId} onChange={e => update('subCategoryId', e.target.value)} className="input" disabled={!form.categoryId}><option value="">{form.categoryId ? 'None' : 'Select a category first'}</option>{subcategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select><button type="button" disabled={!form.categoryId} onClick={() => openCategoryDialog('subcategory')} className="shrink-0 rounded-lg border border-red-600 px-4 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400">+ Create</button></div></Field>
        <div className="md:col-span-2"><Field label="Description"><textarea rows={4} value={form.description} onChange={e => update('description', e.target.value)} className="input" /></Field></div>
      </div></Section>
      <Section title="Pricing and Identification"><div className="grid gap-4 md:grid-cols-3">
        <Field label="Selling Price" required><input required type="number" min="0" step="0.01" value={form.sellingPrice} onChange={e => update('sellingPrice', e.target.value)} className="input" /></Field>
        <Field label="Cost Price (optional)"><input type="number" min="0" step="0.01" value={form.costPrice} onChange={e => update('costPrice', e.target.value)} className="input" /></Field>
        <Field label="Discount Price (optional)"><input type="number" min="0" step="0.01" value={form.discountPrice} onChange={e => update('discountPrice', e.target.value)} className="input" /></Field>
        <Field label="SKU / Product Code (optional)"><input value={form.baseSku} onChange={e => update('baseSku', e.target.value)} className="input" /></Field>
        <Field label="Barcode (optional)"><input value={form.barcode} onChange={e => update('barcode', e.target.value)} className="input" /></Field>
      </div></Section>
      <Section title="Configuration"><div className="flex flex-wrap gap-8"><Toggle label="Has Variants" checked={form.hasVariants} set={value => update('hasVariants', value)} /><Toggle label="Track Inventory" checked={form.trackInventory} set={value => update('trackInventory', value)} /></div></Section>
      {form.hasVariants && <Section title="Generic Variant Options"><div className="space-y-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="text-base font-bold text-gray-900">What is a variant?</p><p className="mt-1 max-w-4xl">A variant is a different sellable version of the same product or service. Customers still see one product, but they can choose a size, color, weight, flavor, duration, or package. Each version can have its own SKU and price.</p></div><button type="button" onClick={() => { setOptions([{ name: 'Size', values: 'Small, Medium, Large' }]); setVariants([{ sku: 'SHIRT-S', barcode: '', price: '499', imageUrl: '', isActive: true, optionValues: { Size: 'Small' } }, { sku: 'SHIRT-M', barcode: '', price: '549', imageUrl: '', isActive: true, optionValues: { Size: 'Medium' } }, { sku: 'SHIRT-L', barcode: '', price: '599', imageUrl: '', isActive: true, optionValues: { Size: 'Large' } }]); }} className="shrink-0 rounded-lg border border-blue-600 bg-white px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">Load size sample</button></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><p className="font-bold text-emerald-900">Use variants when</p><p className="mt-1 text-xs text-emerald-800">The choices are versions of one item, such as Small/Medium/Large shirts or 30/60/90-minute massages.</p></div><div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="font-bold text-amber-900">Do not use variants when</p><p className="mt-1 text-xs text-amber-800">The items are completely different products, such as coffee and sandwiches. Create separate products instead.</p></div></div>
          <div className="mt-4 overflow-hidden rounded-lg border border-blue-200 bg-white"><div className="border-b border-blue-100 px-3 py-2 font-bold text-gray-900">Complete example: Classic Shirt</div><div className="grid grid-cols-3 bg-blue-50 px-3 py-2 text-xs font-bold text-gray-700"><span>Customer chooses</span><span>Unique SKU</span><span>Price</span></div>{[['Small', 'SHIRT-S', '₱499'], ['Medium', 'SHIRT-M', '₱549'], ['Large', 'SHIRT-L', '₱599']].map(row => <div key={row[0]} className="grid grid-cols-3 border-t border-blue-100 px-3 py-2 text-xs"><span>{row[0]}</span><span className="font-mono">{row[1]}</span><span>{row[2]}</span></div>)}</div>
          <p className="mt-4 font-semibold text-gray-900">How to create variants</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5"><li>Add an option customers will choose.</li><li>Enter its possible values separated by commas.</li><li>Add one variant for every value or combination you sell.</li><li>Give every variant a unique SKU and optionally a different price.</li></ol>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {VARIANT_EXAMPLES.map(example => <div key={example.category} className="rounded-md bg-white p-3 ring-1 ring-blue-100"><p className="font-semibold text-gray-900">{example.category}</p><p><span className="font-medium">Option:</span> {example.option}</p><p><span className="font-medium">Values:</span> {example.values}</p><p className="mt-1 text-xs text-gray-500">Example variant: {example.variant}</p></div>)}
          </div>
          <p className="mt-3 text-xs text-gray-600">Leave a variant price blank to use the main selling price. Add a price only when that version costs more or less.</p>
        </div>
        {options.map((option, index) => <div key={index} className="grid gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-[1fr_2fr_auto]"><input placeholder="Option name (e.g. Size)" value={option.name} onChange={e => setOptions(rows => rows.map((row, i) => i === index ? { ...row, name: e.target.value } : row))} className="input" /><input placeholder="Values separated by commas" value={option.values} onChange={e => setOptions(rows => rows.map((row, i) => i === index ? { ...row, values: e.target.value } : row))} className="input" /><button type="button" onClick={() => setOptions(rows => rows.filter((_, i) => i !== index))} className="px-3 font-bold text-red-600">Remove</button></div>)}
        <button type="button" onClick={() => setOptions(rows => [...rows, { name: '', values: '' }])} className="rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-600">Add Option</button>
        <div className="border-t border-gray-200 pt-4"><h3 className="mb-3 font-bold text-gray-900">Variants</h3>{variants.map((variant, index) => <div key={index} className="mb-3 space-y-3 rounded-lg border border-gray-200 p-4"><div className="grid gap-3 md:grid-cols-5"><input required placeholder="Variant SKU" value={variant.sku} onChange={e => setVariants(rows => rows.map((row, i) => i === index ? { ...row, sku: e.target.value } : row))} className="input" /><input placeholder="Barcode" value={variant.barcode} onChange={e => setVariants(rows => rows.map((row, i) => i === index ? { ...row, barcode: e.target.value } : row))} className="input" /><input type="number" min="0" step="0.01" placeholder="Price override" value={variant.price} onChange={e => setVariants(rows => rows.map((row, i) => i === index ? { ...row, price: e.target.value } : row))} className="input" /><input type="url" placeholder="Image URL (optional)" value={variant.imageUrl} onChange={e => setVariants(rows => rows.map((row, i) => i === index ? { ...row, imageUrl: e.target.value } : row))} className="input" /><button type="button" onClick={() => setVariants(rows => rows.filter((_, i) => i !== index))} className="font-semibold text-red-600">Remove</button></div><div className="grid gap-3 md:grid-cols-3">{options.filter(option => option.name).map(option => <select key={option.name} value={variant.optionValues[option.name] || ''} onChange={e => setVariants(rows => rows.map((row, i) => i === index ? { ...row, optionValues: { ...row.optionValues, [option.name]: e.target.value } } : row))} className="input"><option value="">{option.name}</option>{optionValues(option).map(value => <option key={value}>{value}</option>)}</select>)}</div><Toggle label="Active" checked={variant.isActive} set={value => setVariants(rows => rows.map((row, i) => i === index ? { ...row, isActive: value } : row))} /></div>)}<button type="button" onClick={() => setVariants(rows => [...rows, { sku: '', barcode: '', price: '', imageUrl: '', isActive: true, optionValues: {} }])} className="rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-600">Add Variant</button></div>
      </div></Section>}
      <Section title="Product Image"><div onClick={() => fileRef.current?.click()} className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-8 text-center"><input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) setPreview(URL.createObjectURL(file)); }} />{preview ? <div className="relative mx-auto h-48 max-w-md"><Image src={preview} alt="Product preview" fill unoptimized className="object-contain" /></div> : <p className="text-gray-500">Click to upload JPG or PNG</p>}</div></Section>
      <div className="flex justify-end gap-3"><button type="button" onClick={() => router.back()} className="rounded-lg border border-gray-300 px-5 py-3 font-semibold text-gray-700">Cancel</button><button disabled={saving} className="rounded-lg bg-red-600 px-6 py-3 font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save Product'}</button></div>
    </form>
    {categoryDialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title"><form onSubmit={createCategoryOption} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"><h2 id="category-dialog-title" className="text-xl font-bold text-gray-900">Create {categoryDialog === 'category' ? 'Category' : 'Subcategory'}</h2><p className="mt-1 text-sm text-gray-500">This option belongs to your merchant and will be selected after creation.</p><label className="mt-5 block"><span className="mb-2 block text-sm font-medium text-gray-700">Name <span className="text-red-600">*</span></span><input autoFocus required maxLength={255} value={categoryName} onChange={e => setCategoryName(e.target.value)} className="input" placeholder={categoryDialog === 'category' ? 'e.g. Specialty Drinks' : 'e.g. Fruit Teas'} /></label><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={savingCategory} onClick={() => setCategoryDialog(null)} className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700">Cancel</button><button disabled={savingCategory || !categoryName.trim()} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{savingCategory ? 'Creating...' : 'Create and select'}</button></div></form></div>}
    <style jsx global>{`.input{width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.7rem .85rem;outline:none}.input:focus{border-color:#dc2626;box-shadow:0 0 0 2px #fee2e2}.input:disabled{background:#f3f4f6}`}</style></div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"><h2 className="mb-5 text-xl font-bold text-gray-900">{title}</h2>{children}</section>; }
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-sm font-medium text-gray-700">{label}{required && <span className="text-red-600"> *</span>}</span>{children}</label>; }
function Toggle({ label, checked, set }: { label: string; checked: boolean; set: (value: boolean) => void }) { return <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} className="h-5 w-5 accent-red-600" /><span className="font-medium text-gray-700">{label}</span></label>; }
