'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';
import { Calculator, Check, ChevronLeft, ChevronRight, Copy, Eye, FileText, Mail, Pause, Phone, Play, Search, Store, UserPlus, WalletCards, X } from 'lucide-react';
import { publicAssetUrl } from '@/lib/public-asset-url';

const API = '/api/backend';

interface Merchant {
  id: number;
  name: string;
  email: string;
  phone: string;
  subscription_tier: string;
  status: string;
  created_at: string;
  suspension_reason?: string;
  merchant_code?: string;
  temporary_password?: string;
  recovery_key?: string;
  total_fee?: number;
  total_subscription_fee?: number;
  wallet_balance?: number;
  ledger_unpaid?: number;
  logo_url?: string;
  category?: { name?: string } | null;
  subCategory?: { name?: string } | null;
  commerceDomain?: 'FOOD' | 'NON_FOOD' | 'MIXED' | null;
}

interface MerchantDetails extends Merchant {
  description?: string;
  business_type?: string;
  address?: string;
  city?: string;
  region?: string;
  council_district?: string;
  geographic_area?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  website?: string;
  latitude?: string | number;
  longitude?: string | number;
  subCategory?: { name?: string } | null;
  subscription_plan?: string;
  subscription_status?: string;
  fee_breakdown: {
    plan: { name: string; amount: number; billing_unit: string };
    add_ons: Array<{ id: string; name: string; amount: number; quantity?: number; subtotal?: number; billing_unit: string; amount_basis?: string | null }>;
    add_on_fee: number;
    total_fee: number;
  };
}

interface MerchantLedger {
  merchant: { id: number; name: string; merchant_code?: string };
  fee_breakdown: MerchantDetails['fee_breakdown'];
  balance: { total_billed: number; total_paid: number; unpaid: number };
  payments: Array<{ id: number; tier: string; plan: string; amount: number; payment_method: string; gateway?: string; status: string; payment_ref?: string; period_start?: string; period_end?: string; created_at: string }>;
}

interface MerchantApplication {
  id: number; business_name: string; contact_name?: string; email: string; phone: string;
  category_name?: string; sub_category_name?: string; address?: string; city_municipality?: string;
  barangay?: string; council_district?: string; geographic_area?: string; latitude?: string | number;
  longitude?: string | number; business_description?: string; has_branches?: boolean | null;
  branch_count?: number | null; product_count?: number | null; source?: string;
  subscription_tier: string; subscription_plan: string; subscription_amount: number;
  payment_method: string; status: string; submitted_at: string; assignment_status?: string;
  payment_proof_url?: string; business_permit_url?: string; dti_permit_url?: string;
  valid_id_url?: string; establishment_photo_url?: string; authorized_person_photo_url?: string;
  business_documents_urls?: string[]; total_fee?: number;
  coordinator_notes?: string;
  assigned_at?: string;
  onboarding_coordinator?: { user_id?: string; full_name: string; email: string; mobile_number: string; coordinator_code?: string | null; zone_name?: string | null } | null;
  selected_add_ons?: Array<{ id: string; name: string; amount: number | string; quantity: number; subtotal: number; billingUnit: string; amountBasis?: string | null }>;
}

