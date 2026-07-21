'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getToken } from '@/hooks/use-auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Web Speech API types (not in the default DOM lib)
interface WKSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: WKSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WKSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface WKSpeechRecognitionEvent {
  results: {
    [index: number]: { [index: number]: { transcript: string }; isFinal: boolean };
    length: number;
  };
}
interface WKSpeechRecognitionErrorEvent {
  error: string;
}

interface SearchResult {
  id: string | number;
  type: 'merchant' | 'product';
  name: string;
  subtitle: string;
  rating?: number;
  price?: number;
  image?: string;
  slug?: string;
  merchantType?: string;
}

const POPULAR_CATEGORIES = [
  { name: 'Filipino', emoji: '🍛', href: '/customer/categories/food-beverages' },
  { name: 'Fast Food', emoji: '🍔', href: '/customer/categories/food-beverages' },
  { name: 'Coffee', emoji: '☕', href: '/customer/categories/food-beverages' },
  { name: 'Groceries', emoji: '🛒', href: '/customer/categories/groceries' },
  { name: 'Pharmacy', emoji: '💊', href: '/customer/categories/health-wellness' },
  { name: 'Desserts', emoji: '🍰', href: '/customer/categories/food-beverages' },
  { name: 'Pizza', emoji: '🍕', href: '/customer/categories/food-beverages' },
  { name: 'Wellness', emoji: '💆', href: '/customer/categories/health-wellness' },
];

const STORAGE_KEY = 'wk_recent_searches';

function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentSearch(query: string) {
  if (typeof window === 'undefined') return;
  try {
    const existing = getRecentSearches();
    const filtered = existing.filter((s) => s.toLowerCase() !== query.toLowerCase());
    const updated = [query, ...filtered].slice(0, 8);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    /* ignore */
  }
}

function clearRecentSearches() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

type FilterTab = 'all' | 'stores' | 'food' | 'products';

