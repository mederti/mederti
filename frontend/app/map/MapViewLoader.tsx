"use client";

import dynamic from "next/dynamic";

// MapViewClient is a browser-only MapLibre GL component. Loading it via
// next/dynamic with ssr:false renders it purely client-side, which is both
// correct (nothing on the map is meaningful to SSR/SEO) and sidesteps the
// Turbopack (Next 16) hydration failure that leaves a statically-imported
// SSR'd MapViewClient subtree without its client bundle attached.
const MapViewClient = dynamic(() => import("@/app/map/MapViewClient"), {
  ssr: false,
});

export default function MapViewLoader() {
  return <MapViewClient />;
}
