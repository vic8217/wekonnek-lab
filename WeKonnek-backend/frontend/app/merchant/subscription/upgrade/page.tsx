'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/hooks/use-auth';
import { uploadApi } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type Tier = 'basic' | 'gold' | 'platinum';
type Plan = 'weekly' | 'monthly' | 'annual';

interface PlanInfo {
  tier: Tier;
  prices: Record<Plan, number>;
  features: string[];
  listingLimit: number;
}

interface MerchantData {
  subscription_tier?: string;
  subscription_plan?: string;
  subscription_expires_at?: string | null;
}

const PLAN_LABELS: Record<Plan, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  annual: 'Annual',
};

const TIER_ACCENT: Record<Tier, string> = {
  basic: 'border-gray-300',
  gold: 'border-yellow-400',
  platinum: 'border-purple-500',
};

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 0 })}`;

export default function SubscriptionUpgradePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [merchant, setMerchant] = useState<MerchantData | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedTier, setSelectedTier] = useState<Tier>('gold');
  const [selectedPlan, setSelectedPlan] = useState<Plan>('monthly');
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'manual'>('online');
  const [gateway, setGateway] = useState<'gcash' | 'maya' | 'card'>('gcash');
  const [proofFile, setProofFile] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const paid = searchParams.get('paid');

  useEffect(() => {
    if (paid === '1') {
      setMessage({ type: 'success', text: 'Payment received! Your subscription has been updated.' });
    } else if (paid === '0') {
      setMessage({ type: 'error', text: 'Payment was not completed. Please try again.' });
    }
  }, [paid]);

  useEffect(() => {
    const load = async () => {
      try {
        const token = getToken();
        const [plansRes, merchantRes] = await Promise.all([
          fetch(`${API}/api/subscriptions/plans`),
          token
            ? fetch(`${API}/api/merchants/me`, {
                headers: { Authorization: `Bearer ${token}` },
              })
            : Promise.resolve(null),
        ]);

        if (plansRes.ok) setPlans(await plansRes.json());

        if (merchantRes && merchantRes.ok) {
          const m: MerchantData = await merchantRes.json();
          setMerchant(m);
          if (m.subscription_tier) setSelectedTier(m.subscription_tier as Tier);
          if (m.subscription_plan) setSelectedPlan(m.subscription_plan as Plan);
        }
      } catch (e) {
        console.error('Failed to load subscription plans', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const selectedPlanInfo = useMemo(
    () => plans.find((p) => p.tier === selectedTier),
    [plans, selectedTier],
  );
  const amount = selectedPlanInfo?.prices[selectedPlan] ?? 0;

  const currentTier = merchant?.subscription_tier;
  const currentPlan = merchant?.subscription_plan;
  const isCurrent = selectedTier === currentTier && selectedPlan === currentPlan;

  const handleSubmit = async () => {
    setMessage(null);
    const token = getToken();
    if (!token) {
      setMessage({ type: 'error', text: 'You must be logged in.' });
      return;
    }

    setSubmitting(true);
    try {
      let paymentProofUrl: string | undefined;
      if (paymentMethod === 'manual') {
        if (!proofFile) {
          setMessage({ type: 'error', text: 'Please upload your payment proof.' });
          setSubmitting(false);
          return;
        }
        paymentProofUrl = await uploadApi.uploadFile(proofFile, 'document');
      }

      const res = await fetch(`${API}/api/subscriptions/upgrade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tier: selectedTier,
          plan: selectedPlan,
          payment_method: paymentMethod,
          gateway: paymentMethod === 'online' ? gateway : undefined,
          payment_proof_url: paymentProofUrl,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Request failed');
      }

      const data = await res.json();

      if (paymentMethod === 'online' && data.payment_url) {
        window.location.href = data.payment_url;
        return;
      }

      if (paymentMethod === 'online' && data.payment_error) {
        setMessage({
          type: 'error',
          text: `Online payment unavailable (${data.payment_error}). Please pay manually and upload proof instead.`,
        });
        return;
      }

      if (paymentMethod === 'manual') {
        setMessage({
          type: 'success',
          text: 'Your upgrade request was submitted and is pending admin approval. Your plan activates once verified.',
        });
      } else {
        setMessage({ type: 'success', text: 'Your subscription has been updated.' });
        setTimeout(() => router.push('/merchant/dashboard'), 1500);
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Something went wrong.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-600">Loading plans...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/merchant/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">Manage Subscription</h1>
          <p className="text-gray-600">Choose the plan that fits your business.</p>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg p-4 text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Billing period toggle */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-1 w-fit">
        {(['weekly', 'monthly', 'annual'] as Plan[]).map((p) => (
          <button
            key={p}
            onClick={() => setSelectedPlan(p)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              selectedPlan === p ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {PLAN_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p) => {
          const isSelected = p.tier === selectedTier;
          const isActivePlan = p.tier === currentTier && selectedPlan === currentPlan;
          return (
            <button
              key={p.tier}
              onClick={() => setSelectedTier(p.tier)}
              className={`text-left bg-white rounded-xl border-2 p-6 transition-all ${
                isSelected ? 'border-red-600 ring-2 ring-red-100' : TIER_ACCENT[p.tier]
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold text-gray-900 capitalize">{p.tier}</h3>
                {p.tier === currentTier && (
                  <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">Current tier</span>
                )}
              </div>
              <div className="mb-4">
                <span className="text-3xl font-extrabold text-gray-900">{peso(p.prices[selectedPlan])}</span>
                <span className="text-gray-500 text-sm">/{selectedPlan.replace('ly', '')}</span>
              </div>
              <ul className="space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                    <svg className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              {isActivePlan && (
                <p className="mt-4 text-xs text-gray-500">This is your active plan</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Checkout panel */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <p className="text-sm text-gray-600">Selected plan</p>
            <p className="text-lg font-bold text-gray-900 capitalize">
              {selectedTier} · {PLAN_LABELS[selectedPlan]}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">Amount due</p>
            <p className="text-2xl font-extrabold text-red-600">{peso(amount)}</p>
          </div>
        </div>

        <div>
          <p className="font-semibold text-gray-900 mb-3">Payment method</p>
          <div className="space-y-3">
            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${paymentMethod === 'online' ? 'border-red-600 bg-red-50' : 'border-gray-200'}`}>
              <input
                type="radio"
                name="paymentMethod"
                checked={paymentMethod === 'online'}
                onChange={() => setPaymentMethod('online')}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">Pay online</p>
                <p className="text-sm text-gray-600">Instant activation via GCash, Maya, or card.</p>
                {paymentMethod === 'online' && (
                  <div className="flex gap-2 mt-3">
                    {(['gcash', 'maya', 'card'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGateway(g)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize border ${
                          gateway === g ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300'
                        }`}
                      >
                        {g === 'gcash' ? 'GCash' : g === 'maya' ? 'Maya' : 'Card'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${paymentMethod === 'manual' ? 'border-red-600 bg-red-50' : 'border-gray-200'}`}>
              <input
                type="radio"
                name="paymentMethod"
                checked={paymentMethod === 'manual'}
                onChange={() => setPaymentMethod('manual')}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">Upload payment proof</p>
                <p className="text-sm text-gray-600">Pay manually, then upload your receipt for admin approval.</p>
                {paymentMethod === 'manual' && (
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                    className="mt-3 block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-red-600 file:text-white hover:file:bg-red-700"
                  />
                )}
              </div>
            </label>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || (isCurrent && paymentMethod === 'online')}
          className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting
            ? 'Processing...'
            : isCurrent
            ? 'Renew current plan'
            : paymentMethod === 'online'
            ? `Pay ${peso(amount)} & Activate`
            : `Submit ${peso(amount)} for approval`}
        </button>
      </div>
    </div>
  );
}
