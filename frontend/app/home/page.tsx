import { redirect } from "next/navigation";

// The old card-grid home is superseded by /search, the signed-in landing (and
// the sidebar logo target). /search is the unified surface: it classifies the
// query and shows either the conversational answer (open questions) or the
// 3-column product results (drug names). Redirect keeps old links working.
export default function HomePage() {
  redirect("/search");
}
