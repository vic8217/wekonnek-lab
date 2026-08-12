"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Product,
  ShopInventoryBalance,
  ShopProductAssignment,
  inventoryApi,
} from "@/lib/api";

type ActiveShop = { id: number; merchant_id: number; name: string };
type InventoryRow = {
  assignment: ShopProductAssignment;
  balance: ShopInventoryBalance;
};
type Destination = { id: number; name: string; city?: string | null };

export default function ShopInventoryPage() {
  const [shop, setShop] = useState<ActiveShop | null>(null);
  const [assignments, setAssignments] = useState<ShopProductAssignment[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const [receiving, setReceiving] = useState<InventoryRow | null>(null);
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [transferring, setTransferring] = useState<InventoryRow | null>(null);
  const [closing, setClosing] = useState<InventoryRow | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [dailyCounts, setDailyCounts] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const saved = sessionStorage.getItem("wk_active_shop");
    const activeShop = saved ? (JSON.parse(saved) as ActiveShop) : null;
    if (!activeShop) return setLoading(false);
    setShop(activeShop);
    try {
      const [inventory, history, destinationRows, countRows] =
        await Promise.all([
          inventoryApi.getShopInventory(),
          inventoryApi.getMovements(),
          inventoryApi.getTransferDestinations(),
          inventoryApi.getDailyCounts(),
        ]);
      setAssignments(inventory);
      setMovements(history);
      setDestinations(destinationRows);
      setDailyCounts(countRows);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load shop inventory",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () =>
      assignments.flatMap((assignment) =>
        assignment.inventory.map((balance) => ({ assignment, balance })),
      ),
    [assignments],
  );
  const summary = useMemo(
    () => ({
      items: rows.length,
      low: rows.filter((row) => row.balance.stockStatus === "Low Stock").length,
      out: rows.filter((row) => row.balance.stockStatus === "Out of Stock")
        .length,
      reserved: rows.reduce(
        (sum, row) => sum + row.balance.reservedQuantity,
        0,
      ),
    }),
    [rows],
  );

  const reorder = async (row: InventoryRow) => {
    const reorderLevel = Number(
      window.prompt("Reorder level", String(row.balance.reorderLevel)),
    );
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return;
    try {
      await inventoryApi.setReorderLevel({
        productId: row.assignment.productId,
        variantId: row.balance.variantId,
        reorderLevel,
      });
      await load();
      toast.success("Reorder level updated");
    } catch (error) {
      toast.error(message(error));
    }
  };

  if (loading)
    return (
      <div className="py-12 text-center text-gray-500">
        Loading shop inventory...
      </div>
    );
  if (!shop)
    return (
      <div className="rounded-xl border bg-white p-8 text-center text-gray-600">
        No active shop session.
      </div>
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Inventory</h1>
          <p className="mt-1 text-gray-600">
            {shop.name} · Only assigned products with inventory tracking enabled
            appear here.
          </p>
        </div>
        <button
          onClick={() => setShowHistory((value) => !value)}
          className="rounded-lg border border-red-600 px-4 py-2 font-semibold text-red-600"
        >
          {showHistory ? "View Inventory" : "Movement History"}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Total Inventory Items" value={summary.items} />
        <Card label="Low Stock Items" value={summary.low} />
        <Card label="Out of Stock" value={summary.out} />
        <Card label="Reserved Items" value={summary.reserved} />
      </div>
      {showHistory ? (
        <MovementTable movements={movements} />
      ) : (
        <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full min-w-[1250px] text-left text-sm">
            <thead className="bg-red-600 text-white">
              <tr>
                {[
                  "Product",
                  "Variant",
                  "Unit",
                  "On Hand",
                  "Reserved",
                  "Available",
                  "Reorder Level",
                  "Status",
                  "Action",
                  "Daily Reconciliation",
                ].map((label) => (
                  <th key={label} className="px-4 py-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.balance.id}>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => setSelected(row)}
                      className="font-semibold text-blue-700 hover:underline"
                    >
                      {row.assignment.product.name}
                    </button>
                  </td>
                  <td className="px-4 py-4">
                    {variantName(row.assignment.product, row.balance.variantId)}
                  </td>
                  <td className="px-4 py-4">
                    {row.assignment.product.unit || "Piece"}
                  </td>
                  <td className="px-4 py-4 font-bold">
                    {row.balance.quantity}
                  </td>
                  <td className="px-4 py-4">{row.balance.reservedQuantity}</td>
                  <td className="px-4 py-4 font-bold">
                    {row.balance.availableQuantity}
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => void reorder(row)}
                      className="font-semibold text-blue-600"
                    >
                      {row.balance.reorderLevel}
                    </button>
                  </td>
                  <td className="px-4 py-4">
                    <Status value={row.balance.stockStatus} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setReceiving(row)}
                        className="rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 transition hover:bg-green-100"
                      >
                        Receive
                      </button>
                      <button
                        onClick={() => setAdjusting(row)}
                        className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                      >
                        Adjust
                      </button>
                      <button
                        onClick={() => setTransferring(row)}
                        className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                      >
                        Transfer
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => setClosing(row)}
                      className="whitespace-nowrap rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 transition hover:bg-purple-100"
                    >
                      End Count
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-5 py-12 text-center text-gray-500"
                  >
                    No tracked inventory items. Assign a tracked product from My
                    Shop → Products.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
      {selected && (
        <Details
          row={selected}
          movements={movements.filter(
            (item) =>
              item.productId === selected.assignment.productId &&
              item.variantId === selected.balance.variantId,
          )}
          close={() => setSelected(null)}
        />
      )}
      {receiving && (
        <ReceiveModal
          row={receiving}
          close={() => setReceiving(null)}
          saved={async () => {
            setReceiving(null);
            await load();
          }}
        />
      )}
      {adjusting && (
        <AdjustModal
          row={adjusting}
          close={() => setAdjusting(null)}
          saved={async () => {
            setAdjusting(null);
            await load();
          }}
        />
      )}
      {transferring && (
        <TransferModal
          row={transferring}
          destinations={destinations}
          close={() => setTransferring(null)}
          saved={async () => {
            setTransferring(null);
            await load();
          }}
        />
      )}
      {closing && (
        <EndCountModal
          row={closing}
          movements={movements}
          close={() => setClosing(null)}
          saved={async () => {
            setClosing(null);
            await load();
          }}
        />
      )}
      {dailyCounts.length > 0 && !showHistory && (
        <DailyCountTable counts={dailyCounts} />
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
function Status({ value }: { value: string }) {
  const color =
    value === "In Stock"
      ? "bg-green-100 text-green-700"
      : value === "Low Stock"
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${color}`}>
      {value}
    </span>
  );
}
function MovementTable({ movements }: { movements: any[] }) {
  return (
    <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table className="w-full min-w-[1200px] text-left text-sm">
        <thead className="bg-gray-900 text-white">
          <tr>
            {[
              "Recorded",
              "Type",
              "Product",
              "Variant",
              "Quantity",
              "Balance After",
              "DR Reference",
              "Delivery Details",
              "User",
            ].map((label) => (
              <th key={label} className="px-4 py-3">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {movements.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-3">
                {new Date(item.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 font-semibold">
                {String(item.type).replaceAll("_", " ").toUpperCase()}
              </td>
              <td className="px-4 py-3">{item.product?.name}</td>
              <td className="px-4 py-3">
                {variantName(item.product, item.variantId)}
              </td>
              <td className="px-4 py-3">
                {item.quantityChange > 0 ? "+" : ""}
                {item.quantityChange}
              </td>
              <td className="px-4 py-3">{item.balanceAfter}</td>
              <td className="px-4 py-3">{item.reference || "—"}</td>
              <td className="px-4 py-3 text-xs">
                <p>
                  {item.deliveryDate
                    ? `DR date: ${new Date(item.deliveryDate).toLocaleDateString()}`
                    : "—"}
                </p>
                {item.deliveredBy && <p>Delivered by: {item.deliveredBy}</p>}
                {item.receivedAt && (
                  <p>Received: {new Date(item.receivedAt).toLocaleString()}</p>
                )}
              </td>
              <td className="px-4 py-3 text-xs">
                {item.createdByUser
                  ? `${item.createdByUser.firstName || ""} ${item.createdByUser.lastName || ""}`.trim() ||
                    item.createdByUser.email
                  : "System"}
              </td>
            </tr>
          ))}
          {!movements.length && (
            <tr>
              <td colSpan={9} className="px-5 py-12 text-center text-gray-500">
                No inventory movements recorded.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function ReceiveModal({
  row,
  close,
  saved,
}: {
  row: InventoryRow;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const now = new Date();
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  const [step, setStep] = useState(1),
    [quantity, setQuantity] = useState(""),
    [deliveryDate, setDeliveryDate] = useState(localNow.slice(0, 10)),
    [reference, setReference] = useState(""),
    [deliveredBy, setDeliveredBy] = useState(""),
    [receivedAt, setReceivedAt] = useState(localNow),
    [notes, setNotes] = useState(""),
    [saving, setSaving] = useState(false);
  const validQuantity =
    Number.isInteger(Number(quantity)) && Number(quantity) > 0;
  const submit = async () => {
    if (!reference.trim()) return toast.error("DR reference is required");
    setSaving(true);
    try {
      await inventoryApi.recordMovement({
        productId: row.assignment.productId,
        variantId: row.balance.variantId,
        type: "receipt",
        quantity: Number(quantity),
        reference: reference.trim(),
        referenceType: "delivery_receipt",
        deliveryDate,
        deliveredBy: deliveredBy.trim() || undefined,
        receivedAt: new Date(receivedAt).toISOString(),
        notes: notes.trim() || undefined,
      });
      toast.success("Stock received");
      await saved();
    } catch (error) {
      toast.error(message(error));
      setSaving(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onMouseDown={() => !saving && close()}
    >
      <section
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
      >
        <header className="border-b p-6">
          <div className="flex justify-between">
            <div>
              <h2 className="text-xl font-bold">Receive Inventory</h2>
              <p className="mt-1 text-sm text-gray-500">
                {row.assignment.product.name} ·{" "}
                {variantName(row.assignment.product, row.balance.variantId)}
              </p>
            </div>
            <button
              onClick={close}
              disabled={saving}
              aria-label="Close"
              className="text-2xl text-gray-400"
            >
              ×
            </button>
          </div>
          <div className="mt-5 flex items-center gap-2">
            <Step
              number={1}
              label="Quantity"
              active={step === 1}
              complete={step > 1}
            />
            <div className="h-px flex-1 bg-gray-200" />
            <Step
              number={2}
              label="Delivery details"
              active={step === 2}
              complete={false}
            />
          </div>
        </header>
        <div className="p-6">
          {step === 1 ? (
            <div>
              <label className="text-sm font-bold text-gray-700">
                Quantity received
                <input
                  autoFocus
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="0"
                  className="mt-2 w-full rounded-xl border px-4 py-4 text-2xl font-bold outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />
              </label>
              <p className="mt-3 text-sm text-gray-500">
                Current on hand: <b>{row.balance.quantity}</b> · New total:{" "}
                <b>
                  {row.balance.quantity +
                    (validQuantity ? Number(quantity) : 0)}
                </b>
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-gray-700">
                DR date
                <input
                  required
                  type="date"
                  value={deliveryDate}
                  onChange={(event) => setDeliveryDate(event.target.value)}
                  className="mt-1 w-full rounded-xl border p-3 font-normal"
                />
              </label>
              <label className="text-sm font-bold text-gray-700">
                DR reference <span className="text-red-600">*</span>
                <input
                  required
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="e.g. DR-23849"
                  className="mt-1 w-full rounded-xl border p-3 font-normal"
                />
              </label>
              <label className="text-sm font-bold text-gray-700 sm:col-span-2">
                Delivered by
                <input
                  value={deliveredBy}
                  onChange={(event) => setDeliveredBy(event.target.value)}
                  placeholder="Driver, supplier, or courier name"
                  className="mt-1 w-full rounded-xl border p-3 font-normal"
                />
              </label>
              <label className="text-sm font-bold text-gray-700 sm:col-span-2">
                Time received
                <input
                  required
                  type="datetime-local"
                  value={receivedAt}
                  onChange={(event) => setReceivedAt(event.target.value)}
                  className="mt-1 w-full rounded-xl border p-3 font-normal"
                />
              </label>
              <label className="text-sm font-bold text-gray-700 sm:col-span-2">
                Notes (optional)
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border p-3 font-normal"
                />
              </label>
            </div>
          )}
        </div>
        <footer className="flex justify-between border-t p-6">
          <button
            onClick={() => (step === 1 ? close() : setStep(1))}
            disabled={saving}
            className="rounded-xl border px-5 py-2.5 font-bold"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              disabled={!validQuantity}
              className="rounded-xl bg-red-600 px-5 py-2.5 font-bold text-white disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => void submit()}
              disabled={
                saving || !deliveryDate || !receivedAt || !reference.trim()
              }
              className="rounded-xl bg-red-600 px-5 py-2.5 font-bold text-white disabled:opacity-40"
            >
              {saving ? "Recording…" : "Confirm Receipt"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
function Step({
  number,
  label,
  active,
  complete,
}: {
  number: number;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 text-xs font-bold ${active || complete ? "text-red-600" : "text-gray-400"}`}
    >
      <span
        className={`grid size-7 place-items-center rounded-full border-2 ${active ? "border-red-600 bg-red-600 text-white" : complete ? "border-red-600" : "border-gray-300"}`}
      >
        {complete ? "✓" : number}
      </span>
      <span>{label}</span>
    </div>
  );
}

function AdjustModal({
  row,
  close,
  saved,
}: {
  row: InventoryRow;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const amount = Number(quantity);
  const valid =
    Number.isInteger(amount) &&
    amount !== 0 &&
    row.balance.quantity + amount >= 0 &&
    Boolean(reason);
  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await inventoryApi.recordMovement({
        productId: row.assignment.productId,
        variantId: row.balance.variantId,
        type: "adjustment",
        quantity: amount,
        reason,
        notes,
      });
      toast.success("Inventory adjustment recorded");
      await saved();
    } catch (error) {
      toast.error(message(error));
      setSaving(false);
    }
  };
  return (
    <InventoryModal
      title="Adjust Inventory"
      subtitle={`${row.assignment.product.name} · ${variantName(row.assignment.product, row.balance.variantId)}`}
      close={close}
      saving={saving}
      footer={
        <>
          <button
            onClick={close}
            disabled={saving}
            className="rounded-xl border px-5 py-2.5 font-bold"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving || !valid}
            className="rounded-xl bg-red-600 px-5 py-2.5 font-bold text-white disabled:opacity-40"
          >
            {saving ? "Recording…" : "Confirm Adjustment"}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <label className="text-sm font-bold text-gray-700">
          Adjustment quantity <span className="text-red-600">*</span>
          <input
            autoFocus
            type="number"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Use a negative number to reduce stock"
            className="mt-1 w-full rounded-xl border p-3 font-normal"
          />
        </label>
        <p className="-mt-2 text-sm text-gray-500">
          Current on hand: <b>{row.balance.quantity}</b> · New total:{" "}
          <b>
            {Number.isInteger(amount)
              ? row.balance.quantity + amount
              : row.balance.quantity}
          </b>
        </p>
        <label className="text-sm font-bold text-gray-700">
          Reason <span className="text-red-600">*</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
          >
            <option value="">Select a reason</option>
            {[
              "Damaged",
              "Expired",
              "Lost",
              "Physical Count",
              "Correction",
              "Other",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-bold text-gray-700">
          Notes (optional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border p-3 font-normal"
          />
        </label>
      </div>
    </InventoryModal>
  );
}

function TransferModal({
  row,
  destinations,
  close,
  saved,
}: {
  row: InventoryRow;
  destinations: Destination[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [step, setStep] = useState(1),
    [quantity, setQuantity] = useState(""),
    [destination, setDestination] = useState(""),
    [reference, setReference] = useState(""),
    [notes, setNotes] = useState(""),
    [saving, setSaving] = useState(false);
  const amount = Number(quantity),
    validQuantity =
      Number.isInteger(amount) &&
      amount > 0 &&
      amount <= row.balance.availableQuantity;
  const submit = async () => {
    if (!validQuantity || !destination) return;
    setSaving(true);
    try {
      await inventoryApi.transfer({
        destinationShopId: Number(destination),
        productId: row.assignment.productId,
        variantId: row.balance.variantId,
        quantity: amount,
        reference: reference.trim() || undefined,
        notes,
      });
      toast.success("Inventory transferred");
      await saved();
    } catch (error) {
      toast.error(message(error));
      setSaving(false);
    }
  };
  return (
    <InventoryModal
      title="Transfer Inventory"
      subtitle={`${row.assignment.product.name} · ${variantName(row.assignment.product, row.balance.variantId)}`}
      close={close}
      saving={saving}
      steps={
        <>
          <Step
            number={1}
            label="Quantity"
            active={step === 1}
            complete={step > 1}
          />
          <div className="h-px flex-1 bg-gray-200" />
          <Step
            number={2}
            label="Transfer details"
            active={step === 2}
            complete={false}
          />
        </>
      }
      footer={
        <>
          <button
            onClick={() => (step === 1 ? close() : setStep(1))}
            disabled={saving}
            className="rounded-xl border px-5 py-2.5 font-bold"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              disabled={!validQuantity}
              className="rounded-xl bg-red-600 px-5 py-2.5 font-bold text-white disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => void submit()}
              disabled={saving || !destination}
              className="rounded-xl bg-red-600 px-5 py-2.5 font-bold text-white disabled:opacity-40"
            >
              {saving ? "Transferring…" : "Confirm Transfer"}
            </button>
          )}
        </>
      }
    >
      {step === 1 ? (
        <div>
          <label className="text-sm font-bold text-gray-700">
            Quantity to transfer
            <input
              autoFocus
              type="number"
              min="1"
              max={row.balance.availableQuantity}
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-4 text-2xl font-bold"
            />
          </label>
          <p className="mt-3 text-sm text-gray-500">
            Available to transfer: <b>{row.balance.availableQuantity}</b>
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          <label className="text-sm font-bold text-gray-700">
            Destination shop <span className="text-red-600">*</span>
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
            >
              <option value="">Select destination</option>
              {destinations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.city ? ` · ${item.city}` : ""}
                </option>
              ))}
            </select>
          </label>
          {!destinations.length && (
            <p className="text-sm text-amber-700">
              No other active shop is available for transfer.
            </p>
          )}
          <label className="text-sm font-bold text-gray-700">
            Transfer reference (optional)
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="mt-1 w-full rounded-xl border p-3 font-normal"
            />
          </label>
          <label className="text-sm font-bold text-gray-700">
            Notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border p-3 font-normal"
            />
          </label>
        </div>
      )}
    </InventoryModal>
  );
}

function EndCountModal({
  row,
  movements,
  close,
  saved,
}: {
  row: InventoryRow;
  movements: any[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
  });
  const [step, setStep] = useState(1),
    [ending, setEnding] = useState(""),
    [notes, setNotes] = useState(""),
    [saving, setSaving] = useState(false);
  const physical = Number(ending),
    valid = Number.isInteger(physical) && physical >= 0;
  const net = movements
    .filter(
      (item) =>
        item.productId === row.assignment.productId &&
        item.variantId === row.balance.variantId &&
        new Date(item.createdAt).toLocaleDateString("en-CA", {
          timeZone: "Asia/Manila",
        }) === today,
    )
    .reduce((sum, item) => sum + Number(item.quantityChange), 0);
  const beginning = row.balance.quantity - net,
    variance = valid ? physical - row.balance.quantity : 0;
  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await inventoryApi.closeInventoryDay({
        productId: row.assignment.productId,
        variantId: row.balance.variantId,
        businessDate: today,
        endingBalance: physical,
        notes,
      });
      toast.success("End inventory count saved");
      await saved();
    } catch (error) {
      toast.error(message(error));
      setSaving(false);
    }
  };
  return (
    <InventoryModal
      title="End Inventory Count"
      subtitle={`${row.assignment.product.name} · ${variantName(row.assignment.product, row.balance.variantId)}`}
      close={close}
      saving={saving}
      steps={
        <>
          <Step
            number={1}
            label="Physical count"
            active={step === 1}
            complete={step > 1}
          />
          <div className="h-px flex-1 bg-gray-200" />
          <Step
            number={2}
            label="Reconciliation"
            active={step === 2}
            complete={false}
          />
        </>
      }
      footer={
        <>
          <button
            onClick={() => (step === 1 ? close() : setStep(1))}
            disabled={saving}
            className="rounded-xl border px-5 py-2.5 font-bold"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              disabled={!valid}
              className="rounded-xl bg-red-600 px-5 py-2.5 font-bold text-white disabled:opacity-40"
            >
              Review
            </button>
          ) : (
            <button
              onClick={() => void submit()}
              disabled={saving}
              className="rounded-xl bg-red-600 px-5 py-2.5 font-bold text-white"
            >
              {saving ? "Saving…" : "Save End Count"}
            </button>
          )}
        </>
      }
    >
      {step === 1 ? (
        <div>
          <label className="text-sm font-bold text-gray-700">
            Physical ending balance <span className="text-red-600">*</span>
            <input
              autoFocus
              type="number"
              min="0"
              step="1"
              value={ending}
              onChange={(e) => setEnding(e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-4 text-2xl font-bold"
            />
          </label>
          <p className="mt-3 text-sm text-gray-500">
            Count the actual stock remaining at the end of the business day.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <Info label="Business date" value={today} />
          <Info label="Beginning balance" value={beginning} />
          <Info label="Expected ending balance" value={row.balance.quantity} />
          <Info label="Physical ending balance" value={physical} />
          <Info
            label="Variance"
            value={
              <span
                className={variance === 0 ? "text-green-700" : "text-red-600"}
              >
                {variance > 0 ? "+" : ""}
                {variance}
              </span>
            }
          />
          <label className="mt-2 text-sm font-bold text-gray-700">
            Reconciliation notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border p-3 font-normal"
            />
          </label>
        </div>
      )}
    </InventoryModal>
  );
}

function InventoryModal({
  title,
  subtitle,
  close,
  saving,
  steps,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  close: () => void;
  saving: boolean;
  steps?: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={() => !saving && close()}
    >
      <section
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">{title}</h2>
              <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
            </div>
            <button
              onClick={close}
              disabled={saving}
              className="text-2xl text-gray-400"
            >
              ×
            </button>
          </div>
          {steps && <div className="mt-5 flex items-center gap-2">{steps}</div>}
        </header>
        <div className="p-6">{children}</div>
        <footer className="flex justify-between border-t p-6">{footer}</footer>
      </section>
    </div>
  );
}

function DailyCountTable({ counts }: { counts: any[] }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-xl font-bold">Daily Inventory Reconciliation</h2>
        <p className="text-sm text-gray-500">
          Beginning, expected, and physical ending balances for completed
          counts.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-gray-900 text-white">
            <tr>
              {[
                "Business Date",
                "Product",
                "Variant",
                "Beginning",
                "Expected Ending",
                "Physical Ending",
                "Variance",
              ].map((label) => (
                <th key={label} className="px-4 py-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {counts.map((count) => (
              <tr key={count.id}>
                <td className="px-4 py-3">
                  {new Date(count.businessDate).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 font-semibold">
                  {count.product?.name}
                </td>
                <td className="px-4 py-3">
                  {count.variant?.optionValues
                    ?.map((link: any) => link.optionValue.value)
                    .join(" / ") || "Standard"}
                </td>
                <td className="px-4 py-3">{count.beginningBalance}</td>
                <td className="px-4 py-3">{count.expectedEnding}</td>
                <td className="px-4 py-3 font-bold">{count.endingBalance}</td>
                <td
                  className={`px-4 py-3 font-bold ${count.variance === 0 ? "text-green-700" : "text-red-600"}`}
                >
                  {count.variance > 0 ? "+" : ""}
                  {count.variance}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Details({
  row,
  movements,
  close,
}: {
  row: InventoryRow;
  movements: any[];
  close: () => void;
}) {
  const last = (type: string) =>
    movements.find((item) => item.type === type)?.createdAt;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={close}
    >
      <aside
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-between">
          <h2 className="text-xl font-bold">Inventory Details</h2>
          <button onClick={close} className="text-2xl">
            ×
          </button>
        </div>
        <h3 className="mt-6 font-bold">Product Information</h3>
        <Info label="Product" value={row.assignment.product.name} />
        <Info
          label="Variant"
          value={variantName(row.assignment.product, row.balance.variantId)}
        />
        <Info
          label="Category"
          value={row.assignment.product.category?.name || "—"}
        />
        <Info
          label="SKU"
          value={variantSku(row.assignment.product, row.balance.variantId)}
        />
        <Info label="Unit" value={row.assignment.product.unit || "Piece"} />
        <h3 className="mt-6 font-bold">Inventory</h3>
        <Info label="On Hand" value={row.balance.quantity} />
        <Info label="Reserved" value={row.balance.reservedQuantity} />
        <Info label="Available" value={row.balance.availableQuantity} />
        <Info label="Reorder Level" value={row.balance.reorderLevel} />
        <h3 className="mt-6 font-bold">Movement Summary</h3>
        <Info label="Last Received" value={formatDate(last("receipt"))} />
        <Info label="Last Sold" value={formatDate(last("sale"))} />
        <Info label="Last Adjustment" value={formatDate(last("adjustment"))} />
        <h3 className="mt-6 mb-2 font-bold">Recent Movements</h3>
        {movements.slice(0, 10).map((item) => (
          <div key={item.id} className="border-t py-3 text-sm">
            <p className="font-semibold">
              {String(item.type).replaceAll("_", " ").toUpperCase()} ·{" "}
              {item.quantityChange > 0 ? "+" : ""}
              {item.quantityChange}
            </p>
            <p className="text-gray-500">
              {new Date(item.createdAt).toLocaleString()} · Balance{" "}
              {item.balanceAfter}
            </p>
          </div>
        ))}
      </aside>
    </div>
  );
}
function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mt-2 flex justify-between border-b pb-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
function variantName(product: Product, variantId?: number | null) {
  if (!variantId) return "Standard";
  const variant = product.variants?.find((item) => item.id === variantId);
  return (
    variant?.optionValues?.map((link) => link.optionValue.value).join(" / ") ||
    variant?.sku ||
    `Variant ${variantId}`
  );
}
function variantSku(product: Product, variantId?: number | null) {
  return variantId
    ? product.variants?.find((item) => item.id === variantId)?.sku || "—"
    : product.baseSku || "—";
}
function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : "—";
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "Inventory action failed";
}