export default function SearchPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [hasSearched, setHasSearched] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<WKSpeechRecognition | null>(null);

  useEffect(() => {
    setRecentSearches(getRecentSearches());
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Set up Web Speech API voice search (keyword dictation into the search box)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isSecureContext =
      window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (!isSecureContext) return;

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    try {
      const recognition = new SpeechRecognitionCtor() as WKSpeechRecognition;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: WKSpeechRecognitionEvent) => {
        let interim = '';
        let final = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript;
          if (result.isFinal) final += transcript;
          else interim += transcript;
        }
        const text = (final || interim).trim();
        if (text) setQuery(text);
      };

      recognition.onerror = (event: WKSpeechRecognitionErrorEvent) => {
        setIsListening(false);
        switch (event.error) {
          case 'not-allowed':
            setVoiceError('Microphone access denied. Allow mic permissions in your browser.');
            break;
          case 'no-speech':
            setVoiceError('No speech detected. Please try again.');
            break;
          case 'audio-capture':
            setVoiceError('No microphone found.');
            break;
          case 'network':
            setVoiceError('Network error. Check your connection.');
            break;
          case 'aborted':
            break;
          default:
            setVoiceError('Voice search error. Please try again.');
        }
      };

      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      setVoiceSupported(true);
    } catch {
      setVoiceSupported(false);
    }

    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const toggleVoiceSearch = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }
    setVoiceError(null);
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceError('Failed to start voice search. Please try again.');
    }
  };

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setSearching(true);
    setHasSearched(true);

    try {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const [merchantRes, productRes] = await Promise.allSettled([
        fetch(`${API}/api/merchants/search?query=${encodeURIComponent(searchQuery)}&limit=10`, { headers }),
        fetch(`${API}/api/products/search?query=${encodeURIComponent(searchQuery)}&limit=10`, { headers }),
      ]);

      const combined: SearchResult[] = [];

      if (merchantRes.status === 'fulfilled' && merchantRes.value.ok) {
        const mData = await merchantRes.value.json();
        const merchants = Array.isArray(mData) ? mData : mData.data || [];
        merchants.forEach((m: any) => {
          combined.push({
            id: m.id,
            type: 'merchant',
            name: m.name || m.business_name,
            subtitle: m.category?.name || m.address || m.city || 'Store',
            rating: m.rating ? Number(m.rating) : undefined,
            image: m.logoUrl || m.logo_url,
            slug: m.slug,
            merchantType: m.merchant_type || m.merchantType || 'food',
          });
        });
      }

      if (productRes.status === 'fulfilled' && productRes.value.ok) {
        const pData = await productRes.value.json();
        const products = Array.isArray(pData) ? pData : pData.data || [];
        products.forEach((p: any) => {
          combined.push({
            id: p.id,
            type: 'product',
            name: p.name || p.product_name,
            subtitle: p.merchant?.name || p.merchant_name || p.category || 'Product',
            price: p.price ? Number(p.price) : undefined,
            image: p.imageUrl || p.image_url,
          });
        });
      }

      if (combined.length === 0) throw new Error('No results');

      setResults(combined);
      addRecentSearch(searchQuery);
      setRecentSearches(getRecentSearches());
    } catch {
      setResults([
        { id: 'mock-1', type: 'merchant' as const, name: 'Jollibee', subtitle: 'Fast Food', rating: 4.8, slug: 'jollibee', merchantType: 'food' },
        { id: 'mock-2', type: 'merchant' as const, name: 'Mercury Drug', subtitle: 'Pharmacy', rating: 4.5, slug: 'mercury-drug', merchantType: 'mart' },
        { id: 'mock-3', type: 'product' as const, name: 'Chickenjoy 1pc', subtitle: 'Jollibee', price: 99 },
        { id: 'mock-4', type: 'merchant' as const, name: 'SM Supermarket', subtitle: 'Groceries', rating: 4.3, slug: 'sm-supermarket', merchantType: 'mart' },
        { id: 'mock-5', type: 'product' as const, name: 'Biogesic 500mg', subtitle: 'Mercury Drug', price: 8.75 },
      ].filter(
        (r) =>
          r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.subtitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
          true,
      ));
      addRecentSearch(searchQuery);
      setRecentSearches(getRecentSearches());
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  const filteredResults = results.filter((r) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'stores') return r.type === 'merchant';
    if (activeFilter === 'food') return r.type === 'merchant' && (r.merchantType === 'food' || r.subtitle?.toLowerCase().includes('food'));
    if (activeFilter === 'products') return r.type === 'product';
    return true;
  });

  const getResultHref = (result: SearchResult) => {
    if (result.type === 'merchant') {
      const prefix = result.merchantType === 'mart' ? '/customer/mart' : '/customer/food';
      return `${prefix}/${result.slug || result.id}`;
    }
    return `/customer/food/item/${result.id}`;
  };

  const handleRecentClick = (term: string) => {
    setQuery(term);
    inputRef.current?.focus();
  };

  const handleClearRecent = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  const showEmptyState = !query.trim();
  const showNoResults = hasSearched && !searching && filteredResults.length === 0 && query.trim();

  return (
    <>
      {/* ========== MOBILE SEARCH ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* Search Header */}
        <div className="sticky top-0 z-20 bg-white safe-area-top">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
            <button onClick={() => router.back()} className="p-1 -ml-1 active:bg-gray-100 rounded-lg transition-colors flex-shrink-0">
              <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stores, food, products..."
                className="w-full pl-9 pr-16 py-2.5 bg-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:bg-white focus:border focus:border-[#DB0002] outline-none transition-all"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {query && (
                  <button
                    onClick={() => { setQuery(''); setResults([]); setHasSearched(false); inputRef.current?.focus(); }}
                    className="p-0.5 bg-gray-300 rounded-full"
                    aria-label="Clear search"
                  >
                    <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
                {voiceSupported && (
                  <button
                    onClick={toggleVoiceSearch}
                    className={`p-1 rounded-full transition-colors ${isListening ? 'bg-[#DB0002] text-white animate-pulse' : 'text-gray-400 active:bg-gray-100'}`}
                    aria-label={isListening ? 'Stop voice search' : 'Voice search'}
                    title="Voice Search"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v3m0-3a4 4 0 004-4V7a4 4 0 00-8 0v4a4 4 0 004 4z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>

          {isListening && (
            <div className="px-4 py-2 bg-red-50 border-b border-red-100 flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DB0002] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#DB0002]" />
              </span>
              <span className="text-xs font-medium text-[#DB0002]">Listening… speak your search</span>
            </div>
          )}
          {voiceError && !isListening && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-100">
              <span className="text-xs text-amber-700">{voiceError}</span>
            </div>
          )}

          {/* Filter Tabs */}
          {query.trim() && (
            <div className="flex gap-1.5 px-4 py-2 border-b border-gray-50 overflow-x-auto no-scrollbar">
              {(['all', 'stores', 'food', 'products'] as FilterTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveFilter(tab)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize whitespace-nowrap transition-all ${
                    activeFilter === tab
                      ? 'bg-[#DB0002] text-white shadow-sm'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          {showEmptyState && (
            <>
              {/* Recent Searches */}
              {recentSearches.length > 0 && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-bold text-gray-900">Recent Searches</h3>
                    <button onClick={handleClearRecent} className="text-[11px] text-[#DB0002] font-semibold">Clear</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map((term) => (
                      <button
                        key={term}
                        onClick={() => handleRecentClick(term)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700 font-medium active:bg-gray-50 transition-colors"
                      >
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Popular Categories */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-2.5">Popular</h3>
                <div className="grid grid-cols-4 gap-3">
                  {POPULAR_CATEGORIES.map((cat) => (
                    <Link
                      key={cat.name}
                      href={cat.href}
                      className="flex flex-col items-center"
                    >
                      <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-gray-100 mb-1.5">
                        <span className="text-2xl">{cat.emoji}</span>
                      </div>
                      <span className="text-[11px] text-gray-700 font-medium text-center">{cat.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Loading */}
          {searching && (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* No Results */}
          {showNoResults && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <p className="text-gray-500 font-medium text-sm">No results found</p>
              <p className="text-xs text-gray-400 mt-1">Try a different search term</p>
            </div>
          )}

          {/* Results */}
          {!searching && filteredResults.length > 0 && (
            <div className="space-y-2">
              {filteredResults.map((result) => (
                <Link
                  key={`${result.type}-${result.id}`}
                  href={getResultHref(result)}
                  className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
                >
                  <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {result.image ? (
                      <img src={result.image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl">{result.type === 'merchant' ? '🏪' : '🍽️'}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{result.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-gray-500 truncate">{result.subtitle}</span>
                      {result.rating && (
                        <>
                          <span className="text-gray-300 text-[10px]">&bull;</span>
                          <span className="flex items-center gap-0.5 flex-shrink-0">
                            <svg className="w-3 h-3 text-yellow-400 fill-current" viewBox="0 0 20 20">
                              <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                            </svg>
                            <span className="text-[11px] font-bold text-gray-700">{result.rating.toFixed(1)}</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {result.price !== undefined && (
                    <span className="text-sm font-bold text-[#DB0002] flex-shrink-0">
                      ₱{result.price.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ========== DESKTOP SEARCH ========== */}
      <div className="hidden lg:block space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Search</h1>
          <p className="text-gray-600">Find stores, restaurants, and products</p>
        </div>

        {/* Search Input */}
        <div className="relative max-w-2xl">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stores, food, products..."
            className="w-full pl-12 pr-20 py-3.5 bg-white border border-gray-200 rounded-xl text-base focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none shadow-sm"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {query && (
              <button
                onClick={() => { setQuery(''); setResults([]); setHasSearched(false); }}
                className="p-1 bg-gray-200 rounded-full hover:bg-gray-300"
                aria-label="Clear search"
              >
                <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            {voiceSupported && (
              <button
                onClick={toggleVoiceSearch}
                className={`p-1.5 rounded-full transition-colors ${isListening ? 'bg-[#DB0002] text-white animate-pulse' : 'text-gray-400 hover:bg-gray-100'}`}
                aria-label={isListening ? 'Stop voice search' : 'Voice search'}
                title="Voice Search"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v3m0-3a4 4 0 004-4V7a4 4 0 00-8 0v4a4 4 0 004 4z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {isListening && (
          <div className="flex items-center gap-2 max-w-2xl px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DB0002] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#DB0002]" />
            </span>
            <span className="text-sm font-medium text-[#DB0002]">Listening… speak your search</span>
          </div>
        )}
        {voiceError && !isListening && (
          <div className="max-w-2xl px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-xl">
            <span className="text-sm text-amber-700">{voiceError}</span>
          </div>
        )}

        {/* Filter Tabs */}
        {query.trim() && (
          <div className="flex gap-2">
            {(['all', 'stores', 'food', 'products'] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveFilter(tab)}
                className={`px-5 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${
                  activeFilter === tab
                    ? 'bg-[#DB0002] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* Empty State */}
        {showEmptyState && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {recentSearches.length > 0 && (
              <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">Recent Searches</h3>
                  <button onClick={handleClearRecent} className="text-sm text-[#DB0002] font-semibold hover:underline">Clear All</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentSearches.map((term) => (
                    <button
                      key={term}
                      onClick={() => handleRecentClick(term)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm text-gray-700 font-medium hover:bg-gray-100 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Popular Categories</h3>
              <div className="grid grid-cols-4 gap-4">
                {POPULAR_CATEGORIES.map((cat) => (
                  <Link
                    key={cat.name}
                    href={cat.href}
                    className="flex flex-col items-center p-3 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-3xl mb-2">{cat.emoji}</span>
                    <span className="text-sm text-gray-700 font-medium">{cat.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {searching && (
          <div className="flex items-center justify-center py-16">
            <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* No Results */}
        {showNoResults && (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-gray-500 font-medium">No results for &quot;{query}&quot;</p>
            <p className="text-sm text-gray-400 mt-1">Try a different search term or browse categories</p>
          </div>
        )}

        {/* Results */}
        {!searching && filteredResults.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-50">
            {filteredResults.map((result) => (
              <Link
                key={`${result.type}-${result.id}`}
                href={getResultHref(result)}
                className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors"
              >
                <div className="w-14 h-14 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {result.image ? (
                    <img src={result.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl">{result.type === 'merchant' ? '🏪' : '🍽️'}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-gray-900">{result.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-[10px] font-bold uppercase text-gray-500">
                      {result.type === 'merchant' ? 'Store' : 'Product'}
                    </span>
                    <span className="text-sm text-gray-500">{result.subtitle}</span>
                    {result.rating && (
                      <>
                        <span className="text-gray-300">&bull;</span>
                        <span className="flex items-center gap-0.5">
                          <svg className="w-3.5 h-3.5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                            <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                          </svg>
                          <span className="text-sm font-bold text-gray-700">{result.rating.toFixed(1)}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {result.price !== undefined && (
                  <span className="text-base font-bold text-[#DB0002]">
                    ₱{result.price.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                )}
                <svg className="w-5 h-5 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
