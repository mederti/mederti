"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { useFreeTier } from "@/app/components/free-tier/useFreeTier";

// true once we know the visitor is signed in. Default false = public links.
const SignedInContext = createContext(false);

/** One session check for every medicine link under it. */
export function SignedInLinks({ children }: { children: React.ReactNode }) {
  const { anon } = useFreeTier();
  return <SignedInContext.Provider value={anon === false}>{children}</SignedInContext.Provider>;
}

/**
 * Link to a medicine. Signed-in users go to the full product page
 * (/drugs/<id>). Signed-out visitors and crawlers get the public summary page
 * (/medicine/<slug>): it is what the server renders, it is indexable, and it
 * doesn't spend one of an anonymous visitor's metered product-page views.
 */
export default function MedicineLink({
  slug,
  drugId,
  style,
  children,
}: {
  slug: string;
  drugId?: string | null;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const signedIn = useContext(SignedInContext);
  return (
    <Link href={signedIn && drugId ? `/drugs/${drugId}` : `/medicine/${slug}`} style={style}>
      {children}
    </Link>
  );
}
