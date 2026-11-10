import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return <AppLoading label="Loading your account" steps={[["Loading your account"], ["Loading your watchlist"]]} />;
}
