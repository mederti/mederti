import { redirect } from "next/navigation";

// The legacy "command centre" dashboard is superseded by the insights
// dashboard (the sidebar's Dashboard target). Redirect keeps old links and
// bookmarks working while the site converges on one dashboard surface.
export default function DashboardPage() {
  redirect("/insights/dashboard");
}
