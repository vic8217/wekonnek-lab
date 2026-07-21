'use client';

import { useEffect, useState } from 'react';
import type { LatLng } from '@/lib/geo';

interface GeolocationState {
  coords: LatLng | null;
  status: 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable';
}

/**
 * Requests the user's current location once on mount. Silent on failure so the
 * UI can simply hide distance when permission is denied or unavailable.
 */
export function useUserLocation(): GeolocationState {
  const [state, setState] = useState<GeolocationState>({ coords: null, status: 'idle' });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ coords: null, status: 'unavailable' });
      return;
    }
    setState((s) => ({ ...s, status: 'locating' }));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setState({
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          status: 'granted',
        }),
      () => setState({ coords: null, status: 'denied' }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, []);

  return state;
}
