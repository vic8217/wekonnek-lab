'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';
import { Check, Pencil, Trash2 } from 'lucide-react';

const API = '/api/backend/subscriptions';
type Audience = 'merchant' | 'rider' | 'coordinator';
type Workspace = 'plans' | 'payments';

async function readJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  return text ? { message: text } : null;
}

interface PlanDefinition {
  id: string;
  audience: Audience;
  tier: string;
  fixedAmount: number | string;
  variableOrderPercent?: number | string | null;
  productLimit?: number | null;
  features: string[];
  minimumOrders?: number | null;
  includesInHouseRiders?: boolean | null;
  isActive: boolean;
}

interface AddOnPackage {
  id: string;
  audience: Audience;
  name: string;
  amount: number | string;
  billingUnit: 'day' | 'week' | 'month';
  amountBasis?: 'keyword' | 'inventory' | null;
  description?: string | null;
  isActive: boolean;
}

interface SubscriptionPayment {
  id: number;
  merchant_id: number;
  tier: string;
  plan: string;
  amount: number;
  payment_method: string;
  gateway?: string;
  status: string;
  payment_proof_url?: string;
  created_at: string;
  merchant?: { id: number; name: string };
}

const audienceLabels: Record<Audience, string> = {
  merchant: 'Merchant',
  rider: 'Rider',
  coordinator: 'Coordinator',
};

