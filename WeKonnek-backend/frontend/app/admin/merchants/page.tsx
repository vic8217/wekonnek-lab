'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Merchant {
  id: number;
  name: string;
  email: string;
  phone: string;
  subscription_tier: string;
  status: string;
  created_at: string;
  suspension_reason?: string;
}

export default function MerchantManagementPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [showReinstateModal, setShowReinstateModal] = useState(false);

  useEffect(() => {
    fetchMerchants();
  }, [selectedStatus]);

  const fetchMerchants = async () => {
    try {
      const token = getToken();
      const params = selectedStatus !== 'all' ? `?status=${selectedStatus}` : '';
      const res = await fetch(`${API}/api/merchants${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch merchants');
      const data = await res.json();
      setMerchants(Array.isArray(data) ? data : data.data || []);
    } catch (error) {
      console.error('Error fetching merchants:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusCounts = async () => {
    const token = getToken();
    const res = await fetch(`${API}/api/merchants`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = res.ok ? await res.json() : [];
    const allMerchants = Array.isArray(data) ? data : data.data || [];

    const counts = {
      total: allMerchants.length,
      active: 0,
      suspended: 0,
      deactivated: 0,
    };

    allMerchants.forEach((merchant: any) => {
      if (merchant.status === 'active') counts.active++;
      if (merchant.status === 'suspended') counts.suspended++;
      if (merchant.status === 'deactivated') counts.deactivated++;
    });

    return counts;
  };

  const [statusCounts, setStatusCounts] = useState({
    total: 0,
    active: 0,
    suspended: 0,
    deactivated: 0,
  });

  useEffect(() => {
    const loadCounts = async () => {
      const counts = await getStatusCounts();
      setStatusCounts(counts);
    };
    loadCounts();
  }, []);

  const handleSuspend = (merchant: Merchant) => {
    setSelectedMerchant(merchant);
    setShowSuspendModal(true);
  };

  const handleReinstate = (merchant: Merchant) => {
    setSelectedMerchant(merchant);
    setShowReinstateModal(true);
  };

  const confirmSuspend = async (merchantId: number, actionType: string, duration: number, reason: string) => {
    try {
      const token = getToken();
      const updates: any = {
        status: actionType === 'deactivate' ? 'deactivated' : 'suspended',
        suspension_reason: reason,
      };

      if (actionType === 'suspend' && duration) {
        const suspendedUntil = new Date();
        suspendedUntil.setDate(suspendedUntil.getDate() + duration);
        updates.suspended_until = suspendedUntil.toISOString();
        updates.suspension_duration = duration;
      }

      const res = await fetch(`${API}/api/merchants/${merchantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to suspend merchant');

      setShowSuspendModal(false);
      fetchMerchants();
      const counts = await getStatusCounts();
      setStatusCounts(counts);
      toast.success(`Merchant ${actionType === 'deactivate' ? 'deactivated' : 'suspended'} successfully`);
    } catch (error) {
      console.error('Error suspending merchant:', error);
      toast.error('Failed to suspend merchant');
    }
  };

  const confirmReinstate = async (merchantId: number) => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/merchants/${merchantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          status: 'active',
          suspension_reason: null,
          suspended_until: null,
          suspension_duration: null,
        }),
      });
      if (!res.ok) throw new Error('Failed to reinstate merchant');

      setShowReinstateModal(false);
      fetchMerchants();
      const counts = await getStatusCounts();
      setStatusCounts(counts);
      toast.success('Merchant reinstated successfully');
    } catch (error) {
      console.error('Error reinstating merchant:', error);
      toast.error('Failed to reinstate merchant');
    }
  };

  const filteredMerchants = merchants.filter(merchant =>
    merchant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    merchant.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'suspended':
        return 'bg-yellow-100 text-yellow-800';
      case 'deactivated':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Merchant Management Overview */}
      <div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Merchant Management</h2>
        <p className="text-gray-600 mb-6">Suspend, deactivate, or reinstate merchants</p>

        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Merchants</p>
                <p className="text-3xl font-bold text-gray-900">{statusCounts.total}</p>
              </div>
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Active</p>
                <p className="text-3xl font-bold text-green-600">{statusCounts.active}</p>
              </div>
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Suspended</p>
                <p className="text-3xl font-bold text-yellow-600">{statusCounts.suspended}</p>
              </div>
              <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Deactivated</p>
                <p className="text-3xl font-bold text-red-600">{statusCounts.deactivated}</p>
              </div>
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Merchants Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-2xl font-bold text-gray-900">Merchants</h3>
              <p className="text-gray-600">Manage merchant accounts and compliance</p>
            </div>
            <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Audit Trail
            </button>
          </div>

          {/* Search and Filter */}
          <div className="mb-4">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Status Tabs */}
          <div className="flex space-x-2">
            {[
              { label: 'All', value: 'all', count: statusCounts.total },
              { label: 'Active', value: 'active', count: statusCounts.active },
              { label: 'Suspended', value: 'suspended', count: statusCounts.suspended },
              { label: 'Deactivated', value: 'deactivated', count: statusCounts.deactivated },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setSelectedStatus(tab.value)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedStatus === tab.value
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
        </div>

        {/* Merchants Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-red-600 text-white">
                <th className="px-6 py-4 text-left font-medium">Business Name</th>
                <th className="px-6 py-4 text-left font-medium">Contact</th>
                <th className="px-6 py-4 text-left font-medium">Tier</th>
                <th className="px-6 py-4 text-left font-medium">Joined Date</th>
                <th className="px-6 py-4 text-left font-medium">Status</th>
                <th className="px-6 py-4 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    Loading merchants...
                  </td>
                </tr>
              ) : filteredMerchants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    No merchants found
                  </td>
                </tr>
              ) : (
                filteredMerchants.map((merchant) => (
                  <tr key={merchant.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold">
                          {getInitials(merchant.name)}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{merchant.name}</p>
                          {merchant.suspension_reason && (
                            <p className="text-sm text-gray-500">{merchant.suspension_reason}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-gray-900">{merchant.email || 'N/A'}</p>
                        <p className="text-sm text-gray-500">{merchant.phone || 'N/A'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-medium text-gray-900 capitalize">{merchant.subscription_tier || 'N/A'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-gray-900">{formatDate(merchant.created_at)}</p>
                        <p className="text-sm text-gray-500">{formatTime(merchant.created_at)}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getStatusColor(merchant.status)}`}>
                        {merchant.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {merchant.status === 'active' ? (
                        <button
                          onClick={() => handleSuspend(merchant)}
                          className="px-4 py-2 bg-red-100 text-red-700 rounded-full hover:bg-red-200 transition-colors flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReinstate(merchant)}
                          className="px-4 py-2 bg-orange-100 text-orange-700 rounded-full hover:bg-orange-200 transition-colors flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Reinstate
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Suspend Modal */}
      {showSuspendModal && selectedMerchant && (
        <SuspendModal
          merchant={selectedMerchant}
          onClose={() => setShowSuspendModal(false)}
          onConfirm={confirmSuspend}
        />
      )}

      {/* Reinstate Modal */}
      {showReinstateModal && selectedMerchant && (
        <ReinstateModal
          merchant={selectedMerchant}
          onClose={() => setShowReinstateModal(false)}
          onConfirm={confirmReinstate}
        />
      )}
    </div>
  );
}

