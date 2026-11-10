import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return (
    <AppLoading
      label="Loading dashboard"
      steps={[["Loading your watchlist"], ["Checking shortage status"], ["Loading charts"]]}
    />
  );
}
