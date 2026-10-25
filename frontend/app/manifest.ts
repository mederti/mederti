import type { MetadataRoute } from "next";

// Web app manifest: lets Edge/Chrome users "Install Mederti" as an app
// (Edge: … → Apps → Install), pin it to the Windows taskbar/Start menu, or
// open it in the Edge sidebar — the way clinicians on managed Windows PCs
// keep reference tools one click away.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mederti — Drug Shortage Intelligence",
    short_name: "Mederti",
    description: "Real-time medicine shortage tracking across global regulators.",
    start_url: "/search",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0fa676",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
