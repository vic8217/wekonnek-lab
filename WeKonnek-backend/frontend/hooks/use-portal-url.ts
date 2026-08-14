'use client';

import { useEffect, useState } from 'react';

type Portal = 'coordinator' | 'merchant';

const LOCAL_PATHS: Record<Portal, string> = {
  coordinator: '/coordinator',
  merchant: '/merchant',
};

const DEPLOYED_URLS: Record<Portal, string> = {
  coordinator: 'https://coordinator-lab.wekonnek.biz',
  merchant: 'https://merchant-lab.wekonnek.biz',
};

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function usePortalUrl(portal: Portal) {
  const [url, setUrl] = useState(LOCAL_PATHS[portal]);

  useEffect(() => {
    setUrl(isLocalHostname(window.location.hostname) ? LOCAL_PATHS[portal] : DEPLOYED_URLS[portal]);
  }, [portal]);

  return url;
}
