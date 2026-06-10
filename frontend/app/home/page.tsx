import { redirect } from "next/navigation";

// The old card-grid home is superseded by /chat, the signed-in landing (and
// the sidebar logo target). Redirect keeps old links and bookmarks working
// while the site converges on one logged-in home.
export default function HomePage() {
  redirect("/chat");
}
