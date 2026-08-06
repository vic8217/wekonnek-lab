'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Product, ShopInventoryBalance, ShopProductAssignment, inventoryApi } from '@/lib/api';

type ActiveShop = { id: number; merchant_id: number; name: string };
type InventoryRow = { assignment: ShopProductAssignment; balance: ShopInventoryBalance };

export default function ShopInventoryPage() {
  const [shop, setShop] = useState<ActiveShop | null>(null);
  const [assignments, setAssignments] = useState<ShopProductAssignment[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const saved = sessionStorage.getItem('wk_active_shop');
    const activeShop = saved ? JSON.parse(saved) as ActiveShop : null;
    if (!activeShop) return setLoading(false);
    setShop(activeShop);
    try { const [inventory, history] = await Promise.all([inventoryApi.getShopInventory(), inventoryApi.getMovements()]); setAssignments(inventory); setMovements(history); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to load shop inventory'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => assignments.flatMap(assignment => assignment.inventory.map(balance => ({ assignment, balance }))), [assignments]);
  const summary = useMemo(() => ({
    items: rows.length,
    value: rows.reduce((sum, row) => sum + row.balance.quantity * Number(row.assignment.product.costPrice || 0), 0),
    low: rows.filter(row => row.balance.stockStatus === 'Low Stock').length,
    out: rows.filter(row => row.balance.stockStatus === 'Out of Stock').length,
    reserved: rows.reduce((sum, row) => sum + row.balance.reservedQuantity, 0),
  }), [rows]);

  const receive = async (row: InventoryRow) => {
    const quantity = Number(window.prompt('Quantity received'));
    if (!Number.isInteger(quantity) || quantity <= 0) return;
    const reference = window.prompt('Reference number (optional)') || undefined;
    const unitCostRaw = window.prompt('Unit cost (optional)') || '';
    const unitCost = unitCostRaw ? Number(unitCostRaw) : undefined;
    try { await inventoryApi.recordMovement({ productId: row.assignment.productId, variantId: row.balance.variantId, type: 'receipt', quantity, reference, unitCost, referenceType: 'purchase_receipt' } as any); await load(); toast.success('Stock received'); }
    catch (error) { toast.error(message(error)); }
  };
  const adjust = async (row: InventoryRow) => {
    const quantity = Number(window.prompt('Adjustment quantity (use a negative number to reduce stock)'));
    if (!Number.isInteger(quantity) || quantity === 0) return;
    const reason = window.prompt('Reason: Damaged, Expired, Lost, Physical Count, Correction, or Others');
    if (!reason) return;
    const notes = window.prompt('Notes (optional)') || undefined;
    try { await inventoryApi.recordMovement({ productId: row.assignment.productId, variantId: row.balance.variantId, type: 'adjustment', quantity, reason, notes } as any); await load(); toast.success('Adjustment recorded'); }
    catch (error) { toast.error(message(error)); }
  };
  const transfer = async (row: InventoryRow) => {
    const destinationShopId = Number(window.prompt('Destination shop numeric ID'));
    const quantity = Number(window.prompt('Quantity to transfer'));
    if (!Number.isInteger(destinationShopId) || !Number.isInteger(quantity) || quantity <= 0) return;
    const reference = window.prompt('Reference number (optional)') || undefined;
    try { await inventoryApi.transfer({ destinationShopId, productId: row.assignment.productId, variantId: row.balance.variantId, quantity, reference }); await load(); toast.success('Stock transferred'); }
    catch (error) { toast.error(message(error)); }
  };
  const reorder = async (row: InventoryRow) => {
    const reorderLevel = Number(window.prompt('Reorder level', String(row.balance.reorderLevel)));
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return;
    try { await inventoryApi.setReorderLevel({ productId: row.assignment.productId, variantId: row.balance.variantId, reorderLevel }); await load(); toast.success('Reorder level updated'); }
    catch (error) { toast.error(message(error)); }
  };

  if (loading) return <div className="py-12 text-center text-gray-500">Loading shop inventory...</div>;
  if (!shop) return <div className="rounded-xl border bg-white p-8 text-center text-gray-600">No active shop session.</div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-bold text-gray-900">Inventory</h1><p className="mt-1 text-gray-600">{shop.name} · Only assigned products with inventory tracking enabled appear here.</p></div><button onClick={() => setShowHistory(value => !value)} className="rounded-lg border border-red-600 px-4 py-2 font-semibold text-red-600">{showHistory ? 'View Inventory' : 'Movement History'}</button></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Card label="Total Inventory Items" value={summary.items} /><Card label="Inventory Value" value={`₱${summary.value.toLocaleString()}`} /><Card label="Low Stock Items" value={summary.low} /><Card label="Out of Stock" value={summary.out} /><Card label="Reserved Items" value={summary.reserved} /></div>
    {showHistory ? <MovementTable movements={movements} /> : <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-red-600 text-white"><tr>{['Product', 'Variant', 'Unit', 'On Hand', 'Reserved', 'Available', 'Reorder Level', 'Status', 'Action'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map(row => <tr key={row.balance.id}><td className="px-4 py-4"><button onClick={() => setSelected(row)} className="font-semibold text-blue-700 hover:underline">{row.assignment.product.name}</button></td><td className="px-4 py-4">{variantName(row.assignment.product, row.balance.variantId)}</td><td className="px-4 py-4">{row.assignment.product.unit || 'Piece'}</td><td className="px-4 py-4 font-bold">{row.balance.quantity}</td><td className="px-4 py-4">{row.balance.reservedQuantity}</td><td className="px-4 py-4 font-bold">{row.balance.availableQuantity}</td><td className="px-4 py-4"><button onClick={() => void reorder(row)} className="font-semibold text-blue-600">{row.balance.reorderLevel}</button></td><td className="px-4 py-4"><Status value={row.balance.stockStatus} /></td><td className="px-4 py-4"><div className="flex gap-3"><button onClick={() => void receive(row)} className="font-semibold text-green-700">Receive</button><button onClick={() => void adjust(row)} className="font-semibold text-amber-700">Adjust</button><button onClick={() => void transfer(row)} className="font-semibold text-blue-700">Transfer</button></div></td></tr>)}{!rows.length && <tr><td colSpan={9} className="px-5 py-12 text-center text-gray-500">No tracked inventory items. Assign a tracked product from My Shop → Products.</td></tr>}</tbody></table></section>}
    {selected && <Details row={selected} movements={movements.filter(item => item.productId === selected.assignment.productId && item.variantId === selected.balance.variantId)} close={() => setSelected(null)} />}
  </div>;
}

function Card({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-sm text-gray-500">{label}</p><p className="mt-2 text-2xl font-bold text-gray-900">{value}</p></div>; }
function Status({ value }: { value: string }) { const color = value === 'In Stock' ? 'bg-green-100 text-green-700' : value === 'Low Stock' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'; return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${color}`}>{value}</span>; }
function MovementTable({ movements }: { movements: any[] }) { return <section className="overflow-x-auto rounded-xl border bg-white shadow-sm"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-gray-900 text-white"><tr>{['Date', 'Type', 'Product', 'Variant', 'Quantity', 'Balance After', 'Reference', 'User'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{movements.map(item => <tr key={item.id}><td className="px-4 py-3">{new Date(item.createdAt).toLocaleString()}</td><td className="px-4 py-3 font-semibold">{String(item.type).replaceAll('_', ' ').toUpperCase()}</td><td className="px-4 py-3">{item.product?.name}</td><td className="px-4 py-3">{variantName(item.product, item.variantId)}</td><td className="px-4 py-3">{item.quantityChange > 0 ? '+' : ''}{item.quantityChange}</td><td className="px-4 py-3">{item.balanceAfter}</td><td className="px-4 py-3">{item.reference || '—'}</td><td className="px-4 py-3 text-xs">{item.createdByUser ? `${item.createdByUser.firstName || ''} ${item.createdByUser.lastName || ''}`.trim() || item.createdByUser.email : 'System'}</td></tr>)}{!movements.length && <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-500">No inventory movements recorded.</td></tr>}</tbody></table></section>; }
function Details({ row, movements, close }: { row: InventoryRow; movements: any[]; close: () => void }) { const last = (type: string) => movements.find(item => item.type === type)?.createdAt; return <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={close}><aside className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()}><div className="flex justify-between"><h2 className="text-xl font-bold">Inventory Details</h2><button onClick={close} className="text-2xl">×</button></div><h3 className="mt-6 font-bold">Product Information</h3><Info label="Product" value={row.assignment.product.name} /><Info label="Variant" value={variantName(row.assignment.product, row.balance.variantId)} /><Info label="Category" value={row.assignment.product.category?.name || '—'} /><Info label="SKU" value={variantSku(row.assignment.product, row.balance.variantId)} /><Info label="Unit" value={row.assignment.product.unit || 'Piece'} /><h3 className="mt-6 font-bold">Inventory</h3><Info label="On Hand" value={row.balance.quantity} /><Info label="Reserved" value={row.balance.reservedQuantity} /><Info label="Available" value={row.balance.availableQuantity} /><Info label="Reorder Level" value={row.balance.reorderLevel} /><h3 className="mt-6 font-bold">Movement Summary</h3><Info label="Last Received" value={formatDate(last('receipt'))} /><Info label="Last Sold" value={formatDate(last('sale'))} /><Info label="Last Adjustment" value={formatDate(last('adjustment'))} /><h3 className="mt-6 mb-2 font-bold">Recent Movements</h3>{movements.slice(0, 10).map(item => <div key={item.id} className="border-t py-3 text-sm"><p className="font-semibold">{String(item.type).replaceAll('_', ' ').toUpperCase()} · {item.quantityChange > 0 ? '+' : ''}{item.quantityChange}</p><p className="text-gray-500">{new Date(item.createdAt).toLocaleString()} · Balance {item.balanceAfter}</p></div>)}</aside></div>; }
function Info({ label, value }: { label: string; value: React.ReactNode }) { return <div className="mt-2 flex justify-between border-b pb-2 text-sm"><span className="text-gray-500">{label}</span><span className="font-semibold">{value}</span></div>; }
function variantName(product: Product, variantId?: number | null) { if (!variantId) return 'Standard'; const variant = product.variants?.find(item => item.id === variantId); return variant?.optionValues?.map(link => link.optionValue.value).join(' / ') || variant?.sku || `Variant ${variantId}`; }
function variantSku(product: Product, variantId?: number | null) { return variantId ? product.variants?.find(item => item.id === variantId)?.sku || '—' : product.baseSku || '—'; }
function formatDate(value?: string) { return value ? new Date(value).toLocaleString() : '—'; }
function message(error: unknown) { return error instanceof Error ? error.message : 'Inventory action failed'; }
