"use client";

import dynamic from "next/dynamic";

const WorldMap = dynamic(() => import("@/app/components/world-map"), {
  ssr: false,
  loading: () => (
    <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--app-text-4)", fontSize: 13 }}>
      Loading map…
    </div>
  ),
});

interface CountryBucket {
  country_code: string;
  country: string;
  count: number;
  max_severity: string;
}

export default function WorldMapWrapper({ byCountry }: { byCountry: CountryBucket[] }) {
  return <WorldMap byCountry={byCountry} />;
}
