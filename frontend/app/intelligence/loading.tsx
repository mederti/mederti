import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return (
    <AppLoading
      label="Loading intelligence"
      steps={[["Gathering intelligence"], ["Reading regulator updates"], ["Building insight"]]}
    />
  );
}
