"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "zoom-out",
        padding: 24,
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 16, right: 16,
          width: 36, height: 36, borderRadius: "50%",
          background: "rgba(255,255,255,0.15)", border: "none",
          color: "#fff", fontSize: 20, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        &times;
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "90vw",
          maxHeight: "90vh",
          objectFit: "contain",
          borderRadius: 8,
          cursor: "default",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      />
      <div style={{
        position: "absolute",
        bottom: 20,
        fontSize: 11,
        color: "rgba(255,255,255,0.4)",
      }}>
        Source: DailyMed / NIH
      </div>
    </div>,
    document.body,
  );
}

export function DrugImage({ genericName }: { genericName: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (!genericName) return;
    fetch(`/api/drug-image?name=${encodeURIComponent(genericName)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.imageUrl) setImageUrl(data.imageUrl);
      })
      .catch(() => {});
  }, [genericName]);

  const closeLightbox = useCallback(() => setLightbox(false), []);

  if (!imageUrl) return null;

  return (
    <>
      <div
        onClick={() => setLightbox(true)}
        style={{
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid var(--app-border)",
          background: "#fff",
          width: "100%",
          maxWidth: 200,
          flexShrink: 0,
          cursor: "zoom-in",
        }}
      >
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

      {lightbox && (
        <Lightbox
          src={imageUrl}
          alt={`${genericName} product image`}
          onClose={closeLightbox}
        />
      )}
    </>
  );
}
