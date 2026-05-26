"use client";

import { createContext } from "react";
import type { LeadIntent } from "./LeadCaptureModal";

export type LeadCtx = {
  open: (intent: LeadIntent) => void;
};

export const LeadContext = createContext<LeadCtx | null>(null);
