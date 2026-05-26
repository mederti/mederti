import { Suspense } from "react";
import Chat2Client from "./Chat2Client";

export const dynamic = "force-dynamic";

export default function Chat2Page() {
  return (
    <Suspense>
      <Chat2Client chatId={null} />
    </Suspense>
  );
}
