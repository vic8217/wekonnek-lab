'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface QrTable {
  id: number;
  label: string;
  capacity: number;
  url: string;
  dataUrl: string;
}

interface QrResponse {
  merchant: { id: number; name: string; slug: string };
  tables: QrTable[];
}

export default function MerchantQrCodesPage() {
  const [data, setData] = useState<QrResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQrCodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      if (!token) {
        setError('You must be signed in as a merchant.');
        return;
      }

      const meRes = await fetch(`${API}/api/merchants/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!meRes.ok) throw new Error('Could not load your merchant profile');
      const merchant = await meRes.json();
      if (!merchant?.id) throw new Error('No merchant profile found');

      const baseUrl = window.location.origin;
      const res = await fetch(
        `${API}/api/merchants/${merchant.id}/floor-tables/qr?baseUrl=${encodeURIComponent(baseUrl)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error('Failed to generate QR codes');
      const body: QrResponse = await res.json();
      setData(body);
    } catch (err: any) {
      console.error('Error generating QR codes:', err);
      setError(err.message || 'Failed to generate QR codes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQrCodes();
  }, [fetchQrCodes]);

  const downloadQr = (table: QrTable) => {
    const a = document.createElement('a');
    a.href = table.dataUrl;
    a.download = `${(data?.merchant.slug || 'table')}-${table.label.replace(/\s+/g, '-').toLowerCase()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const printAll = () => {
    if (!data || data.tables.length === 0) return;
    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) {
      toast.error('Please allow pop-ups to print QR codes');
      return;
    }
    const cards = data.tables
      .map(
        (t) => `
        <div class="card">
          <div class="store">${escapeHtml(data.merchant.name)}</div>
          <img src="${t.dataUrl}" alt="${escapeHtml(t.label)}" />
          <div class="label">${escapeHtml(t.label)}</div>
          <div class="hint">Scan to view the menu &amp; order</div>
        </div>`,
      )
      .join('');
    win.document.write(`
      <!doctype html>
      <html>
      <head>
        <title>Table QR Codes — ${escapeHtml(data.merchant.name)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; }
          .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
          .card { border: 2px dashed #d1d5db; border-radius: 16px; padding: 20px; text-align: center; page-break-inside: avoid; }
          .card img { width: 100%; max-width: 260px; height: auto; }
          .store { font-size: 14px; font-weight: 700; color: #DB0002; margin-bottom: 8px; }
          .label { font-size: 22px; font-weight: 800; margin-top: 8px; }
          .hint { font-size: 12px; color: #6b7280; margin-top: 4px; }
          @media print { .card { border-color: #9ca3af; } }
        </style>
      </head>
      <body>
        <div class="grid">${cards}</div>
        <script>window.onload = function () { window.print(); };</script>
      </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Table QR Codes</h1>
          <p className="text-gray-600 text-sm mt-1">
            Print a QR code for each table. Customers scan it to open your menu and order —
            the order lands in your In-Store Orders tagged to that table.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchQrCodes}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={printAll}
            disabled={!data || data.tables.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print All
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          {error}
        </div>
      ) : !data || data.tables.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
          <span className="text-4xl mb-3 block">🍽️</span>
          <p className="text-gray-700 font-semibold">No active tables yet</p>
          <p className="text-gray-500 text-sm mt-1">
            Add tables in your In-Store Orders floor plan, then come back to print their QR codes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.tables.map((table) => (
            <div
              key={table.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col items-center text-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={table.dataUrl}
                alt={`QR code for ${table.label}`}
                className="w-40 h-40 object-contain"
              />
              <h3 className="mt-3 text-base font-bold text-gray-900">{table.label}</h3>
              <p className="text-xs text-gray-400">{table.capacity} seats</p>
              <button
                onClick={() => downloadQr(table)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download PNG
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
