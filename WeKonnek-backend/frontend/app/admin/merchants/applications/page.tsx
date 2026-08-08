'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const APPLICATIONS_API = '/api/backend/merchant-applications';

async function readJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : null;
}

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
  status: 'pending' | 'reviewing' | 'for_approval' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  merchant_code?: string;
  assignment_status?: 'assigned' | 'unassigned';
  assigned_coordinator_id?: string;
  contact_name?: string;
  category_name?: string;
  sub_category_name?: string;
  address?: string;
  city_municipality?: string;
  barangay?: string;
  council_district?: string;
  geographic_area?: string;
  latitude?: string | number;
  longitude?: string | number;
  business_description?: string;
  has_branches?: boolean | null;
  branch_count?: number | null;
  product_count?: number | null;
  source?: string;
  payment_proof_url?: string;
  business_permit_url?: string;
  dti_permit_url?: string;
  valid_id_url?: string;
  establishment_photo_url?: string;
  authorized_person_photo_url?: string;
  business_documents_urls?: string[];
  selected_add_ons?: Array<{
    id: string;
    name: string;
    amount: number | string;
    quantity: number;
    subtotal: number;
    billingUnit: string;
    amountBasis?: string | null;
  }>;
  total_fee?: number;
  reviewed_by_name?: string;
  temporary_password?: string;
  recovery_key?: string;
}

interface EligibleCoordinator {
  id: number;
  user_id: string;
  full_name: string;
  email: string;
  coordinator_code?: string;
  zone_name?: string;
}

