"use client";

import { useState } from "react";

interface VideoCardProps {
  id: string;
  title: string;
  channel: string;
  duration: string;
  tag: string;
  tagColor: string;
}

export function VideoCard({ id, title, channel, duration, tag, tagColor }: VideoCardProps) {
  const [playing, setPlaying] = useState(false);
  const thumb = `https://img.youtube.com/vi/${id}/mqdefault.jpg`;

  return (
    <div style={{
      borderRadius: 8, overflow: "hidden",
      border: "1px solid var(--app-border)",
      background: "#000",
      cursor: "pointer",
      position: "relative",
    }}>
      {playing ? (
        <iframe
          src={`https://www.youtube.com/embed/${id}?autoplay=1`}
          allow="autoplay; encrypted-media"
          allowFullScreen
          style={{ width: "100%", aspectRatio: "16/9", display: "block", border: "none" }}
        />
      ) : (
        <div onClick={() => setPlaying(true)} style={{ position: "relative" }}>
          {/* Thumbnail */}
          <img
            src={thumb}
            alt={title}
            style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.background = "#1e293b";
              (e.target as HTMLImageElement).src = "";
            }}
          />
          {/* Dark overlay */}
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 60%)",
          }} />
          {/* Play button */}
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 44, height: 44, borderRadius: "50%",
            background: "rgba(255,255,255,0.9)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: 0, height: 0,
              borderTop: "9px solid transparent",
              borderBottom: "9px solid transparent",
              borderLeft: "16px solid #0f172a",
              marginLeft: 3,
            }} />
          </div>
          {/* Duration badge */}
          <span style={{
            position: "absolute", bottom: 44, right: 8,
            fontSize: 10, fontWeight: 600, fontFamily: "monospace",
            background: "rgba(0,0,0,0.8)", color: "#fff",
            padding: "2px 5px", borderRadius: 3,
          }}>
            {duration}
          </span>
          {/* Info bar */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "8px 10px",
            background: "rgba(0,0,0,0.6)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                textTransform: "uppercase", letterSpacing: "0.05em",
                background: tagColor, color: "#fff",
              }}>
                {tag}
              </span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>{channel}</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: "#fff", lineHeight: 1.35 }}>
              {title}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
