import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return <AppLoading label="Loading map" steps={[["Loading map"], ["Plotting shortages by country"]]} />;
}
