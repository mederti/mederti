import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return <AppLoading label="Loading recalls" steps={[["Gathering recent recalls"], ["Sorting by market and date"]]} />;
}
