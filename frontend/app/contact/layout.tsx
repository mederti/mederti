// /contact's page is a client component (form state), so it can't export
// metadata itself — without this it shipped with no canonical and only the
// site-wide default title/description.

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Contact — Mederti",
  description: "Get in touch with the Mederti team about medicine shortage data, institutional access, partnerships or corrections to a shortage record.",
  alternates: { canonical: "/contact" },
};

export default function ContactLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
