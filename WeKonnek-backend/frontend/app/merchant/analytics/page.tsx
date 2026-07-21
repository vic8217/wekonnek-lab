'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type Period = 'today' | 'week' | 'month' | 'year' | 'custom';

interface KPI {
  label: string;
  value: string;
  change: number;
  changeLabel: string;
  icon: string;
}

interface TopProduct {
  rank: number;
  name: string;
  unitsSold: number;
  revenue: number;
}

interface ActivityEvent {
  id: number;
  type: 'order' | 'review' | 'booking' | 'payout' | 'promo';
  message: string;
  timestamp: string;
}

interface DailyRevenue {
  label: string;
  value: number;
}

interface AnalyticsData {
  kpis: KPI[];
  dailyRevenue: DailyRevenue[];
  topProducts: TopProduct[];
  orderBreakdown: { completed: number; pending: number; cancelled: number };
  customers: { newCount: number; returningCount: number };
  peakHours: number[][];
  recentActivity: ActivityEvent[];
}

function buildMockData(period: Period): AnalyticsData {
  const multiplier = period === 'today' ? 1 : period === 'week' ? 7 : period === 'month' ? 30 : 365;

  const baseRevenue = 12450;
  const totalRevenue = baseRevenue * (multiplier * 0.8 + Math.random() * multiplier * 0.4);
  const ordersCount = Math.round(28 * multiplier * (0.8 + Math.random() * 0.4));
  const avgOrderValue = totalRevenue / ordersCount;

  const kpis: KPI[] = [
    {
      label: 'Total Revenue',
      value: `₱${Math.round(totalRevenue).toLocaleString()}`,
      change: 12.5,
      changeLabel: 'vs last period',
      icon: '💰',
    },
    {
      label: 'Orders Count',
      value: ordersCount.toLocaleString(),
      change: 8.3,
      changeLabel: 'vs last period',
      icon: '📦',
    },
    {
      label: 'Avg Order Value',
      value: `₱${Math.round(avgOrderValue).toLocaleString()}`,
      change: -2.1,
      changeLabel: 'vs last period',
      icon: '📊',
    },
    {
      label: 'Customer Rating',
      value: '4.7',
      change: 0.3,
      changeLabel: 'vs last period',
      icon: '⭐',
    },
  ];

  const dayLabels = period === 'today'
    ? ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM', '12AM']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const dailyRevenue: DailyRevenue[] = dayLabels.map(label => ({
    label,
    value: Math.round(2000 + Math.random() * 14000),
  }));

  const topProducts: TopProduct[] = [
    { rank: 1, name: 'Chicken Adobo Combo', unitsSold: 342, revenue: 51300 },
    { rank: 2, name: 'Sinigang na Baboy Set', unitsSold: 287, revenue: 43050 },
    { rank: 3, name: 'Kare-Kare Family Platter', unitsSold: 198, revenue: 39600 },
    { rank: 4, name: 'Lechon Kawali Rice Bowl', unitsSold: 176, revenue: 26400 },
    { rank: 5, name: 'Halo-Halo Special', unitsSold: 156, revenue: 15600 },
  ];

  const orderBreakdown = {
    completed: Math.round(ordersCount * 0.78),
    pending: Math.round(ordersCount * 0.12),
    cancelled: Math.round(ordersCount * 0.10),
  };

  const totalCustomers = Math.round(ordersCount * 0.7);
  const customers = {
    newCount: Math.round(totalCustomers * 0.35),
    returningCount: Math.round(totalCustomers * 0.65),
  };

  // Peak hours: rows = hours (6AM-11PM), cols = days (Mon-Sun)
  const peakHours: number[][] = [];
  for (let h = 0; h < 18; h++) {
    const row: number[] = [];
    for (let d = 0; d < 7; d++) {
      const isLunch = h >= 5 && h <= 7;
      const isDinner = h >= 11 && h <= 14;
      const isWeekend = d >= 5;
      let base = Math.random() * 3;
      if (isLunch) base += 4 + Math.random() * 3;
      if (isDinner) base += 5 + Math.random() * 4;
      if (isWeekend) base += 2;
      row.push(Math.min(Math.round(base), 10));
    }
    peakHours.push(row);
  }

  const recentActivity: ActivityEvent[] = [
    { id: 1, type: 'order', message: 'New order #WK-4521 from Maria Santos — ₱785.00', timestamp: '2026-06-29T14:32:00Z' },
    { id: 2, type: 'review', message: 'Ana Reyes left a 5-star review: "Best adobo in town!"', timestamp: '2026-06-29T14:15:00Z' },
    { id: 3, type: 'order', message: 'Order #WK-4520 completed — ₱1,250.00', timestamp: '2026-06-29T13:48:00Z' },
    { id: 4, type: 'booking', message: 'Booking BK-1009 confirmed for Teresa Bautista (10 guests)', timestamp: '2026-06-29T13:30:00Z' },
    { id: 5, type: 'order', message: 'New order #WK-4519 from Pedro Garcia — ₱450.00', timestamp: '2026-06-29T13:12:00Z' },
    { id: 6, type: 'promo', message: '"Summer Special" promo redeemed 12 times today', timestamp: '2026-06-29T12:45:00Z' },
    { id: 7, type: 'review', message: 'Juan dela Cruz left a 4-star review', timestamp: '2026-06-29T12:20:00Z' },
    { id: 8, type: 'payout', message: 'Weekly payout processed: ₱45,320.00', timestamp: '2026-06-29T12:00:00Z' },
    { id: 9, type: 'order', message: 'Order #WK-4518 cancelled by customer', timestamp: '2026-06-29T11:35:00Z' },
    { id: 10, type: 'booking', message: 'New booking request from Carlos Villanueva (5 guests)', timestamp: '2026-06-29T11:10:00Z' },
  ];

  return { kpis, dailyRevenue, topProducts, orderBreakdown, customers, peakHours, recentActivity };
}

