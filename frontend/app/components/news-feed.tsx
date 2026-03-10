"use client";

import { useState } from "react";

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  color: string;
  description: string;
}

function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function NewsRow({ item, isLast }: { item: NewsItem; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: "none", display: "block" }}
    >
      <div
        style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          padding: "12px 20px",
          borderBottom: isLast ? "none" : "1px solid var(--app-bg-2)",
          background: hovered ? "var(--app-bg-2)" : "transparent",
          transition: "background 0.1s",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span style={{
          flexShrink: 0, marginTop: 1,
          fontSize: 9, fontWeight: 700, padding: "3px 7px", borderRadius: 4,
          textTransform: "uppercase" as const, letterSpacing: "0.04em",
          background: item.color + "18", color: item.color,
          border: `1px solid ${item.color}33`,
          minWidth: 60, textAlign: "center" as const,
        }}>
          {item.source}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--app-text)", lineHeight: 1.4, marginBottom: 2 }}>
            {item.title}
          </div>
          {item.description && (
            <div style={{ fontSize: 11, color: "var(--app-text-4)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.description}
            </div>
          )}
        </div>
        <span style={{ flexShrink: 0, fontSize: 11, color: "var(--app-text-4)", fontFamily: "var(--font-dm-mono), monospace", whiteSpace: "nowrap" }}>
          {formatRelativeDate(item.pubDate)}
        </span>
      </div>
    </a>
  );
}

export function NewsFeed({ items }: { items: NewsItem[] }) {
  if (items.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--app-text-4)", fontSize: 13 }}>
        Unable to load news feeds — check connection
      </div>
    );
  }
  return (
    <div style={{ overflowY: "auto", maxHeight: 420 }}>
      {items.map((item, i) => (
        <NewsRow key={i} item={item} isLast={i === items.length - 1} />
      ))}
    </div>
  );
}
