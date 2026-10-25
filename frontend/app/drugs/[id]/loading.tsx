// Drug-detail Suspense fallback. The drug page fires 6 parallel Supabase
// queries + 2 sequential await chains (audit FINDING-F4-01), so cold
// navigation can take 500 ms–2 s; signed-in users keep the sidebar meanwhile.
import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return (
    <AppLoading
      publicRoute
      label="Loading drug details"
      steps={[
        ["Finding drug details"],
        ["Checking shortage status", "every market we track"],
        ["Finding alternatives"],
        ["Loading price history"],
        ["Building insight"],
      ]}
    />
  );
}