export default function MerchantAnalyticsPage() {
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [showCustom, setShowCustom] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      if (!token) throw new Error('No token');
      const res = await fetch(`${API}/api/analytics/merchant?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('API error');
      const apiData = await res.json();
      setData(apiData);
    } catch {
      setData(buildMockData(period));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const formatRelativeTime = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const eventIcon: Record<ActivityEvent['type'], { bg: string; emoji: string }> = {
    order: { bg: 'bg-blue-100', emoji: '📦' },
    review: { bg: 'bg-yellow-100', emoji: '⭐' },
    booking: { bg: 'bg-purple-100', emoji: '📅' },
    payout: { bg: 'bg-green-100', emoji: '💳' },
    promo: { bg: 'bg-pink-100', emoji: '🏷️' },
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  const maxRevenue = Math.max(...data.dailyRevenue.map(d => d.value));
  const totalOrders = data.orderBreakdown.completed + data.orderBreakdown.pending + data.orderBreakdown.cancelled;
  const totalCustomers = data.customers.newCount + data.customers.returningCount;
  const peakHourLabels = Array.from({ length: 18 }, (_, i) => {
    const h = i + 6;
    return h <= 12 ? `${h}${h < 12 ? 'a' : 'p'}` : `${h - 12}p`;
  });
  const dayLabelsShort = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header + Period Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-3xl font-bold text-gray-900">Analytics</h1>
          <p className="text-xs lg:text-sm text-gray-500">Track your business performance</p>
        </div>
        <div className="flex items-center gap-1.5 bg-gray-100 rounded-lg p-1">
          {([
            { key: 'today' as Period, label: 'Today' },
            { key: 'week' as Period, label: 'Week' },
            { key: 'month' as Period, label: 'Month' },
            { key: 'year' as Period, label: 'Year' },
            { key: 'custom' as Period, label: 'Custom' },
          ]).map(p => (
            <button
              key={p.key}
              onClick={() => {
                if (p.key === 'custom') { setShowCustom(!showCustom); return; }
                setShowCustom(false);
                setPeriod(p.key);
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                period === p.key && p.key !== 'custom'
                  ? 'bg-white shadow text-gray-900'
                  : showCustom && p.key === 'custom'
                  ? 'bg-white shadow text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Range Picker */}
      {showCustom && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">From</label>
            <input
              type="date"
              value={customRange.from}
              onChange={e => setCustomRange(p => ({ ...p, from: e.target.value }))}
              className="block mt-0.5 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">To</label>
            <input
              type="date"
              value={customRange.to}
              onChange={e => setCustomRange(p => ({ ...p, to: e.target.value }))}
              className="block mt-0.5 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30"
            />
          </div>
          <button
            onClick={() => { setPeriod('custom'); setShowCustom(false); }}
            className="px-4 py-1.5 bg-[#DB0002] text-white rounded-lg text-sm font-semibold hover:bg-[#B80002] transition-colors"
          >
            Apply
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
        {data.kpis.map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 lg:p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-lg">{kpi.icon}</span>
              <span className={`text-[10px] lg:text-xs font-bold px-2 py-0.5 rounded-full ${
                kpi.change >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                {kpi.change >= 0 ? '+' : ''}{kpi.change}%
              </span>
            </div>
            <p className="text-xl lg:text-2xl font-black text-gray-900">{kpi.value}</p>
            <p className="text-[10px] lg:text-xs text-gray-400 mt-0.5">{kpi.label}</p>
            <p className="text-[9px] text-gray-300">{kpi.changeLabel}</p>
          </div>
        ))}
      </div>

      {/* Revenue Chart */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 lg:p-6">
        <h2 className="text-sm lg:text-base font-bold text-gray-900 mb-4">Revenue Overview</h2>
        <div className="flex gap-2 lg:gap-4 h-48 lg:h-64">
          {data.dailyRevenue.map((bar, i) => {
            const pct = maxRevenue > 0 ? (bar.value / maxRevenue) * 100 : 0;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="relative w-full flex justify-center flex-1">
                  <div
                    className="w-full max-w-[48px] rounded-t-lg bg-gradient-to-t from-[#DB0002] to-[#FF4444] transition-all duration-300 group-hover:from-[#B80002] group-hover:to-[#DB0002] relative mt-auto"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  >
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[9px] lg:text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      ₱{bar.value.toLocaleString()}
                    </div>
                  </div>
                </div>
                <span className="text-[9px] lg:text-xs text-gray-400 font-medium">{bar.label}</span>
                <span className="text-[8px] lg:text-[10px] text-gray-300 font-semibold hidden lg:block">
                  ₱{(bar.value / 1000).toFixed(1)}k
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* Top Products */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 lg:p-6">
          <h2 className="text-sm lg:text-base font-bold text-gray-900 mb-4">Top Products</h2>
          <div className="space-y-3">
            {data.topProducts.map(p => {
              const maxUnits = data.topProducts[0].unitsSold;
              const pct = (p.unitsSold / maxUnits) * 100;
              return (
                <div key={p.rank} className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                    p.rank === 1 ? 'bg-amber-100 text-amber-700' :
                    p.rank === 2 ? 'bg-gray-100 text-gray-600' :
                    p.rank === 3 ? 'bg-orange-100 text-orange-700' :
                    'bg-gray-50 text-gray-400'
                  }`}>
                    {p.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs lg:text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                      <p className="text-xs font-bold text-gray-700 flex-shrink-0 ml-2">₱{p.revenue.toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-[#DB0002] h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{p.unitsSold} sold</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Order Status Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 lg:p-6">
          <h2 className="text-sm lg:text-base font-bold text-gray-900 mb-4">Order Status Breakdown</h2>
          <div className="space-y-4">
            {[
              { label: 'Completed', count: data.orderBreakdown.completed, color: 'bg-green-500', textColor: 'text-green-700' },
              { label: 'Pending', count: data.orderBreakdown.pending, color: 'bg-orange-500', textColor: 'text-orange-700' },
              { label: 'Cancelled', count: data.orderBreakdown.cancelled, color: 'bg-red-500', textColor: 'text-red-700' },
            ].map(item => {
              const pct = totalOrders > 0 ? (item.count / totalOrders) * 100 : 0;
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs lg:text-sm font-semibold text-gray-700">{item.label}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${item.textColor}`}>{item.count}</span>
                      <span className="text-[10px] text-gray-400">({pct.toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="bg-gray-100 rounded-full h-3">
                    <div className={`${item.color} h-3 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {/* Stacked summary bar */}
            <div className="mt-2 pt-3 border-t border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Overall</p>
              <div className="flex rounded-full h-4 overflow-hidden">
                <div className="bg-green-500" style={{ width: `${(data.orderBreakdown.completed / totalOrders) * 100}%` }} />
                <div className="bg-orange-500" style={{ width: `${(data.orderBreakdown.pending / totalOrders) * 100}%` }} />
                <div className="bg-red-500" style={{ width: `${(data.orderBreakdown.cancelled / totalOrders) * 100}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{totalOrders.toLocaleString()} total orders</p>
            </div>
          </div>
        </div>
      </div>

      {/* Customer Insights */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 lg:p-6">
        <h2 className="text-sm lg:text-base font-bold text-gray-900 mb-4">Customer Insights</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          {/* New vs Returning */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">New vs Returning</p>
            <div className="flex rounded-full h-6 overflow-hidden mb-2">
              <div
                className="bg-[#DB0002] flex items-center justify-center"
                style={{ width: `${totalCustomers > 0 ? (data.customers.newCount / totalCustomers) * 100 : 0}%` }}
              >
                <span className="text-[9px] font-bold text-white">{totalCustomers > 0 ? Math.round((data.customers.newCount / totalCustomers) * 100) : 0}%</span>
              </div>
              <div
                className="bg-blue-500 flex items-center justify-center"
                style={{ width: `${totalCustomers > 0 ? (data.customers.returningCount / totalCustomers) * 100 : 0}%` }}
              >
                <span className="text-[9px] font-bold text-white">{totalCustomers > 0 ? Math.round((data.customers.returningCount / totalCustomers) * 100) : 0}%</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded bg-[#DB0002]" />
                <span className="text-gray-600">New ({data.customers.newCount})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded bg-blue-500" />
                <span className="text-gray-600">Returning ({data.customers.returningCount})</span>
              </div>
            </div>
          </div>

          {/* Peak Hours Heatmap */}
          <div className="lg:col-span-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Peak Hours</p>
            <div className="overflow-x-auto">
              <div className="min-w-[300px]">
                {/* Day labels */}
                <div className="flex ml-8 mb-1">
                  {dayLabelsShort.map((d, i) => (
                    <div key={i} className="flex-1 text-center text-[9px] font-bold text-gray-400">{d}</div>
                  ))}
                </div>
                {/* Heatmap grid */}
                <div className="space-y-0.5">
                  {data.peakHours.filter((_, i) => i % 2 === 0).map((row, ri) => (
                    <div key={ri} className="flex items-center gap-0.5">
                      <span className="w-7 text-[8px] lg:text-[9px] text-gray-400 font-medium text-right flex-shrink-0">
                        {peakHourLabels[ri * 2]}
                      </span>
                      {row.map((val, ci) => {
                        const intensity = val / 10;
                        return (
                          <div
                            key={ci}
                            className="flex-1 aspect-square rounded-sm transition-colors"
                            style={{
                              backgroundColor: intensity > 0.7
                                ? `rgba(219, 0, 2, ${0.3 + intensity * 0.7})`
                                : intensity > 0.3
                                ? `rgba(251, 146, 60, ${0.2 + intensity * 0.5})`
                                : `rgba(229, 231, 235, ${0.3 + intensity * 0.4})`,
                            }}
                            title={`${peakHourLabels[ri * 2]}, ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][ci]}: ${val} orders`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
                {/* Legend */}
                <div className="flex items-center justify-end gap-1 mt-2">
                  <span className="text-[8px] text-gray-400">Low</span>
                  {[0.1, 0.3, 0.5, 0.7, 0.9].map(v => (
                    <div
                      key={v}
                      className="w-3 h-3 rounded-sm"
                      style={{
                        backgroundColor: v > 0.7
                          ? `rgba(219, 0, 2, ${0.3 + v * 0.7})`
                          : v > 0.3
                          ? `rgba(251, 146, 60, ${0.2 + v * 0.5})`
                          : `rgba(229, 231, 235, ${0.3 + v * 0.4})`,
                      }}
                    />
                  ))}
                  <span className="text-[8px] text-gray-400">High</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Ordering Times */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 lg:p-6">
          <h2 className="text-sm lg:text-base font-bold text-gray-900 mb-3">Top Ordering Times</h2>
          <div className="space-y-2.5">
            {[
              { time: '12:00 PM - 1:00 PM', label: 'Lunch Rush', pct: 92 },
              { time: '6:00 PM - 7:00 PM', label: 'Dinner Peak', pct: 88 },
              { time: '7:00 PM - 8:00 PM', label: 'Late Dinner', pct: 75 },
              { time: '11:00 AM - 12:00 PM', label: 'Pre-Lunch', pct: 58 },
              { time: '8:00 PM - 9:00 PM', label: 'Evening', pct: 42 },
            ].map(slot => (
              <div key={slot.time}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-700">{slot.time}</span>
                  <span className="text-[10px] text-gray-400">{slot.label}</span>
                </div>
                <div className="bg-gray-100 rounded-full h-2">
                  <div className="bg-[#DB0002] h-2 rounded-full" style={{ width: `${slot.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-4 lg:p-6">
          <h2 className="text-sm lg:text-base font-bold text-gray-900 mb-4">Recent Activity</h2>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {data.recentActivity.map(event => {
              const icon = eventIcon[event.type];
              return (
                <div key={event.id} className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${icon.bg}`}>
                    <span className="text-sm">{icon.emoji}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs lg:text-sm text-gray-700">{event.message}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{formatRelativeTime(event.timestamp)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
