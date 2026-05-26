import { Suspense } from "react";
import Chat2Client from "../Chat2Client";

export const dynamic = "force-dynamic";

export default async function Chat2ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = await params;
  return (
    <Suspense>
      <Chat2Client chatId={chatId} />
    </Suspense>
  );
}
