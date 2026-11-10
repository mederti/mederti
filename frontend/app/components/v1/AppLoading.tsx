import AppShell from "@/app/components/v1/AppShell";
import ThinkingLoader from "@/app/components/v1/ThinkingLoader";
import SignedInSwitch from "@/app/components/v1/SignedInSwitch";

/**
 * Shared body for logged-in `loading.tsx` files: the {@link ThinkingLoader}
 * inside {@link AppShell}, so the left sidebar (and its collapsed state, which
 * V1Sidebar restores from localStorage) stays on screen while the page loads.
 *
 * @param publicRoute set for routes anonymous visitors can also open (/drugs,
 *   /search under metered free views). Those only wrap the loader in the app
 *   shell when a Supabase session cookie is present, so anon visitors don't see
 *   a sidebar flash in and then vanish when their marketing-chrome page lands.
 */
export default function AppLoading({
  steps,
  label,
  publicRoute = false,
}: {
  steps: [string, string?][];
  label?: string;
  publicRoute?: boolean;
}) {
  const loader = <ThinkingLoader steps={steps} label={label} />;
  const shelled = <AppShell contentClassName="flush">{loader}</AppShell>;
  if (!publicRoute) return shelled;
  return <SignedInSwitch signedIn={shelled} signedOut={loader} />;
}
