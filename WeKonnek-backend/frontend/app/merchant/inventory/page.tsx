'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, getToken } from '@/hooks/use-auth';
import { productsApi, Product, Category } from '@/lib/api';
import toast from 'react-hot-toast';
import ProductCsvTools from '@/components/ProductCsvTools';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
import Link from 'next/link';

interface ProductWithStatus extends Product {
  status: 'active' | 'low_stock' | 'out_of_stock';
}

export default function InventoryManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<ProductWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingThresholdId, setEditingThresholdId] = useState<number | null>(null);
  const [thresholdValue, setThresholdValue] = useState<number>(10);
  const [savingThresholdId, setSavingThresholdId] = useState<number | null>(null);
  const itemsPerPage = 10;

  const filterParam = searchParams.get('filter');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const token = getToken();
      if (!token) {
        router.push('/auth/login');
        return;
      }

      const res = await fetch(`${API}/api/merchants/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setProducts([]);
        return;
      }
      const merchantData = await res.json();
      const merchantId = merchantData.id;

      const allProducts = await productsApi.getAll();
      const merchantProducts = allProducts.filter((p: Product) => p.merchantId === merchantId);
      
      const productsWithStatus: ProductWithStatus[] = merchantProducts.map((product: Product) => ({
        ...product,
        status: getProductStatus(product),
      }));

      setProducts(productsWithStatus);
    } catch (error) {
      console.error('Error fetching products:', error);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const getProductStatus = (product: Product | { quantity: number; isAvailable: boolean; lowStockThreshold?: number }): 'active' | 'low_stock' | 'out_of_stock' => {
    const quantity = product.quantity;
    const isAvailable = product.isAvailable;
    const threshold = ('lowStockThreshold' in product && product.lowStockThreshold != null)
      ? product.lowStockThreshold
      : 10;

    if (!isAvailable || quantity === 0) {
      return 'out_of_stock';
    } else if (quantity <= threshold) {
      return 'low_stock';
    } else {
      return 'active';
    }
  };

  const lowStockProducts = products.filter((p) => p.status === 'low_stock');

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this product?')) {
      return;
    }

    try {
      setDeletingId(id);
      await productsApi.delete(id);
      toast.success('Product deleted successfully');
      fetchProducts();
    } catch (error: any) {
      console.error('Error deleting product:', error);
      toast.error(error.message || 'Failed to delete product');
    } finally {
      setDeletingId(null);
    }
  };

  const handleThresholdSave = async (productId: number) => {
    try {
      setSavingThresholdId(productId);
      const token = getToken();
      if (!token) return;

      const res = await fetch(`${API}/api/products/${productId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lowStockThreshold: thresholdValue }),
      });

      if (!res.ok) {
        throw new Error('Failed to update threshold');
      }

      toast.success('Low stock threshold updated');
      setEditingThresholdId(null);
      fetchProducts();
    } catch (error: any) {
      console.error('Error updating threshold:', error);
      toast.error(error.message || 'Failed to update threshold');
    } finally {
      setSavingThresholdId(null);
    }
  };

  const displayProducts = filterParam === 'low_stock'
    ? products.filter((p) => p.status === 'low_stock')
    : products;

  const filteredProducts = displayProducts.filter(product =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    product.category?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    product.productCode.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'low_stock':
        return 'bg-yellow-100 text-yellow-800';
      case 'out_of_stock':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'low_stock':
        return 'Low Stock';
      case 'out_of_stock':
        return 'Out of Stock';
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Loading inventory...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Low Stock Alert Banner */}
      {lowStockProducts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <div className="flex-shrink-0">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-red-800 font-semibold">
              {lowStockProducts.length} product{lowStockProducts.length !== 1 ? 's are' : ' is'} low on stock
            </p>
            <p className="text-red-600 text-sm mt-0.5">
              {lowStockProducts.map((p) => p.name).slice(0, 3).join(', ')}
              {lowStockProducts.length > 3 && ` and ${lowStockProducts.length - 3} more`}
            </p>
          </div>
          {filterParam !== 'low_stock' && (
            <Link
              href="/merchant/inventory?filter=low_stock"
              className="flex-shrink-0 text-sm font-medium text-red-700 hover:text-red-900 underline"
            >
              View all
            </Link>
          )}
          {filterParam === 'low_stock' && (
            <Link
              href="/merchant/inventory"
              className="flex-shrink-0 text-sm font-medium text-red-700 hover:text-red-900 underline"
            >
              Show all products
            </Link>
          )}
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Products</h1>
        <p className="text-gray-600">
          {filterParam === 'low_stock' ? 'Showing low-stock products only' : 'Manage your products and services'}
        </p>
      </div>

      {/* Product List Card */}
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Product List</h2>
          <p className="text-sm text-gray-600">View and manage your inventory</p>
        </div>

        {/* Search Bar and Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ProductCsvTools onImported={fetchProducts} />
            <Link
              href="/merchant/products/new"
              className="bg-[#DB0002] text-white px-3 py-2 rounded-lg hover:bg-[#B80002] transition-colors flex items-center gap-1.5 font-medium text-sm whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Product
            </Link>
          </div>
        </div>

        {/* Product Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#DB0002] text-white">
                <th className="px-4 py-3 text-left font-semibold">Product Name</th>
                <th className="px-4 py-3 text-left font-semibold">Category</th>
                <th className="px-4 py-3 text-left font-semibold">Quantity</th>
                <th className="px-4 py-3 text-left font-semibold">Low Threshold</th>
                <th className="px-4 py-3 text-left font-semibold">Price</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    {searchQuery ? 'No products found matching your search' : 'No products found. Add your first product to get started.'}
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((product) => {
                  const threshold = product.lowStockThreshold ?? 10;
                  return (
                    <tr key={product.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 font-medium text-gray-900">{product.name}</td>
                      <td className="px-4 py-4 text-gray-600">{product.category?.name || 'Uncategorized'}</td>
                      <td className={`px-4 py-4 font-medium ${
                        product.quantity === 0 
                          ? 'text-red-600' 
                          : product.quantity <= threshold
                          ? 'text-yellow-600' 
                          : 'text-gray-900'
                      }`}>
                        {product.quantity}
                      </td>
                      <td className="px-4 py-4">
                        {editingThresholdId === product.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              value={thresholdValue}
                              onChange={(e) => setThresholdValue(Math.max(0, parseInt(e.target.value) || 0))}
                              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleThresholdSave(product.id);
                                if (e.key === 'Escape') setEditingThresholdId(null);
                              }}
                            />
                            <button
                              onClick={() => handleThresholdSave(product.id)}
                              disabled={savingThresholdId === product.id}
                              className="text-green-600 hover:text-green-800 disabled:opacity-50"
                              title="Save"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setEditingThresholdId(null)}
                              className="text-gray-400 hover:text-gray-600"
                              title="Cancel"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingThresholdId(product.id);
                              setThresholdValue(threshold);
                            }}
                            className="text-gray-600 hover:text-[#DB0002] transition-colors text-sm flex items-center gap-1 group"
                            title="Click to edit threshold"
                          >
                            {threshold}
                            <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-4 text-gray-900">₱{Number(product.price).toFixed(2)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(product.status)}`}>
                          {getStatusLabel(product.status)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => router.push(`/merchant/products/${product.id}/edit`)}
                            className="text-blue-600 hover:text-blue-800 transition-colors"
                            title="Edit product"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(product.id)}
                            disabled={deletingId === product.id}
                            className="text-red-600 hover:text-red-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Delete product"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex justify-center items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
            >
              Previous
            </button>
            
            {totalPages <= 10 ? (
              Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    currentPage === page
                      ? 'bg-[#DB0002] text-white'
                      : 'border border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {page}
                </button>
              ))
            ) : (
              <>
                {currentPage > 3 && (
                  <>
                    <button
                      onClick={() => setCurrentPage(1)}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      1
                    </button>
                    {currentPage > 4 && <span className="px-2 text-gray-500">...</span>}
                  </>
                )}
                
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let page;
                  if (currentPage <= 3) {
                    page = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    page = totalPages - 4 + i;
                  } else {
                    page = currentPage - 2 + i;
                  }
                  
                  if (page > totalPages) return null;
                  
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        currentPage === page
                          ? 'bg-[#DB0002] text-white'
                          : 'border border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
                
                {currentPage < totalPages - 2 && (
                  <>
                    {currentPage < totalPages - 3 && <span className="px-2 text-gray-500">...</span>}
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      {totalPages}
                    </button>
                  </>
                )}
              </>
            )}
            
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
