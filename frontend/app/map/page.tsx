import AppShell from "@/app/components/v1/AppShell";
// MapViewLoader wraps MapViewClient in next/dynamic ssr:false. A plain static
// import of the MapLibre client component SSRs its markup but the client
// bundle never links under Turbopack (Next 16), so the map never mounts.
import MapViewLoader from "@/app/map/MapViewLoader";

export const metadata = {
  title: "Map view | Mederti",
};

export default function MapPage() {
  return (
    <AppShell
      contentClassName="flush"
      chat={{
        contextKey: "map",
        title: "Map view",
        category: "Global map",
        bodyText:
          "The user is viewing a global map of drug shortages, manufacturing sites, manufacturer head offices, and regulator headquarters. Shortage markers can be filtered by horizon (today, 30/60/90 days, 6 or 12 months). Manufacturer and regulator markers are country-level, not exact addresses. Trade lanes shown are illustrative typical corridors, not live shipment tracking. Answer questions about what's currently visible on the map.",
        headerLabel: "Ask about the map",
        emptyLead: "Ask me about what's shown on the map, like which countries have the most active shortages.",
        starters: [
          "Which countries have the most active shortages right now?",
          "Where are the manufacturing sites with import alerts?",
          "What does the 90-day horizon show that today doesn't?",
        ],
      }}
    >
      <MapViewLoader />
    </AppShell>
  );
}
