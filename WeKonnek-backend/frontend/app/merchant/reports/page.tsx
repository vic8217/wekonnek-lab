'use client';

import { useState } from 'react';

interface ChartPoint {
  label: string;
  value: number;
}

const SALES_TREND: ChartPoint[] = [
  { label: 'Jun', value: 68200 },
  { label: 'Jul', value: 74500 },
  { label: 'Aug', value: 61300 },
  { label: 'Sep', value: 88900 },
  { label: 'Oct', value: 95600 },
  { label: 'Nov', value: 107100 },
];

const ORDERS_BY_RANGE: Record<'year' | 'month' | 'week', ChartPoint[]> = {
  year: [
    { label: 'Jan', value: 210 },
    { label: 'Feb', value: 245 },
    { label: 'Mar', value: 198 },
    { label: 'Apr', value: 276 },
    { label: 'May', value: 312 },
    { label: 'Jun', value: 289 },
    { label: 'Jul', value: 334 },
    { label: 'Aug', value: 301 },
    { label: 'Sep', value: 358 },
    { label: 'Oct', value: 377 },
    { label: 'Nov', value: 366 },
    { label: 'Dec', value: 402 },
  ],
  month: [
    { label: 'Week 1', value: 84 },
    { label: 'Week 2', value: 97 },
    { label: 'Week 3', value: 79 },
    { label: 'Week 4', value: 106 },
  ],
  week: [
    { label: 'Mon', value: 42 },
    { label: 'Tue', value: 38 },
    { label: 'Wed', value: 51 },
    { label: 'Thu', value: 47 },
    { label: 'Fri', value: 63 },
    { label: 'Sat', value: 71 },
    { label: 'Sun', value: 54 },
  ],
};

export default function ReportsPage() {
  const [fromDate, setFromDate] = useState('2025-11-29');
  const [toDate, setToDate] = useState('2025-11-29');
  const [reportType, setReportType] = useState('combined');
  const [fileFormat, setFileFormat] = useState('excel');
  const [timeRange, setTimeRange] = useState<'year' | 'month' | 'week'>('month');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Sales & Inventory Reports</h1>
        <p className="text-gray-600">Export detailed reports for accounting, audit, and business analysis</p>
      </div>

      {/* Report Generation Card */}
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Current Inventory Status</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            >
              <option value="combined">Combined Report</option>
              <option value="sales">Sales Report</option>
              <option value="inventory">Inventory Report</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">File Format</label>
            <select
              value={fileFormat}
              onChange={(e) => setFileFormat(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            >
              <option value="excel">Excel (.xlsx)</option>
              <option value="pdf">PDF</option>
              <option value="csv">CSV</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors font-medium">
            Download Report
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-8">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">366</p>
                <p className="text-gray-600 text-sm mt-1">Total Orders</p>
              </div>
              <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">₱107,100</p>
                <p className="text-gray-600 text-sm mt-1">Total Revenue</p>
              </div>
              <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">196</p>
                <p className="text-gray-600 text-sm mt-1">Items Sold</p>
              </div>
              <svg className="w-10 h-10 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-red-600">1</p>
                <p className="text-gray-600 text-sm mt-1">Low Stock Items</p>
              </div>
              <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Trend Chart */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Sales Trend (6 Months)</h3>
          <SalesTrendChart data={SALES_TREND} />
          <div className="mt-4 flex items-center justify-center gap-2">
            <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
            <span className="text-sm text-gray-600">Revenue (₱)</span>
          </div>
        </div>

        {/* Monthly Orders Chart */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">Monthly Orders</h3>
            <div className="flex gap-2">
              {['Year', 'Month', 'Week'].map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range.toLowerCase() as any)}
                  className={`px-3 py-1 rounded text-sm font-medium ${
                    timeRange === range.toLowerCase()
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <MonthlyOrdersChart data={ORDERS_BY_RANGE[timeRange]} />
          <div className="mt-4 flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-[#DB0002] rounded-full"></div>
              <span className="text-sm text-gray-600">Orders</span>
            </div>
          </div>
        </div>
      </div>

      {/* Inventory Status Table */}
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Current Inventory Status</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Product Name</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">SKU</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Opening</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Sold</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Returns</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Closing</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Premium Coffee Beans', sku: 'PCB-001', opening: 150, sold: 45, returns: 2, closing: 107, status: 'In Stock' },
                { name: 'Organic Green Tea', sku: 'OGT-002', opening: 200, sold: 62, returns: 1, closing: 139, status: 'In Stock' },
                { name: 'Dark Chocolate Bar', sku: 'DCB-003', opening: 180, sold: 38, returns: 0, closing: 142, status: 'In Stock' },
                { name: 'Honey Jar 500g', sku: 'HNY-004', opening: 120, sold: 51, returns: 3, closing: 72, status: 'Low Stock' },
              ].map((item, index) => (
                <tr key={index} className="border-b border-gray-200">
                  <td className="px-4 py-3 text-gray-900">{item.name}</td>
                  <td className="px-4 py-3 text-gray-600">{item.sku}</td>
                  <td className="px-4 py-3 text-gray-900">{item.opening}</td>
                  <td className="px-4 py-3 text-gray-900">{item.sold}</td>
                  <td className="px-4 py-3 text-gray-900">{item.returns}</td>
                  <td className="px-4 py-3 text-gray-900">{item.closing}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                      item.status === 'In Stock' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Sales Trend line chart (pure SVG, no dependency) ───────────────
function SalesTrendChart({ data }: { data: ChartPoint[] }) {
  const width = 600;
  const height = 256;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const rawMax = Math.max(...data.map((d) => d.value), 1);
  const niceMax = Math.ceil(rawMax / 10000) * 10000;
  const baseline = padT + plotH;

  const x = (i: number) =>
    data.length <= 1 ? padL + plotW / 2 : padL + (i / (data.length - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;

  const linePts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const areaPts = `${x(0)},${baseline} ${linePts} ${x(data.length - 1)},${baseline}`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>

      {gridLines.map((g, i) => {
        const gy = padT + plotH - g * plotH;
        return (
          <g key={i}>
            <line x1={padL} y1={gy} x2={width - padR} y2={gy} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padL - 8} y={gy + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
              ₱{Math.round((niceMax * g) / 1000)}k
            </text>
          </g>
        );
      })}

      <polygon points={areaPts} fill="url(#salesFill)" />
      <polyline
        points={linePts}
        fill="none"
        stroke="#2563eb"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.value)} r={3.5} fill="#fff" stroke="#2563eb" strokeWidth={2} />
          <text x={x(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="#64748b">
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─── Monthly Orders bar chart (pure CSS, no dependency) ─────────────
function MonthlyOrdersChart({ data }: { data: ChartPoint[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex gap-2 h-64">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="relative w-full flex justify-center flex-1">
              <div
                className="w-full max-w-[40px] rounded-t-lg bg-gradient-to-t from-[#DB0002] to-[#FF4444] transition-all duration-300 group-hover:from-[#B80002] group-hover:to-[#DB0002] mt-auto"
                style={{ height: `${Math.max(pct, 4)}%` }}
              >
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {d.value.toLocaleString()}
                </div>
              </div>
            </div>
            <span className="text-[9px] lg:text-xs text-gray-400 font-medium">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
