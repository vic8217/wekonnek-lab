'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { merchantsApi, Merchant } from '@/lib/api';

// Type definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  length: number;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export default function AuthNavigation() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isSearchListeningRef = useRef(false);
  const searchQueryRef = useRef(searchQuery);
  const locationQueryRef = useRef(locationQuery);
  const [searchSuggestions, setSearchSuggestions] = useState<Merchant[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speechDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { locationQueryRef.current = locationQuery; }, [locationQuery]);

  const fetchSuggestions = useCallback(async (query: string, location: string) => {
    if (!query.trim() && !location.trim()) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      setIsSearching(true);
      const params: any = { limit: 5, page: 1 };
      if (query.trim()) params.search = query;
      if (location.trim()) params.city = location;

      const response = await merchantsApi.search(params);
      setSearchSuggestions(response.data || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
      setSearchSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    // Check if browser supports Web Speech API and if we're in a secure context
    if (typeof window !== 'undefined') {
      // Check if we're in a secure context (HTTPS or localhost)
      const isSecureContext = window.isSecureContext || 
        window.location.protocol === 'https:' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

      if (!isSecureContext) {
        setSpeechError('Speech recognition requires a secure connection (HTTPS) or localhost');
        return;
      }

      const SpeechRecognition = 
        (window as any).SpeechRecognition || 
        (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition() as SpeechRecognition;
          recognition.continuous = false;
          recognition.interimResults = true;
          recognition.lang = 'en-US';

          recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = 0; i < event.results.length; i++) {
              const result = event.results[i];
              const transcript = result[0].transcript;
              if (result.isFinal) {
                finalTranscript += transcript;
              } else {
                interimTranscript += transcript;
              }
            }

            const displayText = (finalTranscript || interimTranscript).trim();

            if (isSearchListeningRef.current) {
              setSearchQuery(displayText);
            } else {
              setLocationQuery(displayText);
            }

            if (finalTranscript) {
              if (speechDebounceRef.current) clearTimeout(speechDebounceRef.current);
              if (isSearchListeningRef.current) {
                fetchSuggestions(finalTranscript.trim(), locationQueryRef.current);
              } else {
                fetchSuggestions(searchQueryRef.current, finalTranscript.trim());
              }
              setIsListening(false);
              setSpeechError(null);
            } else if (interimTranscript) {
              if (speechDebounceRef.current) clearTimeout(speechDebounceRef.current);
              speechDebounceRef.current = setTimeout(() => {
                if (isSearchListeningRef.current) {
                  fetchSuggestions(displayText, locationQueryRef.current);
                } else {
                  fetchSuggestions(searchQueryRef.current, displayText);
                }
              }, 500);
            }
          };

          recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            const errorMessage = event.error;
            console.error('Speech recognition error:', errorMessage);
            setIsListening(false);
            
            // Handle specific error types
            switch (errorMessage) {
              case 'not-allowed':
                setSpeechError('Microphone access denied. Please allow microphone permissions in your browser settings.');
                break;
              case 'no-speech':
                setSpeechError('No speech detected. Please try again.');
                break;
              case 'aborted':
                setSpeechError('Speech recognition was aborted.');
                break;
              case 'audio-capture':
                setSpeechError('No microphone found. Please check your microphone connection.');
                break;
              case 'network':
                setSpeechError('Network error. Please check your connection.');
                break;
              default:
                setSpeechError(`Speech recognition error: ${errorMessage}`);
            }
          };

          recognition.onend = () => {
            setIsListening(false);
          };

          recognitionRef.current = recognition;
        } catch (error) {
          console.error('Failed to initialize speech recognition:', error);
          setSpeechError('Speech recognition is not available in this browser.');
        }
      } else {
        setSpeechError('Speech recognition is not supported in this browser.');
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (speechDebounceRef.current) {
        clearTimeout(speechDebounceRef.current);
      }
    };
  }, []);

  // Debounced search as user types
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(() => {
      fetchSuggestions(searchQuery, locationQuery);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, locationQuery, fetchSuggestions]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (searchQuery.trim() || locationQuery.trim()) {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('search', searchQuery);
      if (locationQuery.trim()) params.set('city', locationQuery);
      router.push(`/merchants?${params.toString()}`);
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (merchant: Merchant) => {
    router.push(`/merchants/${merchant.slug}`);
    setShowSuggestions(false);
    setSearchQuery('');
  };

  const startListening = (isSearch: boolean) => {
    if (recognitionRef.current && !isListening) {
      isSearchListeningRef.current = isSearch;
      setIsListening(true);
      setSpeechError(null);
      try {
        recognitionRef.current.start();
      } catch (error) {
        console.error('Failed to start speech recognition:', error);
        setIsListening(false);
        setSpeechError('Failed to start speech recognition. Please try again.');
      }
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  return (
    <nav className="bg-[#FFFAF3] border-b border-gray-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2 flex-shrink-0">
            <Image
              src="/logo/weKonnekLogov1.png"
              alt="WeKonnek Logo"
              width={48}
              height={32}
              className="w-12 h-8 object-contain"
            />
            <span className="text-xl font-bold text-[#165BB8]">WeKonnek</span>
          </Link>

          {/* Search Fields — hidden on mobile to keep the auth header clean */}
          <form onSubmit={handleSearch} className="hidden md:flex items-center gap-3 flex-1 max-w-2xl">
            {/* Search Input */}
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => {
                  if (searchSuggestions.length > 0) setShowSuggestions(true);
                }}
                placeholder="What can we help you with?"
                className="w-full px-4 py-2 pr-20 rounded-lg outline-none bg-white text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-[#165BB8]/30 text-sm"
              />
              {speechError && isSearchListeningRef.current && (
                <div className="absolute top-full left-0 mt-1 px-3 py-2 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm z-50 max-w-md">
                  {speechError}
                </div>
              )}

              {/* Search Suggestions Dropdown */}
              {showSuggestions && (searchSuggestions.length > 0 || isSearching) && (
                <div
                  ref={suggestionsRef}
                  className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-96 overflow-y-auto"
                >
                  {isSearching ? (
                    <div className="p-4 text-center text-gray-500">
                      <p>Searching...</p>
                    </div>
                  ) : searchSuggestions.length > 0 ? (
                    <div className="py-2">
                      {searchSuggestions.map((merchant) => (
                        <button
                          key={merchant.id}
                          type="button"
                          onClick={() => handleSuggestionClick(merchant)}
                          className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-3"
                        >
                          {merchant.logoUrl ? (
                            <img
                              src={merchant.logoUrl}
                              alt={merchant.name}
                              className="w-10 h-10 rounded object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-gray-200 flex items-center justify-center">
                              <span className="text-gray-400 text-xs">🏪</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 truncate">
                              {merchant.name}
                            </p>
                            {merchant.category && (
                              <p className="text-sm text-gray-500 truncate">
                                {merchant.category.name}
                              </p>
                            )}
                          </div>
                          {merchant.rating && Number(merchant.rating) > 0 && (
                            <div className="flex items-center gap-1 text-sm text-[#DB0002]">
                              <span>⭐</span>
                              <span className="font-semibold">
                                {Number(merchant.rating).toFixed(1)}
                              </span>
                            </div>
                          )}
                        </button>
                      ))}
                      {(searchQuery.trim() || locationQuery.trim()) && (
                        <div className="border-t border-gray-200 px-4 py-2">
                          <button
                            type="submit"
                            className="w-full text-left text-[#165BB8] hover:text-[#124A94] font-medium text-sm"
                          >
                            Search for: &ldquo;{searchQuery || locationQuery}&rdquo; →
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-gray-500">
                      <p>No results found</p>
                    </div>
                  )}
                </div>
              )}

              <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => isListening ? stopListening() : startListening(true)}
                  disabled={!recognitionRef.current}
                  className={`p-1.5 rounded-full transition-colors ${
                    isListening && isSearchListeningRef.current
                      ? 'bg-[#DB0002] text-white animate-pulse'
                      : recognitionRef.current
                      ? 'text-black hover:bg-gray-100'
                      : 'text-gray-400 cursor-not-allowed opacity-50'
                  }`}
                  title={recognitionRef.current ? "Voice Search" : "Speech recognition not available"}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                </button>
                <button
                  type="submit"
                  className="p-1.5 rounded-full text-black hover:bg-gray-100 transition-colors"
                  title="Search"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Location Input */}
            <div className="relative w-48">
              <input
                type="text"
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
                placeholder="Cubao Quezon City..."
                className="w-full px-4 py-2 pr-20 rounded-lg outline-none bg-white text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-[#165BB8]/30 text-sm"
              />
              {speechError && !isSearchListeningRef.current && (
                <div className="absolute top-full left-0 mt-1 px-3 py-2 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm z-50 max-w-md">
                  {speechError}
                </div>
              )}
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => isListening ? stopListening() : startListening(false)}
                  disabled={!recognitionRef.current}
                  className={`p-1.5 rounded-full transition-colors ${
                    isListening && !isSearchListeningRef.current
                      ? 'bg-[#DB0002] text-white animate-pulse'
                      : recognitionRef.current
                      ? 'text-black hover:bg-gray-100'
                      : 'text-gray-400 cursor-not-allowed opacity-50'
                  }`}
                  title={recognitionRef.current ? "Voice Location" : "Speech recognition not available"}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                </button>
                <svg
                  className="w-4 h-4 text-black"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
            </div>
          </form>

          {/* Right side buttons and icons */}
          <div className="flex items-center gap-2 sm:space-x-4 flex-shrink-0">
            <Link
              href="/merchants/register"
              className="hidden md:inline-block px-4 py-2 border-2 border-[#DB0002] text-[#DB0002] rounded-md hover:bg-red-50 transition-colors font-medium"
            >
              Become A Merchant
            </Link>
            <Link
              href="/auth/login"
              className="hidden sm:inline-block px-4 py-2 bg-[#DB0002] text-white rounded-md hover:bg-[#B80002] transition-colors font-medium"
            >
              Sign In
            </Link>
            <Link 
              href="/customer/cart"
              className="p-2 hover:opacity-80 transition-opacity" 
              title="Shopping Cart"
            >
              <svg
                className="w-6 h-6 text-black"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-1.6 1.6-.559 4.707 1.707 4.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
