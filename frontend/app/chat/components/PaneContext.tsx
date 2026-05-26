"use client";

import { createContext } from "react";

export type PaneCtx = {
  open: (drugId: string) => void;
  close: () => void;
  back: () => void;
  current: string | null;
  previousId: string | null;
};

export const PaneContext = createContext<PaneCtx | null>(null);
