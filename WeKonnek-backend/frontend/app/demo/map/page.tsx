'use client';

import dynamic from 'next/dynamic';

const MapDemo = dynamic(() => import('./MapDemo'), { ssr: false });

export default function DemoMapPage() {
  return <MapDemo />;
}
