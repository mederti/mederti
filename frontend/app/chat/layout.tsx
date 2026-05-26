// /chat2 — parallel to /chat. 3-column flex shell lives inside Chat2Client
// (needs client-side state for the preview pane URL param), so this layout is
// intentionally thin.

import type { ReactNode } from "react";

export default function Chat2Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