export default function MerchantManagementPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [showReinstateModal, setShowReinstateModal] = useState(false);
  const [details, setDetails] = useState<MerchantDetails | null>(null);
  const [ledger, setLedger] = useState<MerchantLedger | null>(null);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [generatingRecoveryKey, setGeneratingRecoveryKey] = useState(false);
  const [commerceDomainSaving, setCommerceDomainSaving] = useState(false);
  const [creditMerchant, setCreditMerchant] = useState<Merchant | null>(null);
  const [creditAmount, setCreditAmount] = useState('500');
  const [creditingWallet, setCreditingWallet] = useState(false);
  const [approvalApplications, setApprovalApplications] = useState<MerchantApplication[]>([]);
  const [selectedApplication, setSelectedApplication] = useState<MerchantApplication | null>(null);
  const [applicationModalOpen, setApplicationModalOpen] = useState(false);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationActionLoading, setApplicationActionLoading] = useState(false);

  const fetchApprovalApplications = async () => {
    try {
      const response = await fetch(`${API}/merchant-applications`, { headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || 'Unable to load merchant applications');
      const all = (Array.isArray(body) ? body : body?.data || []) as MerchantApplication[];
      const approvals = all.filter(application => application.status === 'for_approval');
      setApprovalApplications(approvals);
      setSelectedApplication(current => approvals.find(application => application.id === current?.id) || approvals[0] || null);
    } catch (error) {
      console.error('Unable to load applications for approval:', error);
    }
  };

  const fetchMerchants = async () => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/merchants/admin`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
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

  useEffect(() => {
    void fetchMerchants();
    const refresh = () => void fetchMerchants();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    void fetchApprovalApplications();
    const interval = window.setInterval(() => void fetchApprovalApplications(), 15000);
    return () => window.clearInterval(interval);
  }, []);

  const openApplications = async () => {
    setApplicationModalOpen(true);
    setApplicationsLoading(true);
    await fetchApprovalApplications();
    setApplicationsLoading(false);
  };

  const updateApplicationStatus = async (application: MerchantApplication, status: 'approved' | 'rejected', reason?: string) => {
    setApplicationActionLoading(true);
    try {
      const response = await fetch(`${API}/merchant-applications/${application.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || 'Unable to update merchant application');
      toast.success(status === 'approved' ? `Approved ${application.business_name}${body?.merchant_code ? `. Store ID: ${body.merchant_code}` : ''}` : `Rejected ${application.business_name}`);
      await Promise.all([fetchApprovalApplications(), fetchMerchants()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update merchant application');
    } finally {
      setApplicationActionLoading(false);
    }
  };

  const handleSuspend = (merchant: Merchant) => {
    setSelectedMerchant(merchant);
    setShowSuspendModal(true);
  };

  const handleReinstate = (merchant: Merchant) => {
    setSelectedMerchant(merchant);
    setShowReinstateModal(true);
  };

  const openDetails = async (merchant: Merchant) => {
    setDialogLoading(true);
    try {
      const response = await fetch(`${API}/merchants/admin/${merchant.id}/details`, { headers: { Authorization: `Bearer ${getToken()}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to load merchant details');
      setDetails({ ...merchant, ...body, category: body.category || merchant.category });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load merchant details');
    } finally {
      setDialogLoading(false);
    }
  };

  const openLedger = async (merchant: Merchant) => {
    setDialogLoading(true);
    try {
      const response = await fetch(`${API}/merchants/admin/${merchant.id}/ledger`, { headers: { Authorization: `Bearer ${getToken()}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to load subscription ledger');
      setLedger(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load subscription ledger');
    } finally {
      setDialogLoading(false);
    }
  };

  const generateRecoveryKey = async () => {
    if (!details) return;
    setGeneratingRecoveryKey(true);
    try {
      const response = await fetch(`${API}/merchants/admin/${details.id}/recovery-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to generate recovery key');
      setDetails(current => current ? { ...current, recovery_key: body.recovery_key } : current);
      toast.success('A new recovery key was generated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to generate recovery key');
    } finally {
      setGeneratingRecoveryKey(false);
    }
  };

  const saveCommerceDomain = async (commerceDomain: Merchant['commerceDomain']) => {
    if (!details) return;
    setCommerceDomainSaving(true);
    try {
      const response = await fetch(`${API}/merchants/admin/${details.id}/commerce-domain`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ commerceDomain }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || 'Unable to save commerce domain');
      setDetails(current => current ? { ...current, commerceDomain: body.commerceDomain } : current);
      setMerchants(current => current.map(merchant => merchant.id === details.id ? { ...merchant, commerceDomain: body.commerceDomain } : merchant));
      toast.success('Commerce domain saved');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save commerce domain'); }
    finally { setCommerceDomainSaving(false); }
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

      const res = await fetch(`${API}/merchants/${merchantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to suspend merchant');

      setShowSuspendModal(false);
      fetchMerchants();
      toast.success(`Merchant ${actionType === 'deactivate' ? 'deactivated' : 'suspended'} successfully`);
    } catch (error) {
      console.error('Error suspending merchant:', error);
      toast.error('Failed to suspend merchant');
    }
  };

  const confirmReinstate = async (merchantId: number) => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/merchants/${merchantId}`, {
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
      toast.success('Merchant reinstated successfully');
    } catch (error) {
      console.error('Error reinstating merchant:', error);
      toast.error('Failed to reinstate merchant');
    }
  };

  const addDemoWalletCredit = async () => {
    if (!creditMerchant) return;
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount < 50 || amount > 50000) {
      toast.error('Enter an amount from ₱50 to ₱50,000.');
      return;
    }
    setCreditingWallet(true);
    try {
      const response = await fetch(`${API}/merchants/admin/${creditMerchant.id}/demo-wallet-credit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ amount }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to add demo wallet credit');
      toast.success(`₱${amount.toLocaleString()} added to ${creditMerchant.name}.`);
      setCreditMerchant(null);
      setCreditAmount('500');
      await fetchMerchants();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to add demo wallet credit');
    } finally {
      setCreditingWallet(false);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredMerchants = merchants.filter(merchant => !normalizedQuery ||
    merchant.name.toLowerCase().includes(normalizedQuery) ||
    merchant.email?.toLowerCase().includes(normalizedQuery) ||
    merchant.phone?.toLowerCase().includes(normalizedQuery) ||
    merchant.merchant_code?.toLowerCase().includes(normalizedQuery)
  );
  const totalPages = Math.max(1, Math.ceil(filteredMerchants.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * rowsPerPage;
  const visibleMerchants = filteredMerchants.slice(pageStart, pageStart + rowsPerPage);
  const summary = merchants.reduce((result, merchant) => {
    result.wallet += Number(merchant.wallet_balance || 0);
    result.fees += Number(merchant.total_subscription_fee ?? merchant.total_fee ?? 0);
    if (merchant.status === 'active') result.active += 1;
    else if (merchant.status === 'suspended') result.suspended += 1;
    else result.pending += 1;
    return result;
  }, { active: 0, suspended: 0, pending: 0, wallet: 0, fees: 0 });

  useEffect(() => setPage(1), [searchQuery, rowsPerPage]);

  const copyStoreId = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode(current => current === code ? null : current), 1600);
    } catch {
      toast.error('Unable to copy Store ID.');
    }
  };

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
    <div className="w-full space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center">
        <div className="flex min-w-[280px] items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-xl border border-gray-200 bg-white text-[#e60012] shadow-sm"><Store size={29} strokeWidth={2.2} /></div>
          <div><h1 className="text-3xl font-black text-[#101a33]">Merchants</h1><p className="text-sm text-slate-500">Manage merchant subscriptions and accounts</p></div>
        </div>
        <label className="relative min-w-0 flex-1 xl:mx-6"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} /><span className="sr-only">Search merchants</span><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search business name, contact, email..." className="h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label>
        <button type="button" onClick={openApplications} className="relative inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#e60012] px-6 font-bold text-white shadow-lg shadow-red-200 transition hover:bg-red-700"><UserPlus size={20} />Onboard Merchants{approvalApplications.length > 0 && <span className="absolute -right-2 -top-2 flex min-w-7 items-center justify-center rounded-full border-2 border-white bg-amber-400 px-1.5 py-0.5 text-xs font-black text-slate-950 shadow">{approvalApplications.length > 99 ? '99+' : approvalApplications.length}</span>}</button>
      </header>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] table-auto">
            <thead className="bg-[#e60012] text-white"><tr>
              <th className="w-14 px-5 py-5"><input type="checkbox" aria-label="Select visible merchants" checked={visibleMerchants.length > 0 && visibleMerchants.every(item => selectedIds.includes(item.id))} onChange={event => setSelectedIds(event.target.checked ? [...new Set([...selectedIds, ...visibleMerchants.map(item => item.id)])] : selectedIds.filter(id => !visibleMerchants.some(item => item.id === id)))} className="size-4 accent-white" /></th>
              {['Business Name', 'Contact', 'Store ID', 'Total Subscription Fee', 'Wallet Balance', 'Status', 'Action'].map(label => <th key={label} className="whitespace-nowrap px-4 py-5 text-left text-sm font-bold">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? <tr><td colSpan={8} className="p-12 text-center text-slate-500">Loading merchants...</td></tr> : visibleMerchants.length === 0 ? <tr><td colSpan={8} className="p-12 text-center text-slate-500">No merchants found</td></tr> : visibleMerchants.map(merchant => (
                <tr key={merchant.id} className="transition hover:bg-slate-50/70">
                  <td className="px-5 py-5"><input type="checkbox" aria-label={`Select ${merchant.name}`} checked={selectedIds.includes(merchant.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, merchant.id] : current.filter(id => id !== merchant.id))} className="size-4 accent-[#e60012]" /></td>
                  <td className="px-4 py-5"><div className="flex min-w-[210px] items-center gap-3">{merchant.logo_url ? <img src={merchant.logo_url} alt="" className="size-12 rounded-full object-cover ring-1 ring-slate-200" /> : <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-100 font-black text-blue-600">{getInitials(merchant.name)}</div>}<div><p className="font-bold text-[#101a33]">{merchant.name}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Store size={14} />{merchant.category?.name || 'Category unavailable'}</p></div></div></td>
                  <td className="px-4 py-5"><div className="min-w-[210px] space-y-1.5 text-sm"><p className="flex items-center gap-2 text-slate-700"><Mail size={15} className="text-slate-400" />{merchant.email || 'N/A'}</p><p className="flex items-center gap-2 text-slate-500"><Phone size={15} />{merchant.phone || 'N/A'}</p></div></td>
                  <td className="px-4 py-5"><div className="flex min-w-[145px] items-center gap-2 font-mono text-sm text-slate-800">{merchant.merchant_code || 'N/A'}{merchant.merchant_code && <button type="button" onClick={() => copyStoreId(merchant.merchant_code!)} title="Copy Store ID" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600">{copiedCode === merchant.merchant_code ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}</button>}</div>{copiedCode === merchant.merchant_code && <span className="text-xs font-medium text-emerald-600">Copied</span>}</td>
                  <td className="px-4 py-5 font-semibold text-slate-800">₱{Number(merchant.total_subscription_fee ?? merchant.total_fee ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-5"><p className="font-black text-[#e60012]">₱{Number(merchant.wallet_balance || 0).toLocaleString()}</p><p className="mt-1 text-xs text-slate-500">Available balance</p></td>
                  <td className="px-4 py-5"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold capitalize ${getStatusColor(merchant.status)}`}>{merchant.status}</span></td>
                  <td className="px-4 py-5"><div className="flex flex-nowrap gap-2">
                    <ActionButton label="View Merchant" className="border-blue-200 text-blue-600 hover:bg-blue-50" onClick={() => openDetails(merchant)} disabled={dialogLoading}><Eye size={19} /></ActionButton>
                    <ActionButton label="View Ledger" className="border-slate-200 text-slate-600 hover:bg-slate-100" onClick={() => openLedger(merchant)} disabled={dialogLoading}><Calculator size={19} /></ActionButton>
                    <ActionButton label="Manage Wallet" className="border-emerald-200 text-emerald-600 hover:bg-emerald-50" onClick={() => setCreditMerchant(merchant)}><WalletCards size={19} /></ActionButton>
                    {merchant.status === 'active' ? <ActionButton label="Suspend Merchant" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => handleSuspend(merchant)}><Pause size={19} /></ActionButton> : <ActionButton label="Reactivate Merchant" className="border-amber-200 text-amber-600 hover:bg-amber-50" onClick={() => handleReinstate(merchant)}><Play size={19} /></ActionButton>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-col gap-4 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-600">{filteredMerchants.length ? `Showing ${pageStart + 1} to ${Math.min(pageStart + rowsPerPage, filteredMerchants.length)} of ${filteredMerchants.length} merchants` : 'Showing 0 merchants'}</p>
          <div className="flex items-center gap-3"><button aria-label="Previous page" disabled={safePage === 1} onClick={() => setPage(current => Math.max(1, current - 1))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={18} /></button><span className="flex size-10 items-center justify-center rounded-lg bg-[#e60012] font-bold text-white">{safePage}</span><button aria-label="Next page" disabled={safePage === totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={18} /></button><label className="ml-2 flex items-center gap-2 text-slate-500">Rows per page:<select value={rowsPerPage} onChange={event => setRowsPerPage(Number(event.target.value))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800 outline-none">{[5, 10, 20, 50].map(value => <option key={value}>{value}</option>)}</select></label></div>
        </footer>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard icon={<Store />} color="blue" value={merchants.length} label="Total Merchants" /><SummaryCard icon={<span className="size-4 rounded-full bg-emerald-500" />} color="green" value={summary.active} label="Active Merchants" /><SummaryCard icon={<span className="size-4 rounded-full bg-amber-500" />} color="amber" value={summary.suspended} label="Suspended Merchants" /><SummaryCard icon={<span className="size-4 rounded-full bg-red-500" />} color="red" value={summary.pending} label="Pending Merchants" /><SummaryCard icon={<WalletCards />} color="orange" value={`₱${summary.wallet.toLocaleString()}`} label="Total Wallet Balance" /><SummaryCard icon={<Calculator />} color="purple" value={`₱${summary.fees.toLocaleString()}`} label="Total Subscription Fees" />
      </section>

      {applicationModalOpen && <MerchantApplicationApprovalModal applications={approvalApplications} selected={selectedApplication} loading={applicationsLoading} actionLoading={applicationActionLoading} onSelect={setSelectedApplication} onClose={() => setApplicationModalOpen(false)} onApprove={application => updateApplicationStatus(application, 'approved')} onReject={application => { const reason = window.prompt('Enter rejection reason:'); if (reason?.trim()) void updateApplicationStatus(application, 'rejected', reason.trim()); }} />}

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
      {details && <MerchantDetailsModal details={details} generatingRecoveryKey={generatingRecoveryKey} commerceDomainSaving={commerceDomainSaving} onGenerateRecoveryKey={generateRecoveryKey} onSaveCommerceDomain={saveCommerceDomain} onClose={() => setDetails(null)} />}
      {ledger && <MerchantLedgerModal ledger={ledger} onClose={() => setLedger(null)} />}
      {creditMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-gray-200 p-6">
              <div><h3 className="text-xl font-black text-gray-900">Add demo wallet balance</h3><p className="mt-1 text-sm text-gray-500">{creditMerchant.name}</p></div>
              <button onClick={() => setCreditMerchant(null)} disabled={creditingWallet} className="p-2 text-gray-500" aria-label="Close">✕</button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Demo-period credit only. This creates a completed internal wallet transaction and is visible in the merchant wallet immediately.</div>
              <div><label htmlFor="demo-credit-amount" className="mb-2 block text-sm font-bold text-gray-700">Amount (PHP)</label><input id="demo-credit-amount" type="number" min="50" max="50000" step="50" value={creditAmount} onChange={event => setCreditAmount(event.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" /></div>
              <p className="text-xs text-gray-500">Allowed amount: ₱50–₱50,000 per credit.</p>
              <div className="flex justify-end gap-3 pt-2"><button onClick={() => setCreditMerchant(null)} disabled={creditingWallet} className="rounded-lg border border-gray-300 px-5 py-2 font-bold text-gray-700">Cancel</button><button onClick={addDemoWalletCredit} disabled={creditingWallet} className="rounded-lg bg-emerald-600 px-5 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-60">{creditingWallet ? 'Adding...' : 'Add demo balance'}</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ label, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" title={label} aria-label={label} className={`flex size-10 shrink-0 items-center justify-center rounded-lg border bg-white transition disabled:cursor-not-allowed disabled:opacity-50 ${className || ''}`} {...props}>{children}</button>;
}

const summaryColors = {
  blue: 'bg-blue-50 text-blue-600', green: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600', orange: 'bg-orange-50 text-orange-600', purple: 'bg-purple-50 text-purple-600',
};

function SummaryCard({ icon, color, value, label }: { icon: React.ReactNode; color: keyof typeof summaryColors; value: React.ReactNode; label: string }) {
  return <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${summaryColors[color]}`}>{icon}</div><div className="min-w-0"><p className="text-xl font-black text-[#101a33]">{value}</p><p className="truncate text-xs text-slate-500">{label}</p></div></div>;
}

function FeeBreakdown({ breakdown }: { breakdown: MerchantDetails['fee_breakdown'] }) {
  return <div className="overflow-hidden rounded-lg border border-gray-200">
    <div className="flex items-center justify-between bg-gray-50 px-4 py-3 text-sm"><div><p className="font-bold capitalize text-gray-900">{breakdown.plan.name} plan</p><p className="text-xs text-gray-500">Per {breakdown.plan.billing_unit}</p></div><span className="font-black text-gray-900">₱{Number(breakdown.plan.amount).toLocaleString()}</span></div>
    {breakdown.add_ons.map(addOn => {
      const quantity = Number(addOn.quantity || 1);
      const subtotal = Number(addOn.subtotal ?? Number(addOn.amount) * quantity);
      return <div key={addOn.id} className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm"><div><p className="font-bold text-gray-900">{addOn.name}</p><p className="text-xs text-gray-500">₱{Number(addOn.amount).toLocaleString()} × {quantity} {addOn.amount_basis === 'keyword' ? 'keyword(s)' : 'product(s)/item(s)'}</p><p className="text-xs text-gray-500">Per {addOn.billing_unit}{addOn.amount_basis ? ` · Per ${addOn.amount_basis === 'inventory' ? 'inventory item' : 'keyword'}` : ''}</p></div><span className="font-bold text-gray-900">₱{subtotal.toLocaleString()}</span></div>;
    })}
    <div className="flex items-center justify-between border-t-2 border-gray-300 bg-blue-50 px-4 py-3"><span className="font-black text-blue-900">Total subscription fee</span><span className="text-lg font-black text-blue-900">₱{Number(breakdown.total_fee).toLocaleString()}</span></div>
  </div>;
}

function MerchantDetailsModal({ details, generatingRecoveryKey, commerceDomainSaving, onGenerateRecoveryKey, onSaveCommerceDomain, onClose }: { details: MerchantDetails; generatingRecoveryKey: boolean; commerceDomainSaving: boolean; onGenerateRecoveryKey: () => void; onSaveCommerceDomain: (commerceDomain: Merchant['commerceDomain']) => Promise<void>; onClose: () => void }) {
  const [selectedCommerceDomain, setSelectedCommerceDomain] = useState<Merchant['commerceDomain']>(details.commerceDomain ?? null);
  const copyRecoveryKey = async () => {
    if (!details.recovery_key) return;
    try {
      await navigator.clipboard.writeText(details.recovery_key);
      toast.success('Recovery key copied.');
    } catch {
      toast.error('Unable to copy the recovery key.');
    }
  };
  const coordinatesAvailable = details.latitude != null && details.longitude != null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
    <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-200 bg-white p-6"><div><h3 className="text-2xl font-black text-[#101a33]">{details.name}</h3><p className="mt-1 text-sm text-gray-500">Complete merchant profile and account information</p></div><button onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">✕</button></div>
      <div className="space-y-8 p-6">
        <section><h4 className="mb-4 text-sm font-black uppercase text-blue-700">Merchant profile</h4><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ProfileField label="Business name" value={details.name} /><ProfileField label="Merchant category" value={details.category?.name} /><ProfileField label="Merchant subcategory" value={details.subCategory?.name} />
          <ProfileField label="Email" value={details.email} /><ProfileField label="Phone" value={details.phone} /><ProfileField label="Website" value={details.website} />
          <ProfileField label="Business type" value={details.business_type} /><ProfileField label="Status" value={details.status} /><ProfileField label="Joined date" value={details.created_at ? new Date(details.created_at).toLocaleString() : undefined} />
          <ProfileField label="Store address" value={details.address} wide /><ProfileField label="City / Municipality" value={details.city} /><ProfileField label="Region" value={details.region || details.state} />
          <ProfileField label="City council district" value={details.council_district} /><ProfileField label="Geographic area" value={details.geographic_area} /><ProfileField label="Postal code" value={details.zip_code} />
          <ProfileField label="Country" value={details.country} /><ProfileField label="Latitude" value={details.latitude} /><ProfileField label="Longitude" value={details.longitude} />
          {coordinatesAvailable && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="text-xs font-bold uppercase text-slate-500">Map location</p><a href={`https://www.openstreetmap.org/?mlat=${details.latitude}&mlon=${details.longitude}#map=17/${details.latitude}/${details.longitude}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-bold text-blue-700 underline">Open merchant location</a></div>}
          <ProfileField label="About the business" value={details.description} wide />
        </div></section>
        <section><h4 className="mb-4 text-sm font-black uppercase text-blue-700">Commerce domain</h4><div className="max-w-md rounded-xl border border-slate-200 bg-slate-50 p-4"><label className="block text-sm font-bold text-slate-800" htmlFor="commerce-domain">Commerce Domain</label><select id="commerce-domain" value={selectedCommerceDomain ?? ''} disabled={commerceDomainSaving} onChange={event => setSelectedCommerceDomain((event.target.value || null) as Merchant['commerceDomain'])} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"><option value="">Unclassified</option><option value="FOOD">Food</option><option value="NON_FOOD">Non-Food</option><option value="MIXED">Mixed</option></select><div className="mt-3 flex items-center gap-3"><button type="button" disabled={commerceDomainSaving || selectedCommerceDomain === (details.commerceDomain ?? null)} onClick={() => void onSaveCommerceDomain(selectedCommerceDomain)} className="rounded-lg bg-[#e60012] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{commerceDomainSaving ? 'Saving...' : selectedCommerceDomain === (details.commerceDomain ?? null) ? 'Saved' : 'Save'}</button>{selectedCommerceDomain !== (details.commerceDomain ?? null) && <span className="text-xs font-medium text-amber-700">Unsaved changes</span>}</div></div></section>
        <section><h4 className="mb-4 text-sm font-black uppercase text-blue-700">Account access</h4><div className="grid gap-3 sm:grid-cols-2"><ProfileField label="Store ID / Merchant code" value={details.merchant_code} mono /><ProfileField label="Temporary password" value={details.temporary_password} mono /></div>
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase text-amber-700">Recovery key</p><p className="mt-1 break-all font-mono text-sm font-bold text-amber-900">{details.recovery_key || 'Generate only when the merchant needs password recovery.'}</p></div><div className="flex gap-2">{details.recovery_key && <button type="button" onClick={copyRecoveryKey} className="rounded-lg border border-amber-600 bg-white px-4 py-2 text-sm font-bold text-amber-700">Copy key</button>}<button onClick={onGenerateRecoveryKey} disabled={generatingRecoveryKey} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{generatingRecoveryKey ? 'Generating...' : details.recovery_key ? 'Rotate key' : 'Generate key'}</button></div></div></div>
        </section>
        <section><h4 className="mb-4 text-sm font-black uppercase text-blue-700">Subscription and fee breakdown</h4><div className="mb-3 grid gap-3 sm:grid-cols-3"><ProfileField label="Subscription tier" value={details.subscription_tier} /><ProfileField label="Subscription plan" value={details.subscription_plan} /><ProfileField label="Subscription status" value={details.subscription_status} /></div><FeeBreakdown breakdown={details.fee_breakdown} /></section>
      </div>
    </div>
  </div>;
}

function ProfileField({ label, value, wide, mono }: { label: string; value?: React.ReactNode; wide?: boolean; mono?: boolean }) {
  const available = value !== undefined && value !== null && value !== '';
  return <div className={`rounded-xl bg-slate-50 p-4 ${wide ? 'sm:col-span-2' : ''}`}><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className={`mt-1 break-words text-sm font-semibold capitalize text-slate-900 ${mono ? 'font-mono normal-case' : ''}`}>{available ? value : 'N/A'}</p></div>;
}

function MerchantApplicationApprovalModal({ applications, selected, loading, actionLoading, onSelect, onClose, onApprove, onReject }: { applications: MerchantApplication[]; selected: MerchantApplication | null; loading: boolean; actionLoading: boolean; onSelect: (application: MerchantApplication) => void; onClose: () => void; onApprove: (application: MerchantApplication) => void; onReject: (application: MerchantApplication) => void }) {
  const rawDocuments: Array<[string, string | undefined]> = selected ? [
    ['Payment proof', selected.payment_proof_url], ['Business permit', selected.business_permit_url], ['DTI permit', selected.dti_permit_url],
    ['Valid ID', selected.valid_id_url], ['Establishment photo', selected.establishment_photo_url], ['Authorized person photo', selected.authorized_person_photo_url],
    ...(selected.business_documents_urls || []).map((url, index): [string, string] => [`Business document ${index + 1}`, url]),
  ] : [];
  const documents = rawDocuments.filter((item): item is [string, string] => Boolean(item[1]));

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="application-approval-title">
    <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-6"><div><h2 id="application-approval-title" className="text-xl font-black text-[#101a33]">Merchant applications for approval</h2><p className="text-sm text-slate-500">Review submitted business information and approve onboarding</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X /></button></header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-slate-50 p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r"><p className="px-2 pb-3 text-xs font-black uppercase tracking-wide text-slate-500">For approval ({applications.length})</p>{loading ? <p className="p-5 text-sm text-slate-500">Loading applications...</p> : applications.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center"><Check className="mx-auto mb-2 text-emerald-500" /><p className="text-sm font-bold text-slate-700">No applications awaiting approval</p></div> : <div className="flex gap-2 overflow-x-auto lg:block lg:space-y-2 lg:overflow-visible">{applications.map(application => <button key={application.id} type="button" onClick={() => onSelect(application)} className={`min-w-[230px] rounded-xl border p-3 text-left transition lg:min-w-0 lg:w-full ${selected?.id === application.id ? 'border-red-300 bg-white shadow-sm ring-2 ring-red-100' : 'border-transparent hover:bg-white'}`}><p className="truncate text-sm font-bold text-slate-900">{application.business_name}</p><p className="mt-1 truncate text-xs text-slate-500">{application.email}</p><p className="mt-2 text-[11px] font-bold text-blue-700">Submitted {new Date(application.submitted_at).toLocaleDateString()}</p></button>)}</div>}</aside>
        <main className="min-h-0 overflow-y-auto p-5 sm:p-6">{selected ? <div className="space-y-7">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-2xl font-black text-[#101a33]">{selected.business_name}</h3><p className="mt-1 text-sm text-slate-500">Submitted {new Date(selected.submitted_at).toLocaleString()}</p></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">For Approval</span></div>
          <ApplicationSection title="Business evaluation"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><ApplicationField label="Business name" value={selected.business_name} /><ApplicationField label="Contact person" value={selected.contact_name} /><ApplicationField label="Business category" value={selected.category_name} /><ApplicationField label="Business subcategory" value={selected.sub_category_name} /><ApplicationField label="Email" value={selected.email} /><ApplicationField label="Phone" value={selected.phone} /><ApplicationField label="Application source" value={selected.source?.replaceAll('_', ' ')} /><ApplicationField label="Store address" value={selected.address} wide /><ApplicationField label="City / Municipality" value={selected.city_municipality} /><ApplicationField label="Council district" value={selected.council_district} /><ApplicationField label="Geographic area" value={selected.geographic_area || selected.barangay} /><ApplicationField label="Has branches" value={selected.has_branches == null ? undefined : selected.has_branches ? 'Yes' : 'No'} /><ApplicationField label="Number of branches" value={selected.branch_count} /><ApplicationField label="Number of products" value={selected.product_count} /><ApplicationField label="Latitude" value={selected.latitude} /><ApplicationField label="Longitude" value={selected.longitude} />{selected.latitude && selected.longitude && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><p className="text-[10px] font-bold uppercase text-slate-500">Map location</p><a href={`https://www.openstreetmap.org/?mlat=${selected.latitude}&mlon=${selected.longitude}#map=18/${selected.latitude}/${selected.longitude}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-bold text-blue-700 underline">Open submitted location</a></div>}</div><div className="mt-3 rounded-xl bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase text-slate-500">About the business</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{selected.business_description || 'No business description submitted.'}</p></div></ApplicationSection>
          <ApplicationSection title="Onboarding coordinator">{selected.onboarding_coordinator ? <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-600 font-black text-white">{selected.onboarding_coordinator.full_name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="font-black text-[#101a33]">{selected.onboarding_coordinator.full_name}</p><p className="text-sm text-slate-600">{selected.onboarding_coordinator.coordinator_code || 'Coordinator code unavailable'}{selected.onboarding_coordinator.zone_name ? ` · ${selected.onboarding_coordinator.zone_name}` : ''}</p></div><div className="text-sm text-slate-600"><p>{selected.onboarding_coordinator.email}</p><p>{selected.onboarding_coordinator.mobile_number}</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><ApplicationField label="Assigned date" value={selected.assigned_at ? new Date(selected.assigned_at).toLocaleString() : undefined} /><ApplicationField label="Coordinator review notes" value={selected.coordinator_notes} /></div></div> : <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">No onboarding coordinator is assigned to this application.</div>}</ApplicationSection>
          <ApplicationSection title="Subscription and payment"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><ApplicationField label="Subscription tier" value={selected.subscription_tier} /><ApplicationField label="Subscription plan" value={selected.subscription_plan} /><ApplicationField label="Plan fee" value={`₱${Number(selected.subscription_amount).toLocaleString()}`} /><ApplicationField label="Total fee" value={`₱${Number(selected.total_fee ?? selected.subscription_amount).toLocaleString()}`} /><ApplicationField label="Payment method" value={selected.payment_method} /><ApplicationField label="Assignment" value={selected.assignment_status} /></div>{selected.selected_add_ons?.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{selected.selected_add_ons.map(addOn => <div key={addOn.id} className="rounded-xl border border-slate-200 p-3"><div className="flex justify-between gap-3"><div><p className="text-sm font-bold">{addOn.name}</p><p className="text-xs text-slate-500">{addOn.quantity} × ₱{Number(addOn.amount).toLocaleString()}</p></div><p className="font-black">₱{Number(addOn.subtotal).toLocaleString()}</p></div></div>)}</div> : <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">No add-ons selected.</p>}</ApplicationSection>
          <ApplicationSection title="Submitted documents">{documents.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{documents.map(([label, url]) => <a key={`${label}-${url}`} href={publicAssetUrl(url)} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-50"><span className="flex items-center gap-2"><FileText size={17} />{label}</span><span>↗</span></a>)}</div> : <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No documents submitted.</div>}</ApplicationSection>
          <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white/95 py-4 backdrop-blur"><button type="button" disabled={actionLoading} onClick={() => onReject(selected)} className="rounded-xl border border-red-300 px-6 py-3 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">Reject</button><button type="button" disabled={actionLoading} onClick={() => onApprove(selected)} className="rounded-xl bg-emerald-600 px-7 py-3 font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">{actionLoading ? 'Processing...' : 'Approve merchant'}</button></div>
        </div> : <div className="flex h-full min-h-64 items-center justify-center text-sm text-slate-500">Select an application to review.</div>}</main>
      </div>
    </div>
  </div>;
}

function ApplicationSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h4 className="mb-3 text-sm font-black uppercase tracking-wide text-blue-700">{title}</h4>{children}</section>;
}

function ApplicationField({ label, value, wide }: { label: string; value?: string | number | null; wide?: boolean }) {
  return <div className={`rounded-xl bg-slate-50 p-3 ${wide ? 'sm:col-span-2' : ''}`}><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold capitalize text-slate-900">{value === undefined || value === null || value === '' ? 'N/A' : value}</p></div>;
}

function MerchantLedgerModal({ ledger, onClose }: { ledger: MerchantLedger; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
    <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-xl">
      <div className="flex items-start justify-between border-b border-gray-200 p-6"><div><h3 className="text-xl font-black text-gray-900">Subscription ledger</h3><p className="mt-1 text-sm text-gray-500">{ledger.merchant.name}{ledger.merchant.merchant_code ? ` · ${ledger.merchant.merchant_code}` : ''}</p></div><button onClick={onClose} className="p-2 text-gray-500" aria-label="Close">✕</button></div>
      <div className="space-y-6 p-6">
        <section><h4 className="mb-3 text-sm font-black uppercase text-blue-700">Current billing</h4><FeeBreakdown breakdown={ledger.fee_breakdown} /><div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-gray-50 p-4"><p className="text-xs font-bold uppercase text-gray-500">Billed</p><p className="mt-1 text-xl font-black text-gray-900">₱{Number(ledger.balance.total_billed).toLocaleString()}</p></div><div className="rounded-lg bg-emerald-50 p-4"><p className="text-xs font-bold uppercase text-emerald-700">Paid</p><p className="mt-1 text-xl font-black text-emerald-800">₱{Number(ledger.balance.total_paid).toLocaleString()}</p></div><div className="rounded-lg bg-red-50 p-4"><p className="text-xs font-bold uppercase text-red-700">Unpaid balance</p><p className="mt-1 text-xl font-black text-red-800">₱{Number(ledger.balance.unpaid).toLocaleString()}</p></div></div></section>
        <section><h4 className="mb-3 text-sm font-black uppercase text-blue-700">Payment history</h4><div className="overflow-x-auto rounded-lg border border-gray-200"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Date', 'Plan', 'Period', 'Amount', 'Method', 'Reference', 'Status'].map(label => <th key={label} className="px-4 py-3 text-left font-bold text-gray-600">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-200">{ledger.payments.length ? ledger.payments.map(payment => <tr key={payment.id}><td className="px-4 py-3">{new Date(payment.created_at).toLocaleString()}</td><td className="px-4 py-3 capitalize">{payment.tier} · {payment.plan}</td><td className="px-4 py-3">{payment.period_start ? new Date(payment.period_start).toLocaleDateString() : 'N/A'} – {payment.period_end ? new Date(payment.period_end).toLocaleDateString() : 'N/A'}</td><td className="px-4 py-3 font-bold">₱{Number(payment.amount).toLocaleString()}</td><td className="px-4 py-3 capitalize">{payment.payment_method}{payment.gateway ? ` (${payment.gateway})` : ''}</td><td className="px-4 py-3 font-mono text-xs">{payment.payment_ref || 'N/A'}</td><td className="px-4 py-3 capitalize">{payment.status}</td></tr>) : <tr><td colSpan={7} className="p-8 text-center text-gray-500">No subscription payments recorded.</td></tr>}</tbody></table></div></section>
      </div>
    </div>
  </div>;
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
