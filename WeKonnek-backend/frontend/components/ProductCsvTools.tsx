'use client';

import { useState } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ProductCsvToolsProps {
  /** Called after a successful import so the caller can refresh its data. */
  onImported?: () => void;
  className?: string;
}

export default function ProductCsvTools({ onImported, className }: ProductCsvToolsProps) {
  const [importing, setImporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);

  const handleExport = async () => {
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API}/api/products/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'products.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Products exported successfully');
    } catch (error: unknown) {
      console.error('Export error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to export products');
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      toast.error('Please select a CSV file');
      return;
    }
    try {
      setImporting(true);
      const token = getToken();
      if (!token) return;
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await fetch(`${API}/api/products/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Import failed');
      }
      const result = await res.json();
      setImportResult(result);
      if (result.created > 0) {
        toast.success(`${result.created} product${result.created !== 1 ? 's' : ''} imported`);
        onImported?.();
      }
      if (result.errors?.length > 0) {
        toast.error(`${result.errors.length} row${result.errors.length !== 1 ? 's' : ''} had errors`);
      }
    } catch (error: unknown) {
      console.error('Import error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import products');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const headers = 'name,description,brand,category,subcategory,unit,sellingPrice,costPrice,discountPrice,baseSku,barcode,hasVariants,optionName,optionValues,variantSkus,variantPrices,trackInventory,availabilityStatus';
    const standardRow = 'Sample Product,A standard product,Sample Brand,Main Products,,Piece,99.00,60.00,89.00,SKU-001,123456789,false,,,,,true,Available';
    const variantRow = 'Sample Shirt,A product with size variants,Sample Brand,Apparel,Shirts,Piece,499.00,250.00,,SHIRT,,true,Size,Small|Medium|Large,SHIRT-S|SHIRT-M|SHIRT-L,499|549|599,true,Available';
    const csv = `${headers}\n${standardRow}\n${variantRow}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className={`flex items-center gap-2 flex-wrap ${className ?? ''}`}>
        <button
          type="button"
          onClick={handleExport}
          className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5 font-medium text-sm whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => { setShowImportModal(true); setImportFile(null); setImportResult(null); }}
          className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5 font-medium text-sm whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Import CSV
        </button>
      </div>

      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Import Products from CSV</h3>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800 font-medium mb-1">CSV Format</p>
              <p className="text-xs text-blue-700">
                Required columns: <strong>name</strong>, <strong>unit</strong>, <strong>sellingPrice</strong>, and <strong>availabilityStatus</strong>.
                Optional: description, brand, category, subcategory, costPrice, discountPrice, baseSku, barcode, hasVariants, and trackInventory. When <strong>hasVariants</strong> is true, provide optionName plus matching pipe-separated optionValues, variantSkus, and variantPrices.
              </p>
              <button
                type="button"
                onClick={downloadTemplate}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 underline font-medium"
              >
                Download CSV template
              </button>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              {importFile ? (
                <div className="space-y-2">
                  <svg className="w-8 h-8 text-green-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm font-medium text-gray-900">{importFile.name}</p>
                  <p className="text-xs text-gray-500">{(importFile.size / 1024).toFixed(1)} KB</p>
                  <button
                    type="button"
                    onClick={() => setImportFile(null)}
                    className="text-xs text-red-600 hover:text-red-800 underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer space-y-2 block">
                  <svg className="w-8 h-8 text-gray-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm text-gray-600">
                    <span className="text-[#DB0002] font-medium">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-gray-400">CSV files only</p>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  />
                </label>
              )}
            </div>

            {importResult && (
              <div className={`rounded-lg p-3 ${importResult.errors.length > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
                <p className="text-sm font-medium text-gray-900">
                  {importResult.created} product{importResult.created !== 1 ? 's' : ''} imported successfully
                </p>
                {importResult.errors.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto">
                    {importResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-600">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
              >
                {importResult ? 'Close' : 'Cancel'}
              </button>
              {!importResult && (
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={!importFile || importing}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${
                    importFile && !importing
                      ? 'bg-[#DB0002] text-white hover:bg-[#B80002]'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {importing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {importing ? 'Importing...' : 'Import Products'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
