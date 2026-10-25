import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return (
    <AppLoading
      label="Loading shortages"
      steps={[["Gathering active shortages"], ["Grouping by market"], ["Loading charts"]]}
    />
  );
}
