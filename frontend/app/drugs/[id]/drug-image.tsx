"use client";

import { useEffect, useState } from "react";

export function DrugImage({ genericName }: { genericName: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!genericName) return;
    fetch(`/api/drug-image?name=${encodeURIComponent(genericName)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.imageUrl) setImageUrl(data.imageUrl);
      })
      .catch(() => {});
  }, [genericName]);

  if (!imageUrl) return null;

  return (
    <div style={{
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid var(--app-border)",
      background: "#fff",
      width: "100%",
      maxWidth: 200,
      flexShrink: 0,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={`${genericName} product image`}
        onLoad={() => setLoaded(true)}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.3s",
        }}
      />
      <div style={{
        padding: "6px 10px",
        fontSize: 9,
        color: "var(--app-text-4)",
        textAlign: "center",
        borderTop: "1px solid var(--app-border)",
        background: "var(--app-bg)",
      }}>
        Source: DailyMed / NIH
      </div>
    </div>
  );
}
