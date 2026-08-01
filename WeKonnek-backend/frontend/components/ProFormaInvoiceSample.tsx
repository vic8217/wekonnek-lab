'use client';

type Props = {
  sellerName?: string;
  onClose: () => void;
};

const money = (value: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);

export default function ProFormaInvoiceSample({ sellerName = 'Sample Merchant', onClose }: Props) {
  const items = [
    { sku: 'MEAL-001', description: 'Burger Meal', quantity: 2, unit: 'pc', price: 150, discount: 0, tax: 'VAT 12%', total: 300 },
    { sku: 'DRINK-012', description: 'Iced Tea', quantity: 2, unit: 'cup', price: 45, discount: 10, tax: 'VAT 12%', total: 80 },
  ];
  const gross = 390;
  const discount = 10;
  const net = 380;
  const vatable = 339.29;
  const vat = 40.71;

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-3 sm:p-6">
      <div className="mx-auto w-full max-w-5xl rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <h2 className="font-bold text-gray-900">E-Invoice Pro-Forma Sample</h2>
            <p className="text-xs text-gray-500">Preview only · no invoice record will be created</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100">Close</button>
        </div>

        <article className="relative m-4 overflow-hidden border border-gray-300 bg-white p-5 text-gray-900 sm:m-8 sm:p-9">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 text-6xl font-black tracking-widest text-gray-100 sm:text-8xl">PRO-FORMA</span>
          </div>

          <div className="relative space-y-6">
            <div className="rounded-lg border-2 border-red-600 bg-red-50 px-4 py-2 text-center text-sm font-black uppercase tracking-wide text-red-700">
              Pro-Forma Sample — Not a valid invoice and not valid for tax claim
            </div>

            <header className="grid gap-5 border-b-2 border-gray-900 pb-5 md:grid-cols-[1.4fr_1fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-red-600">Seller Information</p>
                <h1 className="mt-2 text-2xl font-black">{sellerName}</h1>
                <p className="text-sm font-semibold">Trade Name: {sellerName} Shop</p>
                <div className="mt-2 space-y-0.5 text-xs text-gray-600">
                  <p>Registered Address: 123 Sample Street, Parañaque City, Metro Manila 1700</p>
                  <p>TIN: 123-456-789-000 · Branch Code: 001</p>
                  <p>Contact: +63 917 123 4567 · billing@example.com</p>
                </div>
              </div>
              <div className="md:text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-red-600">Sales Invoice</p>
                <p className="mt-2 font-mono text-lg font-black">SI-2026-000001</p>
                <div className="mt-2 space-y-0.5 text-xs text-gray-600">
                  <p>Date: 31 July 2026</p>
                  <p>Time: 11:50 AM (Asia/Manila)</p>
                  <p>Currency: PHP</p>
                  <p>Payment Terms: Due on receipt · Due Date: 31 July 2026</p>
                </div>
              </div>
            </header>

            <section className="grid gap-4 rounded-xl bg-gray-50 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Bill To / Buyer</p>
                <p className="mt-1 font-bold">ABC Business Solutions, Inc.</p>
                <p className="text-xs text-gray-600">Buyer TIN: 987-654-321-000</p>
                <p className="text-xs text-gray-600">456 Commerce Avenue, Makati City</p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Buyer Details</p>
                <p className="mt-1 text-sm">Business Style: ABC Solutions</p>
                <p className="text-xs text-gray-600">purchasing@abc.example · +63 917 987 6543</p>
                <p className="text-xs text-gray-600">Transaction: B2B · Tax Classification: VAT Registered</p>
              </div>
            </section>

            <section className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="bg-gray-900 text-white">
                  <tr>{['SKU', 'Description', 'Qty', 'Unit', 'Unit Price', 'Discount', 'Tax Type', 'Line Total'].map(label => <th key={label} className="px-3 py-2.5">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {items.map(item => (
                    <tr key={item.sku}>
                      <td className="px-3 py-3 font-mono">{item.sku}</td>
                      <td className="px-3 py-3 font-semibold">{item.description}</td>
                      <td className="px-3 py-3">{item.quantity}</td>
                      <td className="px-3 py-3">{item.unit}</td>
                      <td className="px-3 py-3">{money(item.price)}</td>
                      <td className="px-3 py-3">{money(item.discount)}</td>
                      <td className="px-3 py-3">{item.tax}</td>
                      <td className="px-3 py-3 font-bold">{money(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <div className="grid gap-5 md:grid-cols-2">
              <section className="rounded-xl border border-gray-200 p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Payment Information</p>
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-gray-500">Payment Method</dt><dd className="text-right font-semibold">GCash / QR Ph</dd>
                  <dt className="text-gray-500">Reference Number</dt><dd className="text-right font-mono">GC-123456789</dd>
                  <dt className="text-gray-500">Cash Tendered</dt><dd className="text-right">N/A</dd>
                  <dt className="text-gray-500">Change</dt><dd className="text-right">{money(0)}</dd>
                </dl>
              </section>
              <section className="rounded-xl border border-gray-200 p-4">
                <dl className="space-y-1.5 text-sm">
                  <TotalRow label="Gross Sales" value={money(gross)} />
                  <TotalRow label="Discount" value={`-${money(discount)}`} />
                  <TotalRow label="Net Sales" value={money(net)} />
                  <TotalRow label="VATable Sales" value={money(vatable)} />
                  <TotalRow label="VAT Amount (12%)" value={money(vat)} />
                  <TotalRow label="VAT-Exempt Sales" value={money(0)} />
                  <TotalRow label="Zero-Rated Sales" value={money(0)} />
                  <div className="mt-2 border-t-2 border-gray-900 pt-2"><TotalRow label="TOTAL AMOUNT DUE" value={money(380)} strong /></div>
                </dl>
              </section>
            </div>

            <section className="grid gap-5 border-t border-dashed border-gray-300 pt-5 md:grid-cols-[1fr_auto]">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">BIR &amp; Digital Security</p>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
                  <p>Permit Number: FP-012345678</p>
                  <p>BIR Accreditation: ACC-2026-000001</p>
                  <p>Unique Invoice ID: <span className="font-mono">0198-EINV-7A4F-0001</span></p>
                  <p>Timestamp: 2026-07-31T11:50:00+08:00</p>
                  <p>Digital Signature: VALID</p>
                  <p>Audit Trail: ENABLED</p>
                  <p className="sm:col-span-2">SHA-256: <span className="break-all font-mono">9c78e416c6b476f62142d8c405700c98291a96718e0d570c70550da40ae4f4ce</span></p>
                  <p className="sm:col-span-2">Tamper Detection: PASSED · Verification: https://verify.wekonnek.example/0198-EINV-7A4F-0001</p>
                </div>
              </div>
              <div className="flex flex-col items-center">
                <div className="grid h-28 w-28 grid-cols-8 gap-0.5 border-4 border-white bg-white p-1 shadow ring-1 ring-gray-300" aria-label="Sample BIR verification QR code">
                  {Array.from({ length: 64 }, (_, index) => (
                    <span key={index} className={`${((index * 7 + Math.floor(index / 8) * 3) % 5) < 2 ? 'bg-gray-950' : 'bg-white'}`} />
                  ))}
                </div>
                <p className="mt-2 text-[10px] font-semibold text-gray-500">BIR / Invoice Verification QR</p>
              </div>
            </section>

            <footer className="border-t border-gray-200 pt-4 text-center text-[10px] text-gray-500">
              Demonstration template for the WeKonnek e‑Invoice system. Blockchain/Merkle proof may be attached when enabled.
            </footer>
          </div>
        </article>
      </div>
    </div>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-4 ${strong ? 'text-base font-black' : ''}`}><dt>{label}</dt><dd className="font-semibold">{value}</dd></div>;
}
