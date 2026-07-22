import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Welcome — Mederti" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
