"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ContextChat } from "@/app/chat/components/ContextChat";
import { ChatSignupGate } from "@/app/components/free-tier/FreeTier";
import { useFreeTier } from "@/app/components/free-tier/useFreeTier";

interface Props {
  code: string;
  name: string;
  slug: string;
  /** Server-built grounding: the counts + notice lists shown on the page. */
  bodyText: string;
}

/**
 * Middle column of the country landing page. Signed-in users get a chat
 * grounded in this country's register; a question routed in from search
 * (`?ask=…`) is asked automatically. Signed-out visitors see the signup gate
 * (chat is account-only), which echoes their question and returns them here
 * with it after signup.
 */
function Panel({ code, name, slug, bodyText }: Props) {
  const { anon } = useFreeTier();
  const params = useSearchParams();
  const ask = (params.get("ask") ?? "").trim().slice(0, 300) || undefined;
  const base = `/country/${slug}/medicine-shortages`;
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
              Sign up free and Mederti AI will answer <b>&ldquo;{ask}&rdquo;</b> from {name}&rsquo;s live
              regulator data.
            </>
          ) : (
            `Ask what's newly short in ${name}, what the regulator expects to go short next, what's coming back into supply, and which alternatives are documented.`
          )
        }
      />
    );
  }

  return (
    <ContextChat
      key={`country-${code}`}
      contextKey={`country-${code}`}
      title={`Medicine shortages in ${name}`}
      category={`Country shortage register — ${name} (${code})`}
      bodyText={bodyText}
      headerLabel={`Ask about ${name}`}
      placement="left"
      emptyLead={`Ask me anything about medicine shortages in ${name} — answered from the live register on this page and Mederti's database.`}
      starters={[
        `What's expected to go short in ${name} in the next 6 months?`,
        `What should I stock up on now in ${name}?`,
        `Which ${name} shortages are critical, and what are the alternatives?`,
        `What's coming back into supply in ${name} soon?`,
      ]}
      initialQuestion={ask}
    />
  );
}

export default function CountryChatPanel(props: Props) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}
