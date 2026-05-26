"use client";

import { createContext } from "react";

// Lets descendants of <ChatContext.Provider> send a fresh chat message —
// used by substitute cards / disambiguation chips to surface a related drug
// as a new turn rather than swapping the pane.
export type ChatCtx = {
  send: (text: string) => void;
};

export const ChatContext = createContext<ChatCtx | null>(null);
