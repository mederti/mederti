import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return (
    <AppLoading
      publicRoute
      label="Searching"
      steps={[["Looking up drugs"], ["Matching brands and generics"], ["Checking shortage status"]]}
    />
  );
}