export default function MerchantApplicationsPage() {
  const [applications, setApplications] = useState<MerchantApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<string>('reviewing');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<MerchantApplication | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [assignmentApplication, setAssignmentApplication] = useState<MerchantApplication | null>(null);
  const [eligibleCoordinators, setEligibleCoordinators] = useState<EligibleCoordinator[]>([]);
  const [coordinatorsLoading, setCoordinatorsLoading] = useState(false);
  const [assigningCoordinatorId, setAssigningCoordinatorId] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetchApplications();
  }, [selectedFilter]);

  const fetchApplications = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const token = getToken();
      const res = await fetch(APPLICATIONS_API, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data?.message || 'Merchant application service is unavailable. Please try again.');
      setApplications(Array.isArray(data) ? data : data?.data || []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load merchant applications.');
    } finally {
      setLoading(false);
    }
  };

  const statusCounts = applications.reduce((counts, app) => {
    if (app.status === 'pending' && app.assignment_status !== 'assigned') counts.pending++;
    if (app.status === 'for_approval') counts.reviewing++;
    if (app.status === 'approved') counts.approved++;
    counts.total++;
    return counts;
  }, { pending: 0, reviewing: 0, approved: 0, total: 0 });

  const handleView = (application: MerchantApplication) => {
    setSelectedApplication(application);
    setShowViewModal(true);
  };

  const openAssignment = async (application: MerchantApplication) => {
    setAssignmentApplication(application);
    setEligibleCoordinators([]);
    setCoordinatorsLoading(true);
    try {
      const res = await fetch(`${APPLICATIONS_API}/${application.id}/eligible-coordinators`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const body = await readJsonResponse(res);
      if (!res.ok) throw new Error(body?.message || 'Unable to find coordinators for this area');
      setEligibleCoordinators(Array.isArray(body) ? body : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to find coordinators for this area');
    } finally {
      setCoordinatorsLoading(false);
    }
  };

  const assignCoordinator = async (coordinator: EligibleCoordinator) => {
    if (!assignmentApplication) return;
    setAssigningCoordinatorId(coordinator.user_id);
    try {
      const res = await fetch(`${APPLICATIONS_API}/${assignmentApplication.id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ coordinator_user_id: coordinator.user_id }),
      });
      const body = await readJsonResponse(res);
      if (!res.ok) throw new Error(body?.message || 'Unable to assign coordinator');
      toast.success(`${assignmentApplication.business_name} assigned to ${coordinator.full_name}.`);
      setAssignmentApplication(null);
      setSelectedFilter('reviewing');
      await fetchApplications();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to assign coordinator');
    } finally {
      setAssigningCoordinatorId('');
    }
  };

  const handleStatusChange = async (id: number, newStatus: string, reason?: string) => {
    try {
      const token = getToken();
      const body: Record<string, string> = { status: newStatus };
      if (reason) body.reason = reason;
      const res = await fetch(`${APPLICATIONS_API}/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const updated = await readJsonResponse(res);
      if (!res.ok) throw new Error(updated?.message || 'Failed to update application status');

      toast.success(newStatus === 'approved' && updated?.merchant_code
        ? `Approved. Store ID: ${updated.merchant_code}`
        : `Application ${newStatus} successfully!`, { duration: 8000 });
      fetchApplications();
      setShowViewModal(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update application status');
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
      case 'for_approval':
        return 'bg-green-100 text-green-800';
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
    const belongsToTab = selectedFilter === 'pending'
      ? app.status === 'pending' && app.assignment_status !== 'assigned'
      : selectedFilter === 'reviewing'
        ? app.status === 'for_approval'
        : selectedFilter === 'approved'
          ? app.status === 'approved'
          : true;
    if (!belongsToTab) return false;
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
      {loadError && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{loadError}</span>
          <button type="button" onClick={fetchApplications} className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-bold text-red-700 shadow-sm">Retry</button>
        </div>
      )}

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
              <p className="text-sm text-gray-600 mb-1">For Approval</p>
              <p className="text-3xl font-bold text-gray-900">{statusCounts.reviewing}</p>
            </div>
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            onClick={() => setSelectedFilter('reviewing')}
            className={`px-4 py-2 font-medium transition-colors ${
              selectedFilter === 'reviewing'
                ? 'text-[#DB0002] border-b-2 border-[#DB0002]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            For Approval <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{statusCounts.reviewing}</span>
          </button>
          <button
            onClick={() => setSelectedFilter('approved')}
            className={`px-4 py-2 font-medium transition-colors ${
              selectedFilter === 'approved'
                ? 'text-[#DB0002] border-b-2 border-[#DB0002]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Approved <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{statusCounts.approved}</span>
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
                  <th className="px-6 py-3 text-left text-sm font-semibold">Classification</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Contact</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Plan</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Payment</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">{selectedFilter === 'approved' ? 'Approved' : 'Submitted'}</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Coordinator</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                      Loading applications...
                    </td>
                  </tr>
                ) : filteredApplications.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
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
                      <td className="px-6 py-4">
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">{app.category_name || 'Unclassified'}</div>
                          <div className="text-gray-500">{app.sub_category_name || 'No subcategory'}</div>
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
                          <div className="font-medium text-gray-900">₱{Number(app.total_fee ?? app.subscription_amount).toLocaleString()}</div>
                          {app.selected_add_ons?.length ? <div className="text-gray-500">{app.selected_add_ons.length} add-on{app.selected_add_ons.length === 1 ? '' : 's'}</div> : null}
                          <div className="text-gray-500">{app.payment_method || 'N/A'}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <div>{formatDate(selectedFilter === 'approved' && app.reviewed_at ? app.reviewed_at : app.submitted_at)}</div>
                        <div className="text-gray-500">{formatTime(selectedFilter === 'approved' && app.reviewed_at ? app.reviewed_at : app.submitted_at)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(app.status)}`}>
                          {app.status.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase())}
                        </span>
                      </td>
                      <td className="px-6 py-4">{selectedFilter === 'approved' ? <div className="text-sm"><p className="font-medium text-gray-900">{app.reviewed_by_name || 'Admin staff'}</p><p className="text-gray-500">Approved</p></div> : <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${app.assignment_status === 'assigned' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{app.assignment_status === 'assigned' ? 'Assigned' : 'Unassigned'}</span>}</td>
                      <td className="px-6 py-4">
                        {app.status === 'pending' && app.assignment_status !== 'assigned' ? (
                          <button onClick={() => openAssignment(app)} className="inline-flex items-center rounded-lg bg-[#165BB8] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#124A94]">Assign</button>
                        ) : (
                          <button onClick={() => handleView(app)} className="inline-flex items-center gap-2 rounded-lg bg-[#165BB8] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#124A94]">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            View
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
      </div>

      {assignmentApplication && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="assign-coordinator-title">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-gray-200 p-6">
              <div>
                <h3 id="assign-coordinator-title" className="text-xl font-bold text-gray-900">Assign merchant coordinator</h3>
                <p className="mt-1 text-sm text-gray-500">{assignmentApplication.business_name} · {[assignmentApplication.geographic_area || assignmentApplication.barangay, assignmentApplication.city_municipality].filter(Boolean).join(', ')}</p>
              </div>
              <button type="button" onClick={() => setAssignmentApplication(null)} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Close assignment modal">✕</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-6">
              {coordinatorsLoading ? (
                <p className="py-10 text-center text-sm text-gray-500">Finding coordinators assigned to this area…</p>
              ) : eligibleCoordinators.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">No approved coordinator is assigned to this merchant&apos;s city, district, and area.</div>
              ) : (
                <div className="space-y-3">
                  {eligibleCoordinators.map(coordinator => (
                    <div key={coordinator.user_id} className="flex items-center gap-4 rounded-xl border border-gray-200 p-4">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">{getInitials(coordinator.full_name)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900">{coordinator.full_name}</p>
                        <p className="truncate text-sm text-gray-500">{coordinator.email}</p>
                        <p className="mt-1 text-xs font-medium text-blue-700">{coordinator.zone_name || 'Assigned coverage zone'}{coordinator.coordinator_code ? ` · ${coordinator.coordinator_code}` : ''}</p>
                      </div>
                      <button type="button" disabled={Boolean(assigningCoordinatorId)} onClick={() => assignCoordinator(coordinator)} className="rounded-lg bg-[#165BB8] px-4 py-2 text-sm font-bold text-white hover:bg-[#124A94] disabled:opacity-60">
                        {assigningCoordinatorId === coordinator.user_id ? 'Assigning…' : 'Assign'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
                <section>
                  <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-blue-700">Business evaluation</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <ApplicationDetail label="Business name" value={selectedApplication.business_name} />
                    <ApplicationDetail label="Contact person" value={selectedApplication.contact_name} />
                    <ApplicationDetail label="Business category" value={selectedApplication.category_name} />
                    <ApplicationDetail label="Business subcategory" value={selectedApplication.sub_category_name} />
                    <ApplicationDetail label="Email" value={selectedApplication.email} />
                    <ApplicationDetail label="Phone" value={selectedApplication.phone} />
                    <ApplicationDetail label="Application source" value={selectedApplication.source?.replaceAll('_', ' ')} capitalize />
                    <ApplicationDetail label="Store address" value={selectedApplication.address} wide />
                    <ApplicationDetail label="City / Municipality" value={selectedApplication.city_municipality} />
                    <ApplicationDetail label="City council district" value={selectedApplication.council_district} />
                    <ApplicationDetail label="Geographic area" value={selectedApplication.geographic_area} />
                    {selectedApplication.barangay && <ApplicationDetail label="Legacy barangay" value={selectedApplication.barangay} />}
                    <ApplicationDetail label="Has branches" value={selectedApplication.has_branches === true ? 'Yes' : selectedApplication.has_branches === false ? 'No' : undefined} />
                    <ApplicationDetail label="Number of branches" value={selectedApplication.branch_count} />
                    <ApplicationDetail label={/food|restaurant|cafe|bakery/i.test(selectedApplication.category_name || '') ? 'Menu products / items' : 'Number of products'} value={selectedApplication.product_count} />
                    <ApplicationDetail label="Latitude" value={selectedApplication.latitude} />
                    <ApplicationDetail label="Longitude" value={selectedApplication.longitude} />
                    {selectedApplication.latitude && selectedApplication.longitude && <div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Map location</p><a href={`https://www.openstreetmap.org/?mlat=${selectedApplication.latitude}&mlon=${selectedApplication.longitude}#map=18/${selectedApplication.latitude}/${selectedApplication.longitude}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-bold text-blue-700 underline">Open submitted location</a></div>}
                  </div>
                  <div className="mt-3 rounded-xl bg-gray-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">About the business</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-800">{selectedApplication.business_description || 'No business description submitted.'}</p></div>
                </section>

                <section>
                  <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-blue-700">Subscription and payment</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <ApplicationDetail label="Subscription tier" value={selectedApplication.subscription_tier} capitalize />
                    <ApplicationDetail label="Subscription plan" value={selectedApplication.subscription_plan} capitalize />
                    <ApplicationDetail label="Plan fee" value={`₱${Number(selectedApplication.subscription_amount).toLocaleString()}`} />
                    <ApplicationDetail label="Total fee" value={`₱${Number(selectedApplication.total_fee ?? selectedApplication.subscription_amount).toLocaleString()}`} />
                    <ApplicationDetail label="Payment method" value={selectedApplication.payment_method} />
                    <ApplicationDetail label="Assignment" value={selectedApplication.assignment_status} capitalize />
                    {selectedApplication.merchant_code && <ApplicationDetail label="Store ID / Merchant code" value={selectedApplication.merchant_code} />}
                    {selectedApplication.reviewed_by_name && <ApplicationDetail label="Approved by" value={selectedApplication.reviewed_by_name} />}
                    {selectedApplication.reviewed_at && <ApplicationDetail label="Approved date and time" value={new Date(selectedApplication.reviewed_at).toLocaleString()} />}
                  </div>
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Selected add-ons</p>
                    {selectedApplication.selected_add_ons?.length ? <div className="grid gap-2 sm:grid-cols-2">{selectedApplication.selected_add_ons.map(addOn => {
                      const quantity = Number(addOn.quantity || 1);
                      const unitPrice = Number(addOn.amount);
                      const subtotal = Number(addOn.subtotal ?? unitPrice * quantity);
                      const itemLabel = addOn.amountBasis === 'keyword'
                        ? 'keywords'
                        : addOn.amountBasis === 'inventory'
                          ? 'products/items'
                          : 'units';
                      return <div key={addOn.id} className="rounded-xl border border-gray-200 px-4 py-3 text-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div><p className="font-bold text-gray-900">{addOn.name}</p><p className="text-xs text-gray-500">Per {addOn.billingUnit}{addOn.amountBasis ? ` · Per ${addOn.amountBasis === 'inventory' ? 'inventory item' : 'keyword'}` : ''}</p></div>
                          <span className="font-black text-gray-900">₱{subtotal.toLocaleString()}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-xs">
                          <span className="font-bold text-blue-800">{quantity.toLocaleString()} {itemLabel}</span>
                          <span className="text-blue-700">₱{unitPrice.toLocaleString()} × {quantity.toLocaleString()}</span>
                        </div>
                      </div>;
                    })}</div> : <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">No add-ons selected.</div>}
                  </div>
                </section>

                <ApplicationDocuments application={selectedApplication} />

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  {selectedApplication.status === 'pending' && (
                    <p className="text-sm text-amber-700">Waiting for coordinator review before admin approval.</p>
                  )}
                  {selectedApplication.status === 'reviewing' && (
                    <p className="text-sm text-blue-700">Coordinator review is in progress.</p>
                  )}
                  {selectedApplication.status === 'for_approval' && (
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

function ApplicationDetail({ label, value, wide = false, capitalize = false }: { label: string; value?: string | number | null; wide?: boolean; capitalize?: boolean }) {
  return <div className={`rounded-xl bg-gray-50 p-3 ${wide ? 'sm:col-span-2' : ''}`}>
    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
    <p className={`mt-1 break-words text-sm font-medium text-gray-900 ${capitalize ? 'capitalize' : ''}`}>{value === undefined || value === null || value === '' ? 'N/A' : value}</p>
  </div>;
}

function ApplicationDocuments({ application }: { application: MerchantApplication }) {
  const documents = [
    ['Payment proof', application.payment_proof_url],
    ['Business permit', application.business_permit_url],
    ['DTI permit', application.dti_permit_url],
    ['Valid ID', application.valid_id_url],
    ['Establishment photo', application.establishment_photo_url],
    ['Authorized person photo', application.authorized_person_photo_url],
    ...(application.business_documents_urls || []).map((url, index) => [`Business document ${index + 1}`, url]),
  ] as [string, string | undefined][];
  const submitted = documents.filter((item): item is [string, string] => Boolean(item[1]));
  return <section>
    <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-blue-700">Submitted documents</h4>
    {submitted.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{submitted.map(([label, url]) => <a key={`${label}-${url}`} href={url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-blue-700 hover:border-blue-300 hover:bg-blue-50"><span>{label}</span><span aria-hidden="true">↗</span></a>)}</div> : <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center text-sm text-gray-500">No documents were submitted with this application.</div>}
  </section>;
}
