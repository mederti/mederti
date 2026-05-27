"use client";

import { ErrorBoundary } from "@/app/components/error-boundary";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBoundary {...props} surface="Chat" />;
}
