"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ContextChat } from "@/app/chat/components/ContextChat";
import { ChatSignupGate } from "@/app/components/free-tier/FreeTier";
import { useFreeTier } from "@/app/components/free-tier/useFreeTier";

interface Props {
  drugId: string;
  name: string;
  slug: string;
  /** Page path the signup gate returns to; defaults to /medicine/[slug]. */
  basePath?: string;
  /** Server-built grounding: the per-country status, notices and alternatives shown on the page. */
  bodyText: string;
}

/**
 * Middle column of the public medicine page. Signed-in users get a chat
 * grounded in this medicine's shortage data; a question routed in via
 * `?ask=…` is asked automatically. Signed-out visitors see the signup gate
 * (chat is account-only), which echoes their question and returns them here
 * with it after signup.
 */
function Panel({ drugId, name, slug, basePath, bodyText }: Props) {
  const { anon } = useFreeTier();
  const params = useSearchParams();
  const ask = (params.get("ask") ?? "").trim().slice(0, 300) || undefined;
  const base = basePath ?? `/medicine/${slug}`;
  const here = ask ? `${base}?ask=${encodeURIComponent(ask)}` : base;

  if (anon === null) return <></>;
  if (anon) {
    return (
      <ChatSignupGate
        next={here}
        headerLabel={`Ask about ${name}`}
        lead={
          ask ? (
            <>
              Sign up free and Mederti AI will answer <b>&ldquo;{ask}&rdquo;</b> from live regulator
              data on {name}.
            </>
          ) : (
            `Ask whether ${name} is short in your country, where else it's short, when regulators expect it back, and which alternatives are documented.`
          )
        }
      />
    );
  }

  return (
    <ContextChat
      key={`medicine-${drugId}${basePath ? `:${basePath}` : ""}`}
      contextKey={`medicine-${drugId}${basePath ? `:${basePath}` : ""}`}
      title={`${name} shortage status`}
      category={`Medicine shortage status — ${name}`}
      bodyText={bodyText}
      headerLabel={`Ask about ${name}`}
      placement="left"
      emptyLead={`Ask me anything about ${name} supply — answered from the regulator notices on this page and Mederti's database.`}
      starters={[
        `Is ${name} in shortage in my country?`,
        `What are the documented alternatives to ${name}?`,
        `When is ${name} expected back in supply?`,
        `Where else is ${name} in shortage right now?`,
      ]}
      initialQuestion={ask}
    />
  );
}

export default function MedicineChatPanel(props: Props) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}
