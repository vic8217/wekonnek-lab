'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Address {
  id: string;
  label: 'home' | 'office' | 'other';
  address: string;
  isDefault: boolean;
}

const LABEL_CONFIG: Record<string, { emoji: string; name: string }> = {
  home: { emoji: '🏠', name: 'Home' },
  office: { emoji: '🏢', name: 'Office' },
  other: { emoji: '📍', name: 'Other' },
};

const MOCK_ADDRESSES: Address[] = [
  {
    id: '1',
    label: 'home',
    address: '123 Mango Avenue, Brgy. Kamputhaw, Cebu City, Cebu 6000',
    isDefault: true,
  },
  {
    id: '2',
    label: 'office',
    address: 'IT Park, Apas, Cebu City, Cebu 6000',
    isDefault: false,
  },
  {
    id: '3',
    label: 'other',
    address: 'SM City Cebu, North Reclamation Area, Cebu City',
    isDefault: false,
  },
];

export default function AddressesPage() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchAddresses();
  }, []);

  const fetchAddresses = async () => {
    try {
      const token = getToken();
      if (!token) throw new Error('No token');

      const res = await fetch(`${API}/api/addresses`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');

      const data = await res.json();
      const list = data.data || data;
      setAddresses(
        (Array.isArray(list) ? list : []).map((a: any) => ({
          id: a.id?.toString(),
          label: a.label || a.type || 'other',
          address: a.address || a.full_address || a.fullAddress || '',
          isDefault: a.is_default || a.isDefault || false,
        }))
      );
    } catch {
      setAddresses(MOCK_ADDRESSES);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this address?')) return;
    setDeleting(id);
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/addresses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
      setAddresses((prev) => prev.filter((a) => a.id !== id));
      toast.success('Address deleted');
    } catch {
      toast.error('Failed to delete address');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 relative min-h-[70vh]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-gray-900">My Addresses</h1>
      </div>

      {addresses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>
          <p className="text-gray-500 font-medium">No saved addresses</p>
          <p className="text-sm text-gray-400 mt-1">Add your first address to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.map((addr) => {
            const cfg = LABEL_CONFIG[addr.label] || LABEL_CONFIG.other;
            return (
              <div
                key={addr.id}
                className={`bg-white rounded-2xl shadow-sm border p-4 transition-all ${
                  addr.isDefault ? 'border-[#DB0002]/30 ring-1 ring-[#DB0002]/10' : 'border-gray-100'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-lg shrink-0 mt-0.5">
                    {cfg.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm text-gray-900">{cfg.name}</span>
                      {addr.isDefault && (
                        <span className="text-[10px] font-bold text-[#DB0002] bg-red-50 px-2 py-0.5 rounded-full">
                          DEFAULT
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 leading-relaxed">{addr.address}</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-50">
                  <Link
                    href={`/customer/address-picker?edit=${addr.id}`}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-[#DB0002] hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(addr.id)}
                    disabled={deleting === addr.id}
                    className="px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {deleting === addr.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* FAB */}
      <Link
        href="/customer/address-picker"
        className="fixed bottom-24 right-4 lg:bottom-8 lg:right-8 w-14 h-14 bg-[#DB0002] text-white rounded-full shadow-lg flex items-center justify-center hover:bg-red-700 transition-all hover:scale-105 active:scale-95"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </Link>
    </div>
  );
}
