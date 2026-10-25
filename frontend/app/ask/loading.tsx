import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return <AppLoading label="Loading" steps={[["Getting ready"], ["Loading recent activity"]]} />;
}