export default function AdminSubscriptionsPage() {
  const [workspace, setWorkspace] = useState<Workspace>('plans');
  const [audience, setAudience] = useState<Audience>('merchant');
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState<'pending' | 'paid' | 'rejected' | 'all'>('pending');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editingPlan, setEditingPlan] = useState<PlanDefinition | null>(null);
  const [updatingPlan, setUpdatingPlan] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [addOns, setAddOns] = useState<AddOnPackage[]>([]);
  const [showAddOnForm, setShowAddOnForm] = useState(false);
  const [creatingAddOn, setCreatingAddOn] = useState(false);
  const [editingAddOn, setEditingAddOn] = useState<AddOnPackage | null>(null);
  const [updatingAddOn, setUpdatingAddOn] = useState(false);
  const [deletingAddOnId, setDeletingAddOnId] = useState<string | null>(null);

  const headers = () => ({ Authorization: `Bearer ${getToken()}` });

  const fetchPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const response = await fetch(`${API}/definitions`, { headers: headers() });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body?.message || 'Subscription service is unavailable. Start or restart the backend server.');
      setPlans(Array.isArray(body) ? body : []);
      const addOnResponse = await fetch(`${API}/add-ons`, { headers: headers() });
      const addOnBody = await readJsonResponse(addOnResponse);
      if (!addOnResponse.ok) throw new Error(addOnBody?.message || 'Unable to load add-on packages');
      setAddOns(Array.isArray(addOnBody) ? addOnBody : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load subscription tiers');
    } finally {
      setPlansLoading(false);
    }
  }, []);

  const fetchPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const params = paymentFilter === 'all' ? '' : `?status=${paymentFilter}`;
      const response = await fetch(`${API}${params}`, { headers: headers() });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body?.message || 'Subscription service is unavailable. Start or restart the backend server.');
      setPayments(Array.isArray(body) ? body : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load subscription payments');
    } finally {
      setPaymentsLoading(false);
    }
  }, [paymentFilter]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);
  useEffect(() => {
    if (workspace === 'payments') fetchPayments();
  }, [fetchPayments, workspace]);

  const createPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setCreating(true);
    try {
      const response = await fetch(`${API}/definitions`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, audience }),
      });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body?.message || 'Subscription service is unavailable. Start or restart the backend server.');
      toast.success(`${audienceLabels[audience]} ${String(values.tier)} tier created.`);
      form.reset();
      await fetchPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create subscription tier');
    } finally {
      setCreating(false);
    }
  };

  const reviewPayment = async (id: number, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? prompt('Reason for rejection (optional):') || undefined : undefined;
    setBusyId(id);
    try {
      const response = await fetch(`${API}/${id}/${action}`, {
        method: 'PATCH',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body?.message || 'Subscription service is unavailable. Start or restart the backend server.');
      toast.success(`Subscription ${action === 'approve' ? 'approved' : 'rejected'}.`);
      await fetchPayments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to review payment');
    } finally {
      setBusyId(null);
    }
  };

  const updatePlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingPlan) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setUpdatingPlan(true);
    try {
      const response = await fetch(`${API}/definitions/${editingPlan.id}`, {
        method: 'PATCH',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, is_active: values.is_active === 'true' }),
      });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body?.message || 'Unable to update subscription tier');
      toast.success(`${audienceLabels[editingPlan.audience]} ${editingPlan.tier} tier updated.`);
      setEditingPlan(null);
      await fetchPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update subscription tier');
    } finally {
      setUpdatingPlan(false);
    }
  };

  const createAddOn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setCreatingAddOn(true);
    try {
      const response = await fetch(`${API}/add-ons`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, audience }),
      });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body?.message || `Unable to create add-on (HTTP ${response.status})`);
      toast.success(`${String(values.name)} add-on created.`);
      setShowAddOnForm(false);
      await fetchPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create add-on');
    } finally {
      setCreatingAddOn(false);
    }
  };

  const deletePlan = async (plan: PlanDefinition) => {
    if (!window.confirm(`Delete the ${plan.tier} merchant tier? This cannot be undone.`)) return;
    setDeletingPlanId(plan.id);
    try {
      const response = await fetch(`${API}/definitions/${plan.id}`, {
        method: 'DELETE',
        headers: headers(),
      });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body?.message || 'Unable to delete subscription tier');
      toast.success(`${plan.tier} merchant tier deleted.`);
      await fetchPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete subscription tier');
    } finally {
      setDeletingPlanId(null);
    }
  };

  const updateAddOn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingAddOn) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setUpdatingAddOn(true);
    try {
      const response = await fetch(`${API}/add-ons/${editingAddOn.id}`, {
        method: 'PATCH',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, is_active: values.is_active === 'true' }),
      });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body?.message || 'Unable to update add-on package');
      toast.success(`${String(values.name)} add-on updated.`);
      setEditingAddOn(null);
      await fetchPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update add-on package');
    } finally {
      setUpdatingAddOn(false);
    }
  };

  const deleteAddOn = async (addOn: AddOnPackage) => {
    if (!window.confirm(`Delete the "${addOn.name}" add-on package? This cannot be undone.`)) return;
    setDeletingAddOnId(addOn.id);
    try {
      const response = await fetch(`${API}/add-ons/${addOn.id}`, {
        method: 'DELETE',
        headers: headers(),
      });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body?.message || 'Unable to delete add-on package');
      toast.success(`${addOn.name} add-on deleted.`);
      await fetchPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete add-on package');
    } finally {
      setDeletingAddOnId(null);
    }
  };

  const visiblePlans = plans.filter(plan => plan.audience === audience);
  const visibleAddOns = addOns.filter(addOn => addOn.audience === audience);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Subscription Management</h1>
        <p className="mt-2 text-gray-600">Create subscription tiers for merchants, riders, and coordinators, and review merchant payments.</p>
      </div>

      <div className="inline-flex rounded-xl bg-gray-100 p-1">
        <button onClick={() => setWorkspace('plans')} className={`rounded-lg px-5 py-2 text-sm font-bold ${workspace === 'plans' ? 'bg-white text-[#DB0002] shadow-sm' : 'text-gray-600'}`}>Plan Tiers</button>
        <button onClick={() => setWorkspace('payments')} className={`rounded-lg px-5 py-2 text-sm font-bold ${workspace === 'payments' ? 'bg-white text-[#DB0002] shadow-sm' : 'text-gray-600'}`}>Payment Reviews</button>
      </div>

      {workspace === 'plans' ? (
        <>
          <div className="flex gap-2 border-b border-gray-200">
            {(['merchant', 'rider', 'coordinator'] as Audience[]).map(item => (
              <button key={item} onClick={() => setAudience(item)} className={`px-4 py-3 font-bold ${audience === item ? 'border-b-2 border-[#DB0002] text-[#DB0002]' : 'text-gray-600'}`}>
                {audienceLabels[item]} Plans <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">{plans.filter(plan => plan.audience === item).length}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(340px,0.75fr)_minmax(0,1.5fr)]">
            <form onSubmit={createPlan} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Create {audienceLabels[audience]} Tier</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {audience === 'merchant' ? 'Set the daily fixed charge, percentage of system orders net of VAT, and product range.' : audience === 'rider' ? 'Set a daily fixed charge and minimum completed orders.' : 'Gold and Platinum include in-house riders; Silver does not.'}
                </p>
              </div>

              <Field label="Tier">
                {audience === 'merchant' || audience === 'rider' ? (
                  <input name="tier" required maxLength={50} placeholder={audience === 'merchant' ? 'e.g. Premium' : 'Tier name'} className="admin-plan-input" />
                ) : (
                  <select name="tier" required defaultValue="" className="admin-plan-input"><option value="" disabled>Select tier</option><option value="silver">Silver</option><option value="gold">Gold</option><option value="platinum">Platinum</option></select>
                )}
              </Field>
              <Field label="Fixed amount per day (₱)">
                <input name="fixed_amount" type="number" min="0" step="0.01" required placeholder="0.00" className="admin-plan-input" />
              </Field>
              {audience === 'merchant' && (
                <>
                  <Field label="Percentage on system sales (net of VAT amount) (%)"><input name="variable_order_percent" type="number" min="0" max="100" step="0.01" placeholder="N/A" className="admin-plan-input" /></Field>
                  <p className="-mt-3 text-xs text-gray-500">Optional. Leave blank for N/A. Applied after VAT is excluded for sales processed through WeKonnek.</p>
                  <Field label="Number of products">
                    <input name="product_limit" type="number" min="0" step="1" required placeholder="e.g. 20" className="admin-plan-input" />
                  </Field>
                  <Field label="Features">
                    <textarea name="features" rows={4} maxLength={2000} placeholder={'QR code ordering\nPriority support\nAdvanced analytics'} className="admin-plan-input resize-none" />
                    <span className="mt-1.5 block text-xs font-normal text-gray-500">Add one feature per line.</span>
                  </Field>
                </>
              )}
              {audience === 'rider' && <Field label="Minimum number of orders"><input name="minimum_orders" type="number" min="0" step="1" required placeholder="e.g. 20" className="admin-plan-input" /></Field>}
              {audience === 'coordinator' && <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">In-house riders are automatically enabled for Gold and Platinum and disabled for Silver.</div>}
              <button disabled={creating} className="w-full rounded-xl bg-[#DB0002] px-5 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-60">{creating ? 'Creating…' : 'Create tier'}</button>
            </form>

            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold text-gray-900">Configured {audienceLabels[audience]} Tiers</h2><button type="button" onClick={() => setShowAddOnForm(true)} className="rounded-xl bg-[#DB0002] px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700">+ Create add-on package</button></div>
              {plansLoading ? <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-gray-500">Loading tiers…</div> : visiblePlans.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">No {audience} tiers configured yet.</div> : (
                <div className="grid gap-4 md:grid-cols-2">
                  {visiblePlans.map(plan => <PlanCard key={plan.id} plan={plan} deleting={deletingPlanId === plan.id} onEdit={() => setEditingPlan(plan)} onDelete={() => deletePlan(plan)} />)}
                </div>
              )}
              <div className="mt-8"><div className="mb-3 flex items-center gap-2"><h2 className="text-lg font-bold text-gray-900">{audienceLabels[audience]} Add-on Packages</h2><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600">{visibleAddOns.length}</span></div>
                {visibleAddOns.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No add-on packages configured yet.</div> : <div className="grid gap-4 md:grid-cols-2">{visibleAddOns.map(addOn => <AddOnCard key={addOn.id} addOn={addOn} deleting={deletingAddOnId === addOn.id} onEdit={() => setEditingAddOn(addOn)} onDelete={() => deleteAddOn(addOn)} />)}</div>}
              </div>
            </div>
          </div>
        </>
      ) : (
        <PaymentReviews payments={payments} loading={paymentsLoading} filter={paymentFilter} setFilter={setPaymentFilter} busyId={busyId} onReview={reviewPayment} />
      )}
      {editingPlan && <EditPlanModal plan={editingPlan} saving={updatingPlan} onClose={() => setEditingPlan(null)} onSubmit={updatePlan} />}
      {showAddOnForm && <AddOnModal audience={audience} saving={creatingAddOn} onClose={() => setShowAddOnForm(false)} onSubmit={createAddOn} />}
      {editingAddOn && <EditAddOnModal addOn={editingAddOn} saving={updatingAddOn} onClose={() => setEditingAddOn(null)} onSubmit={updateAddOn} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-bold text-gray-700">{label}</span>{children}</label>;
}

function AddOnCard({ addOn, deleting, onEdit, onDelete }: { addOn: AddOnPackage; deleting: boolean; onEdit: () => void; onDelete: () => void }) {
  return <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3"><h3 className="text-lg font-black text-gray-900">{addOn.name}</h3><div className="flex shrink-0 items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-bold ${addOn.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{addOn.isActive ? 'Active' : 'Inactive'}</span><button type="button" onClick={onEdit} title="Edit add-on" aria-label={`Edit ${addOn.name}`} className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"><Pencil size={15} /></button><button type="button" onClick={onDelete} disabled={deleting} title="Delete add-on" aria-label={`Delete ${addOn.name}`} className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:opacity-60"><Trash2 size={15} /></button></div></div>
    <p className="mt-4 text-3xl font-black text-[#DB0002]">₱{Number(addOn.amount).toLocaleString()}</p>
    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Per {addOn.billingUnit}{addOn.amountBasis ? ` · Per ${addOn.amountBasis === 'inventory' ? 'inventory item' : 'keyword'}` : ''}</p>
    <p className="mt-4 border-t border-gray-100 pt-4 text-sm leading-6 text-gray-600">{addOn.description || 'No description provided.'}</p>
  </article>;
}

function EditAddOnModal({ addOn, saving, onClose, onSubmit }: { addOn: AddOnPackage; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-addon-title">
    <form onSubmit={onSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 id="edit-addon-title" className="text-xl font-black text-gray-900">Edit add-on package</h2><p className="mt-1 text-sm text-gray-500">For {audienceLabels[addOn.audience].toLowerCase()} subscriptions</p></div><button type="button" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">✕</button></div>
      <Field label="Add-on name"><input name="name" required maxLength={100} defaultValue={addOn.name} className="admin-plan-input" /></Field>
      <Field label="Amount (₱)"><input name="amount" type="number" min="0" step="0.01" required defaultValue={Number(addOn.amount)} className="admin-plan-input" /></Field>
      <Field label="Billing period"><select name="billing_unit" required defaultValue={addOn.billingUnit} className="admin-plan-input"><option value="day">Per day</option><option value="week">Per week</option><option value="month">Per month</option></select></Field>
      <Field label="Amount basis (optional)"><select name="amount_basis" defaultValue={addOn.amountBasis || ''} className="admin-plan-input"><option value="">No amount basis</option><option value="keyword">Per keyword</option><option value="inventory">Per inventory item</option></select></Field>
      <Field label="Description"><textarea name="description" rows={4} maxLength={1000} required defaultValue={addOn.description || ''} className="admin-plan-input resize-none" /></Field>
      <Field label="Status"><select name="is_active" defaultValue={String(addOn.isActive)} className="admin-plan-input"><option value="true">Active</option><option value="false">Inactive</option></select></Field>
      <div className="flex justify-end gap-3 border-t border-gray-200 pt-4"><button type="button" onClick={onClose} className="rounded-xl border border-gray-300 px-5 py-2.5 font-bold text-gray-700">Cancel</button><button disabled={saving} className="rounded-xl bg-[#DB0002] px-5 py-2.5 font-bold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  </div>;
}

function AddOnModal({ audience, saving, onClose, onSubmit }: { audience: Audience; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="create-addon-title">
    <form onSubmit={onSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 id="create-addon-title" className="text-xl font-black text-gray-900">Create add-on package</h2><p className="mt-1 text-sm text-gray-500">For {audienceLabels[audience].toLowerCase()} subscriptions</p></div><button type="button" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">✕</button></div>
      <Field label="Add-on name"><input name="name" required maxLength={100} placeholder="e.g. Featured placement boost" className="admin-plan-input" /></Field>
      <Field label="Amount (₱)"><input name="amount" type="number" min="0" step="0.01" required placeholder="0.00" className="admin-plan-input" /></Field>
      <Field label="Billing period"><select name="billing_unit" required defaultValue="" className="admin-plan-input"><option value="" disabled>Select billing period</option><option value="day">Per day</option><option value="week">Per week</option><option value="month">Per month</option></select></Field>
      <Field label="Amount basis (optional)"><select name="amount_basis" defaultValue="" className="admin-plan-input"><option value="">No amount basis</option><option value="keyword">Per keyword</option><option value="inventory">Per inventory item</option></select></Field>
      <Field label="Description"><textarea name="description" rows={4} maxLength={1000} required placeholder="Describe what is included in this add-on…" className="admin-plan-input resize-none" /></Field>
      <div className="flex justify-end gap-3 border-t border-gray-200 pt-4"><button type="button" onClick={onClose} className="rounded-xl border border-gray-300 px-5 py-2.5 font-bold text-gray-700">Cancel</button><button disabled={saving} className="rounded-xl bg-[#DB0002] px-5 py-2.5 font-bold text-white disabled:opacity-60">{saving ? 'Creating…' : 'Create add-on'}</button></div>
    </form>
  </div>;
}

function PlanCard({ plan, deleting, onEdit, onDelete }: { plan: PlanDefinition; deleting: boolean; onEdit: () => void; onDelete: () => void }) {
  return <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-black capitalize text-gray-900">{plan.tier}</h3><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-bold ${plan.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{plan.isActive ? 'Active' : 'Inactive'}</span><button type="button" onClick={onEdit} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Edit</button>{plan.audience === 'merchant' && <button type="button" onClick={onDelete} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-60"><Trash2 size={14} />{deleting ? 'Deleting…' : 'Delete'}</button>}</div></div>
    <p className="mt-4 text-3xl font-black text-[#DB0002]">₱{Number(plan.fixedAmount).toLocaleString()}</p>
    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Fixed amount per day</p>
    <div className="mt-4 space-y-2 border-t border-gray-100 pt-4 text-sm text-gray-700">
      {plan.audience === 'merchant' && <><p><b>{plan.variableOrderPercent == null ? 'N/A' : `${Number(plan.variableOrderPercent)}%`}</b> on system sales (net of VAT amount)</p><p><b>{plan.productLimit}</b> products</p></>}
      {plan.audience === 'rider' && <p><b>{plan.minimumOrders}</b> minimum orders</p>}
      {plan.audience === 'coordinator' && <p><b>{plan.includesInHouseRiders ? 'Includes' : 'Does not include'}</b> in-house riders</p>}
      {plan.audience === 'merchant' && plan.features?.length > 0 && <ul className="space-y-1.5 pt-1">{plan.features.map(feature => <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 shrink-0 text-green-600" size={15} /><span>{feature}</span></li>)}</ul>}
    </div>
  </article>;
}

function EditPlanModal({ plan, saving, onClose, onSubmit }: { plan: PlanDefinition; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-tier-title">
    <form onSubmit={onSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 id="edit-tier-title" className="text-xl font-black capitalize text-gray-900">Edit {plan.tier} tier</h2><p className="mt-1 text-sm text-gray-500">{audienceLabels[plan.audience]} subscription settings</p></div><button type="button" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">✕</button></div>
      <Field label="Fixed amount per day (₱)"><input name="fixed_amount" type="number" min="0" step="0.01" required defaultValue={Number(plan.fixedAmount)} className="admin-plan-input" /></Field>
      {plan.audience === 'merchant' && <>
        <Field label="Percentage on system sales (net of VAT amount) (%)"><input name="variable_order_percent" type="number" min="0" max="100" step="0.01" defaultValue={plan.variableOrderPercent == null ? '' : Number(plan.variableOrderPercent)} placeholder="N/A" className="admin-plan-input" /><span className="mt-1.5 block text-xs font-normal text-gray-500">Leave blank for N/A.</span></Field>
        <Field label="Number of products"><input name="product_limit" type="number" min="0" step="1" required defaultValue={plan.productLimit ?? 0} className="admin-plan-input" /></Field>
        <Field label="Features"><textarea name="features" rows={4} maxLength={2000} defaultValue={plan.features?.join('\n')} placeholder={'QR code ordering\nPriority support\nAdvanced analytics'} className="admin-plan-input resize-none" /><span className="mt-1.5 block text-xs font-normal text-gray-500">Add one feature per line.</span></Field>
      </>}
      {plan.audience === 'rider' && <Field label="Minimum number of orders"><input name="minimum_orders" type="number" min="0" step="1" required defaultValue={plan.minimumOrders ?? 0} className="admin-plan-input" /></Field>}
      {plan.audience === 'coordinator' && <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">{plan.tier === 'silver' ? 'Silver does not include in-house riders.' : 'This tier includes in-house riders.'}</div>}
      <Field label="Status"><select name="is_active" defaultValue={String(plan.isActive)} className="admin-plan-input"><option value="true">Active</option><option value="false">Inactive</option></select></Field>
      <div className="flex justify-end gap-3 border-t border-gray-200 pt-4"><button type="button" onClick={onClose} className="rounded-xl border border-gray-300 px-5 py-2.5 font-bold text-gray-700">Cancel</button><button disabled={saving} className="rounded-xl bg-[#DB0002] px-5 py-2.5 font-bold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  </div>;
}

function PaymentReviews({ payments, loading, filter, setFilter, busyId, onReview }: { payments: SubscriptionPayment[]; loading: boolean; filter: 'pending' | 'paid' | 'rejected' | 'all'; setFilter: (value: 'pending' | 'paid' | 'rejected' | 'all') => void; busyId: number | null; onReview: (id: number, action: 'approve' | 'reject') => void }) {
  return <div className="space-y-4">
    <div className="flex gap-2 border-b border-gray-200">{(['pending', 'paid', 'rejected', 'all'] as const).map(item => <button key={item} onClick={() => setFilter(item)} className={`px-4 py-2 font-bold capitalize ${filter === item ? 'border-b-2 border-[#DB0002] text-[#DB0002]' : 'text-gray-600'}`}>{item}</button>)}</div>
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full"><thead className="bg-[#DB0002] text-white"><tr>{['Merchant', 'Plan', 'Amount', 'Method', 'Requested', 'Status', 'Action'].map(label => <th key={label} className="px-5 py-3 text-left text-sm">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-200">
      {loading ? <tr><td colSpan={7} className="p-10 text-center text-gray-500">Loading payments…</td></tr> : payments.length === 0 ? <tr><td colSpan={7} className="p-10 text-center text-gray-500">No subscription payments found.</td></tr> : payments.map(payment => <tr key={payment.id}><td className="px-5 py-4 font-bold">{payment.merchant?.name || `Merchant #${payment.merchant_id}`}</td><td className="px-5 py-4 capitalize">{payment.tier} · {payment.plan}</td><td className="px-5 py-4">₱{Number(payment.amount).toLocaleString()}</td><td className="px-5 py-4 capitalize">{payment.payment_method}{payment.gateway ? ` (${payment.gateway})` : ''}</td><td className="px-5 py-4 text-sm">{new Date(payment.created_at).toLocaleString()}</td><td className="px-5 py-4 capitalize">{payment.status}</td><td className="px-5 py-4">{payment.status === 'pending' && payment.payment_method === 'manual' ? <div className="flex gap-2"><button disabled={busyId === payment.id} onClick={() => onReview(payment.id, 'approve')} className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white">Approve</button><button disabled={busyId === payment.id} onClick={() => onReview(payment.id, 'reject')} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white">Reject</button></div> : '—'}</td></tr>)}
    </tbody></table></div>
  </div>;
}
