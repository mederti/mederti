import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return (
    <AppLoading
      label="Loading insights"
      steps={[["Gathering latest signals"], ["Loading charts"], ["Building insight"]]}
    />
  );
}
