'use client';

import { useState, useEffect } from 'react';
import { staffPostsApi, StaffPost, merchantsApi } from '@/lib/api';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
import dynamic from 'next/dynamic';

// Dynamically import MapContainer to avoid SSR issues
const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), {
  ssr: false,
});
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), {
  ssr: false,
});
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), {
  ssr: false,
});
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), {
  ssr: false,
});

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  });
}

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [userType, setUserType] = useState<'admin' | 'staff' | null>(null);
  const [activePosts, setActivePosts] = useState<StaffPost[]>([]);
  const [expiredPosts, setExpiredPosts] = useState<StaffPost[]>([]);
  const [stats, setStats] = useState({ activePosts: 0, expiredPosts: 0, totalViews: 0 });
  const [adminStats, setAdminStats] = useState({ totalMerchants: 0, totalUsers: 0, totalPosts: 0, totalRiders: 0, pendingRiders: 0 });
  const [selectedPost, setSelectedPost] = useState<StaffPost | null>(null);
  const [showMapModal, setShowMapModal] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    checkUserType();
  }, []);

  const checkUserType = async () => {
    try {
      const token = getToken();
      if (!token) {
        setUserType('staff');
        await fetchData('staff');
        return;
      }

      const res = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setUserType('staff');
        await fetchData('staff');
        return;
      }
      const profile = await res.json();
      const type = (profile.userType || profile.user_type || 'staff') as 'admin' | 'staff';
      setUserType(type);
      await fetchData(type);
    } catch (error) {
      console.error('Error checking user type:', error);
      setUserType('staff');
      await fetchData('staff');
    }
  };

  const fetchData = async (type: 'admin' | 'staff' | null) => {
    try {
      setLoading(true);
      
      // Fetch stats
      try {
        const statsData = await staffPostsApi.getStats();
        setStats(statsData);
        
        // Fetch admin-specific stats if user is admin
        if (type === 'admin') {
          try {
            // Fetch total merchants
            const merchants = await merchantsApi.getAll();
            setAdminStats(prev => ({ ...prev, totalMerchants: merchants?.length || 0 }));

            const token = getToken();
            const usersRes = await fetch(`${API}/api/users/count`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (usersRes.ok) {
              const usersData = await usersRes.json();
              setAdminStats(prev => ({ ...prev, totalUsers: usersData.count || 0 }));
            }

            // Fetch riders and compute total + pending-approval counts
            const ridersRes = await fetch(`${API}/api/users?role=rider`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (ridersRes.ok) {
              const ridersData = await ridersRes.json();
              const riders = Array.isArray(ridersData) ? ridersData : ridersData.data || [];
              const pending = riders.filter((r: any) => (r.status || '').toLowerCase() === 'pending').length;
              setAdminStats(prev => ({ ...prev, totalRiders: riders.length, pendingRiders: pending }));
            }

            // Total posts is already in stats
            setAdminStats(prev => ({ ...prev, totalPosts: statsData.activePosts + statsData.expiredPosts }));
          } catch (error) {
            console.error('Error fetching admin stats:', error);
          }
        }
      } catch (error) {
        console.error('Error fetching stats:', error);
      }

      // Fetch active and expired posts
      try {
        const [active, expired] = await Promise.all([
          staffPostsApi.getActive(),
          staffPostsApi.getExpired(),
        ]);
        setActivePosts(active);
        setExpiredPosts(expired);
      } catch (error) {
        console.error('Error fetching posts:', error);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this post?')) {
      return;
    }

    try {
      setDeletingId(id);
      
      await staffPostsApi.delete(id);
      toast.success('Post deleted successfully!');
      await fetchData(userType);
    } catch (error: any) {
      console.error('Error deleting post:', error);
      toast.error(error.message || 'Failed to delete post. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleViewLocation = (post: StaffPost) => {
    setSelectedPost(post);
    setShowMapModal(true);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isExpired = (post: StaffPost) => {
    if (!post.expiresAt) return false;
    return new Date(post.expiresAt) < new Date();
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Loading dashboard...</p>
      </div>
    );
  }

  // Default to 'staff' if userType is not set (fallback)
  const displayType = userType || 'staff';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {displayType === 'admin' ? 'Admin Dashboard' : 'Staff Dashboard'}
        </h1>
        <p className="text-gray-600">
          {displayType === 'admin' 
            ? 'Manage the entire platform, users, merchants, and posts' 
            : 'Manage businesses and time-limited posts'}
        </p>
      </div>

      {/* Admin-specific Stats */}
      {displayType === 'admin' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Merchants</p>
                <p className="text-3xl font-bold text-gray-900">{adminStats.totalMerchants}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Users</p>
                <p className="text-3xl font-bold text-gray-900">{adminStats.totalUsers}</p>
              </div>
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Riders</p>
                <p className="text-3xl font-bold text-gray-900">{adminStats.totalRiders}</p>
                {adminStats.pendingRiders > 0 && (
                  <p className="text-xs text-yellow-600 font-medium mt-1">{adminStats.pendingRiders} pending approval</p>
                )}
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Posts</p>
                <p className="text-3xl font-bold text-gray-900">{adminStats.totalPosts}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Active Posts</p>
              <p className="text-3xl font-bold text-gray-900">{stats.activePosts}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Expired Posts</p>
              <p className="text-3xl font-bold text-gray-900">{stats.expiredPosts}</p>
            </div>
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Views</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalViews}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Active Posts Section */}
      <div>
        <div className="bg-[#DB0002] text-white px-4 py-2 rounded-t-lg">
          <h2 className="font-bold">Active Posts ({activePosts.length})</h2>
        </div>
        <div className="bg-white rounded-b-lg shadow-sm border border-gray-200 border-t-0 p-6">
          {activePosts.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No active posts</p>
          ) : (
            <div className="space-y-4">
              {activePosts.map((post) => (
                <div key={post.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-block px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                          Active
                        </span>
                        {post.categoryTag && (
                          <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                            {post.categoryTag}
                          </span>
                        )}
                        {post.merchant && (
                          <span className="text-sm text-gray-600">{post.merchant.name}</span>
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 mb-2">{post.title}</h3>
                      {post.description && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">{post.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {isExpired(post) ? 'Expired' : 'Active'}
                        </div>
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          {post.viewsCount || 0} views
                        </div>
                        <div>
                          Created: {formatDate(post.createdAt)}
                        </div>
                        {post.expiresAt && (
                          <div>
                            Expires: {formatDate(post.expiresAt)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-4">
                    {post.latitude && post.longitude && (
                      <button
                        onClick={() => handleViewLocation(post)}
                        className="px-4 py-2 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors text-sm font-medium"
                      >
                        View Location
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(post.id)}
                      disabled={deletingId === post.id}
                      className="text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expired Posts Section */}
      <div>
        <div className="bg-gray-300 text-gray-700 px-4 py-2 rounded-t-lg">
          <h2 className="font-bold">Expired Posts ({expiredPosts.length})</h2>
        </div>
        <div className="bg-white rounded-b-lg shadow-sm border border-gray-200 border-t-0 p-6">
          {expiredPosts.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No expired posts</p>
          ) : (
            <div className="space-y-4">
              {expiredPosts.map((post) => (
                <div key={post.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow opacity-75">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-block px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded">
                          Expired
                        </span>
                        {post.categoryTag && (
                          <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                            {post.categoryTag}
                          </span>
                        )}
                        {post.merchant && (
                          <span className="text-sm text-gray-600">{post.merchant.name}</span>
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 mb-2">{post.title}</h3>
                      {post.description && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">{post.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Expired
                        </div>
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          {post.viewsCount || 0} views
                        </div>
                        <div>
                          Created: {formatDate(post.createdAt)}
                        </div>
                        {post.expiresAt && (
                          <div>
                            Expires: {formatDate(post.expiresAt)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-4">
                    {post.latitude && post.longitude && (
                      <button
                        onClick={() => handleViewLocation(post)}
                        className="px-4 py-2 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors text-sm font-medium"
                      >
                        View Location
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(post.id)}
                      disabled={deletingId === post.id}
                      className="text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Map Modal */}
      {showMapModal && selectedPost && selectedPost.latitude && selectedPost.longitude && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">{selectedPost.title}</h3>
                <button
                  onClick={() => setShowMapModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="h-96 rounded-lg overflow-hidden border border-gray-300">
                <MapContainer
                  center={[Number(selectedPost.latitude), Number(selectedPost.longitude)]}
                  zoom={15}
                  style={{ height: '100%', width: '100%' }}
                  scrollWheelZoom={true}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  />
                  <Marker position={[Number(selectedPost.latitude), Number(selectedPost.longitude)]}>
                    <Popup>
                      <div className="p-2">
                        <h4 className="font-bold text-gray-900 mb-1">{selectedPost.title}</h4>
                        {selectedPost.description && (
                          <p className="text-sm text-gray-600">{selectedPost.description}</p>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                </MapContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