// Suspend Modal Component
function SuspendModal({
  merchant,
  onClose,
  onConfirm,
}: {
  merchant: Merchant;
  onClose: () => void;
  onConfirm: (id: number, actionType: string, duration: number, reason: string) => void;
}) {
  const [actionType, setActionType] = useState('suspend');
  const [duration, setDuration] = useState(7);
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">Suspend/Deactivate Merchant</h3>
          <p className="text-gray-600 mt-1">{merchant.name} will be hidden from the platform</p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Action Type</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="suspend">Temporary Suspension</option>
              <option value="deactivate">Permanent Deactivation</option>
            </select>
          </div>

          {actionType === 'suspend' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Duration</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value={7}>7 Days</option>
                <option value={14}>14 Days</option>
                <option value={30}>30 Days</option>
                <option value={60}>60 Days</option>
                <option value={90}>90 Days</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">Select reason</option>
              <option value="Non-payment">Non-payment</option>
              <option value="Policy Violation">Policy Violation</option>
              <option value="Fraudulent Listing">Fraudulent Listing</option>
              <option value="Customer Complaints">Customer Complaints</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start space-x-3">
            <svg className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-orange-800">
              Warning: The merchant will receive a notification and their store will be immediately hidden from all users
            </p>
          </div>

          <div className="flex justify-end space-x-4 pt-4">
            <button
              onClick={onClose}
              className="px-6 py-2 border-2 border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(merchant.id, actionType, duration, reason)}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
            >
              Suspend Merchant
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Reinstate Modal Component
function ReinstateModal({
  merchant,
  onClose,
  onConfirm,
}: {
  merchant: Merchant;
  onClose: () => void;
  onConfirm: (id: number) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">Reinstate Merchant</h3>
          <p className="text-gray-600 mt-1">{merchant.name} will be reactivated and visible to users</p>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-medium text-green-900 mb-2">This action will:</p>
                <ul className="list-disc list-inside text-sm text-green-800 space-y-1">
                  <li>Restore full platform visibility</li>
                  <li>Enable order placement</li>
                  <li>Show merchant in search and map results</li>
                  <li>Send reinstatement notification to merchant</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-4 pt-4">
            <button
              onClick={onClose}
              className="px-6 py-2 border-2 border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(merchant.id)}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
            >
              Reinstate Merchant
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
