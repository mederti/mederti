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
        position: "fixed", inset: 0, zIndex: 99999,
        background: "rgba(15,23,32,0.86)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "zoom-out", padding: 24,
      }}
    >
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
          maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain",
          borderRadius: 10, cursor: "default", background: "#fff",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      />
      <div style={{ position: "absolute", bottom: 20, fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
        Source: DailyMed · NIH
      </div>
    </div>,
    document.body,
  );
}

/**
 * Square product image shown to the left of the drug heading.
 * Sources a label/package photo from DailyMed (NIH) via /api/drug-image,
 * trying the generic name, INN aliases and brand names in turn.
 *
 * Renders a subtle skeleton while loading, then collapses to nothing if
 * no image is found (so the heading reclaims the space with no empty box).
 */
export default function V1DrugImage({
  genericName,
  brandNames = [],
}: {
  genericName: string;
  brandNames?: string[];
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "found" | "none">("loading");
  const [loaded, setLoaded] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (!genericName) {
      setStatus("none");
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ name: genericName });
    if (brandNames.length) params.set("brands", brandNames.slice(0, 6).join(","));

    fetch(`/api/drug-image?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.imageUrl) {
          setImageUrl(data.imageUrl);
          setStatus("found");
        } else {
          setStatus("none");
        }
      })
      .catch(() => !cancelled && setStatus("none"));

    return () => {
      cancelled = true;
    };
  }, [genericName, brandNames]);

  const closeLightbox = useCallback(() => setLightbox(false), []);

  if (status === "none") return null;

  if (status === "loading") {
    return <div className="d-img d-img-skeleton" aria-hidden="true" />;
  }

  return (
    <>
      <button
        type="button"
        className="d-img"
        onClick={() => setLightbox(true)}
        title="View product image — click to enlarge"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl!}
          alt={`${genericName} product image`}
          onLoad={() => setLoaded(true)}
          style={{ opacity: loaded ? 1 : 0 }}
        />
        <span className="d-img-src">DailyMed · NIH</span>
      </button>

      {lightbox && imageUrl && (
        <Lightbox src={imageUrl} alt={`${genericName} product image`} onClose={closeLightbox} />
      )}
    </>
  );
}
