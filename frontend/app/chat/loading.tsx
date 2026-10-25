import AppLoading from "@/app/components/v1/AppLoading";

export default function Loading() {
  return <AppLoading label="Opening chat" steps={[["Opening chat"], ["Loading your conversations"]]} />;
}
