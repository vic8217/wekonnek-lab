'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface MerchantApplication {
  id: number;
  user_id: string;
  business_name: string;
  email: string;
  phone: string;
  subscription_tier: string;
  subscription_plan: string;
  subscription_amount: number;
  payment_method: string;
  status: 'pending' | 'reviewing' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
}

export default function MerchantApplicationsPage() {
  const [applications, setApplications] = useState<MerchantApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<string>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<MerchantApplication | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);

  useEffect(() => {
    fetchApplications();
  }, [selectedFilter]);

  const fetchApplications = async () => {
    try {
      setLoading(true);
      const token = getToken();
      const params = selectedFilter !== 'all' ? `?status=${selectedFilter}` : '';
      const res = await fetch(`${API}/api/merchant-applications${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch applications');
      const data = await res.json();
      setApplications(Array.isArray(data) ? data : data.data || []);
    } catch (error) {
      console.error('Error fetching applications:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusCounts = async () => {
    const token = getToken();
    const res = await fetch(`${API}/api/merchant-applications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = res.ok ? await res.json() : [];
    const allApps = Array.isArray(data) ? data : data.data || [];

    const counts = {
      pending: 0,
      reviewing: 0,
      approved: 0,
      total: allApps.length,
    };

    allApps.forEach((app: any) => {
      if (app.status === 'pending') counts.pending++;
      if (app.status === 'reviewing') counts.reviewing++;
      if (app.status === 'approved') counts.approved++;
    });

    return counts;
  };

  const [statusCounts, setStatusCounts] = useState({
    pending: 0,
    reviewing: 0,
    approved: 0,
    total: 0,
  });

  useEffect(() => {
    const loadCounts = async () => {
      const counts = await getStatusCounts();
      setStatusCounts(counts);
    };
    loadCounts();
  }, []);

  const handleView = (application: MerchantApplication) => {
    setSelectedApplication(application);
    setShowViewModal(true);
  };

  const handleStatusChange = async (id: number, newStatus: string, reason?: string) => {
    try {
      const token = getToken();
      const body: Record<string, string> = { status: newStatus };
      if (reason) body.reason = reason;
      const res = await fetch(`${API}/api/merchant-applications/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update application status');

      toast.success(`Application ${newStatus} successfully!`);
      fetchApplications();
      const counts = await getStatusCounts();
      setStatusCounts(counts);
      setShowViewModal(false);
    } catch (error: any) {
      console.error('Error updating status:', error);
      toast.error(error.message || 'Failed to update application status');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'reviewing':
        return 'bg-blue-100 text-blue-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const filteredApplications = applications.filter((app) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        app.business_name.toLowerCase().includes(query) ||
        app.email.toLowerCase().includes(query) ||
        app.phone.includes(query)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Verification Portal</h1>
        <p className="text-gray-600">Review and approve merchant subscriptions</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Pending Review</p>
              <p className="text-3xl font-bold text-gray-900">{statusCounts.pending}</p>
            </div>
            <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Reviewing</p>
              <p className="text-3xl font-bold text-gray-900">{statusCounts.reviewing}</p>
            </div>
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Approved</p>
              <p className="text-3xl font-bold text-gray-900">{statusCounts.approved}</p>
            </div>
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        </div>

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
      </div>

      {/* Merchants Applications Section */}
      <div>
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Merchants Applications</h2>
          <p className="text-gray-600">Review business documents and payment verification</p>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-4 border-b border-gray-200">
          <button
            onClick={() => setSelectedFilter('pending')}
            className={`px-4 py-2 font-medium transition-colors ${
              selectedFilter === 'pending'
                ? 'text-[#DB0002] border-b-2 border-[#DB0002]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setSelectedFilter('reviewing')}
            className={`px-4 py-2 font-medium transition-colors ${
              selectedFilter === 'reviewing'
                ? 'text-[#DB0002] border-b-2 border-[#DB0002]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Reviewing
          </button>
          <button
            onClick={() => setSelectedFilter('approved')}
            className={`px-4 py-2 font-medium transition-colors ${
              selectedFilter === 'approved'
                ? 'text-[#DB0002] border-b-2 border-[#DB0002]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Approved
          </button>
          <button
            onClick={() => setSelectedFilter('all')}
            className={`px-4 py-2 font-medium transition-colors ${
              selectedFilter === 'all'
                ? 'text-[#DB0002] border-b-2 border-[#DB0002]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            All
          </button>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
            />
          </div>
        </div>

        {/* Applications Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#DB0002] text-white">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Business</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Contact</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Plan</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Payment</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Submitted</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      Loading applications...
                    </td>
                  </tr>
                ) : filteredApplications.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      No applications found
                    </td>
                  </tr>
                ) : (
                  filteredApplications.map((app) => (
                    <tr key={app.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                            <span className="text-blue-600 font-semibold text-sm">
                              {getInitials(app.business_name)}
                            </span>
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{app.business_name}</div>
                            <div className="text-sm text-gray-500">{app.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{app.phone || 'N/A'}</td>
                      <td className="px-6 py-4">
                        <div className="text-sm">
                          <div className="font-medium text-gray-900 capitalize">{app.subscription_tier}</div>
                          <div className="text-gray-500 capitalize">{app.subscription_plan}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">₱{app.subscription_amount.toLocaleString()}</div>
                          <div className="text-gray-500">{app.payment_method || 'N/A'}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <div>{formatDate(app.submitted_at)}</div>
                        <div className="text-gray-500">{formatTime(app.submitted_at)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(app.status)}`}>
                          {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleView(app)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-[#165BB8] text-white rounded-lg hover:bg-[#124A94] transition-colors text-sm font-medium"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* View Application Modal */}
      {showViewModal && selectedApplication && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-gray-900">{selectedApplication.business_name}</h3>
                <button
                  onClick={() => setShowViewModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6">
                {/* Application Details */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <p className="text-gray-900">{selectedApplication.email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <p className="text-gray-900">{selectedApplication.phone || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subscription Tier</label>
                    <p className="text-gray-900 capitalize">{selectedApplication.subscription_tier}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subscription Plan</label>
                    <p className="text-gray-900 capitalize">{selectedApplication.subscription_plan}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment Amount</label>
                    <p className="text-gray-900">₱{selectedApplication.subscription_amount.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                    <p className="text-gray-900">{selectedApplication.payment_method || 'N/A'}</p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  {selectedApplication.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleStatusChange(selectedApplication.id, 'reviewing')}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                      >
                        Mark as Reviewing
                      </button>
                      <button
                        onClick={() => handleStatusChange(selectedApplication.id, 'approved')}
                        className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                      >
                        Approve
                      </button>
                    </>
                  )}
                  {selectedApplication.status === 'reviewing' && (
                    <>
                      <button
                        onClick={() => handleStatusChange(selectedApplication.id, 'approved')}
                        className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          const reason = prompt('Enter rejection reason:');
                          if (reason) {
                            handleStatusChange(selectedApplication.id, 'rejected', reason);
                          }
                        }}
                        className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
