'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { getToken } from '@/hooks/use-auth';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface MerchantData {
  name: string;
  subscription_tier: string;
  subscription_plan: string;
  subscription_amount: number;
  subscription_status?: string;
  subscription_started_at?: string | null;
  subscription_expires_at?: string | null;
  auto_renew?: boolean;
  status: string;
  is_active: boolean;
}

interface BillingRecord {
  id: number;
  tier: string;
  plan: string;
  amount: number;
  payment_method: string;
  status: string;
  created_at: string;
  period_end?: string | null;
}

const PLAN_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annual: 365 };

const TIER_FEATURES: Record<string, string[]> = {
  basic: ['10 Product listings', 'Standard support', 'Basic analytics', 'Standard placement'],
  gold: [
    '20 Product listings',
    'Priority email support',
    'Promotional badges',
    'Advanced analytics',
    'Featured placement 2x/week',
    'Customer insights',
  ],
  platinum: [
    'Unlimited Product listings',
    '24/7 priority support',
    'Promotional badges',
    'Premium analytics',
    'Daily featured placement',
    'Customer insights',
    'Dedicated account manager',
  ],
};

export default function MerchantDashboardPage() {
  const { user } = useAuth();
  const [merchant, setMerchant] = useState<MerchantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'features' | 'billing'>('features');
  const [billing, setBilling] = useState<BillingRecord[]>([]);
  const [billingLoaded, setBillingLoaded] = useState(false);

  useEffect(() => {
    const fetchMerchantData = async () => {
      try {
        const token = getToken();
        if (!token) return;

        const res = await fetch(`${API}/api/merchants/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const merchantData = await res.json();
        setMerchant(merchantData);
      } catch (error) {
        console.error('Error fetching merchant data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMerchantData();
  }, [user]);

  useEffect(() => {
    if (activeTab !== 'billing' || billingLoaded) return;
    const fetchBilling = async () => {
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch(`${API}/api/subscriptions/history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setBilling(await res.json());
      } catch (error) {
        console.error('Error fetching billing history:', error);
      } finally {
        setBillingLoaded(true);
      }
    };
    fetchBilling();
  }, [activeTab, billingLoaded]);

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  const subscriptionTier = merchant?.subscription_tier || 'basic';
  const subscriptionPlan = merchant?.subscription_plan || 'monthly';
  const isActive = merchant?.is_active || false;
  const subscriptionStatus = merchant?.subscription_status || 'active';
  const planDays = PLAN_DAYS[subscriptionPlan] || 30;

  const startDate = merchant?.subscription_started_at
    ? new Date(merchant.subscription_started_at)
    : null;
  const renewalDate = merchant?.subscription_expires_at
    ? new Date(merchant.subscription_expires_at)
    : null;

  const daysRemaining = renewalDate
    ? Math.max(
        0,
        Math.ceil((renewalDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      )
    : 0;
  const isExpired = renewalDate ? renewalDate.getTime() < Date.now() : false;

  return (
    <div className="space-y-6">
      {/* Header with Gradient Background */}
      <div className="bg-gradient-to-r from-red-600 to-purple-600 rounded-lg p-8 text-white relative">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">Merchant Dashboard</h1>
            <p className="text-red-100">Welcome back! Here's your subscription overview</p>
          </div>
          <Link
            href="/merchant/subscription/upgrade"
            className="bg-white text-red-600 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            Upgrade Plan
          </Link>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Quick Actions</h2>
        <p className="text-gray-600 mb-4">Access frequently used features</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Link
            href="/merchant/products/new"
            className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors text-center font-medium"
          >
            Add Product/Service
          </Link>
          <Link
            href="/merchant/orders"
            className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors text-center font-medium"
          >
            View Orders
          </Link>
          <Link
            href="/merchant/discounts"
            className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors text-center font-medium"
          >
            Manage Discounts
          </Link>
          <Link
            href="/merchant/inventory"
            className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors text-center font-medium"
          >
            Inventory
          </Link>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Subscription Plan Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 8h10M5 8V5m14 0v3m-2-3h-6m6 0v3m-2 0h-6m6 0v3m-2 0h-6" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 capitalize">{subscriptionTier} Plan</h3>
                  <p className="text-sm text-gray-600 capitalize">{subscriptionPlan} subscription</p>
                </div>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${
                  isExpired || subscriptionStatus === 'expired'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-green-100 text-green-800'
                }`}
              >
                {isExpired ? 'Expired' : subscriptionStatus}
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Start Date:</span>
                <span className="font-medium">
                  {startDate ? startDate.toLocaleDateString() : '—'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Renewal Date:</span>
                <span className="font-medium">
                  {renewalDate ? renewalDate.toLocaleDateString() : '—'}
                </span>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600">Days Remaining</span>
                  <span className="font-medium">{daysRemaining} days</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${isExpired ? 'bg-red-500' : 'bg-blue-600'}`}
                    style={{ width: `${Math.min(100, (daysRemaining / planDays) * 100)}%` }}
                  ></div>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Auto-renewal</span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    merchant?.auto_renew ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {merchant?.auto_renew ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              {(isExpired || daysRemaining <= 7) && (
                <Link
                  href="/merchant/subscription/upgrade"
                  className="block text-center bg-red-600 text-white py-2 rounded-lg font-medium hover:bg-red-700 transition-colors mt-2"
                >
                  {isExpired ? 'Renew Now' : 'Renew / Upgrade'}
                </Link>
              )}
            </div>
          </div>

          {/* Ad Visibility Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Ad Visibility</h3>
              <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">Visible</span>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Impressions</span>
                  <span className="text-lg font-bold text-gray-900">12,453</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Clicks</span>
                  <span className="text-lg font-bold text-gray-900">847</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Store Status Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Store Status</h3>
              <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">Online</span>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-600 mb-1">Store Name</p>
                <p className="font-medium text-gray-900">{merchant?.name || 'The Garden Cafe'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Status</p>
                <p className="font-medium text-gray-900">Accepting orders</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Store Active</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" defaultChecked={isActive} />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Listings Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Listings</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Used</span>
                <span className="text-lg font-bold text-gray-900">15 / 20</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-red-600 h-2 rounded-full" style={{ width: '75%' }}></div>
              </div>
              <p className="text-sm text-gray-600">79% used</p>
            </div>
          </div>

          {/* This Month Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">This Month</h3>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Views</span>
                  <span className="text-lg font-bold text-gray-900">1,243</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Orders</span>
                  <span className="text-lg font-bold text-gray-900">20</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Plan Features Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <div className="flex space-x-4 px-6">
            <button
              onClick={() => setActiveTab('features')}
              className={`px-4 py-3 font-medium ${
                activeTab === 'features'
                  ? 'text-red-600 border-b-2 border-red-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Plan Features
            </button>
            <button
              onClick={() => setActiveTab('billing')}
              className={`px-4 py-3 font-medium ${
                activeTab === 'billing'
                  ? 'text-red-600 border-b-2 border-red-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Billing History
            </button>
          </div>
        </div>

        {activeTab === 'features' && (
          <div className="p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Your Plan Features</h3>
            <p className="text-gray-600 mb-6">Available features with your {subscriptionTier} subscription</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(TIER_FEATURES[subscriptionTier] || TIER_FEATURES.basic).map((feature) => (
                <div key={feature} className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-700">{feature}</span>
                </div>
              ))}
            </div>
            {subscriptionTier !== 'platinum' && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <p className="text-gray-700">
                  Want more features?{' '}
                  <Link href="/merchant/subscription/upgrade" className="text-red-600 font-semibold hover:underline">
                    Upgrade your plan
                  </Link>{' '}
                  for more listings and premium support.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Billing History</h3>
            {!billingLoaded ? (
              <p className="text-gray-500">Loading...</p>
            ) : billing.length === 0 ? (
              <p className="text-gray-500">No billing records yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Plan</th>
                      <th className="py-2 pr-4">Method</th>
                      <th className="py-2 pr-4">Amount</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.map((b) => (
                      <tr key={b.id} className="border-b border-gray-100">
                        <td className="py-3 pr-4">{new Date(b.created_at).toLocaleDateString()}</td>
                        <td className="py-3 pr-4 capitalize">{b.tier} · {b.plan}</td>
                        <td className="py-3 pr-4 capitalize">{b.payment_method}</td>
                        <td className="py-3 pr-4">₱{Number(b.amount).toLocaleString()}</td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${
                              b.status === 'paid'
                                ? 'bg-green-100 text-green-800'
                                : b.status === 'rejected'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {b.status === 'paid' ? 'Paid' : b.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
