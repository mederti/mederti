// Tiny inline SVGs — kept here to avoid pulling in a 600-icon dep for ~15
// glyphs. All inherit currentColor.

export const Plus = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={p.className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Search = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const ChevronRight = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 10} height={p.size ?? 10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={p.className}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const ChevronDown = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 10} height={p.size ?? 10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={p.className}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const Bookmark = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 13} height={p.size ?? 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
  </svg>
);

export const Folder = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 13} height={p.size ?? 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
  </svg>
);

export const Kebab = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 12} height={p.size ?? 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>
);

export const Bell = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
  </svg>
);

export const ChatBubble = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);

export const Grid = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

export const BarChart = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M3 3v18h18M9 17V9M14 17v-5M19 17v-3" />
  </svg>
);

export const Check = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 11} height={p.size ?? 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={p.className}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);

export const ChevronLeft = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const ExternalLink = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M15 3h6v6M14 10l7-7M9 21H3v-6M10 14l-7 7" />
  </svg>
);

export const Close = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export const MoreDots = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </svg>
);

export const Trash = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 12} height={p.size ?? 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
  </svg>
);

export const Pencil = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 12} height={p.size ?? 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

export const Star = (p: { size?: number; className?: string; filled?: boolean }) => (
  <svg width={p.size ?? 12} height={p.size ?? 12} viewBox="0 0 24 24" fill={p.filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className={p.className}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

export const Send = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={p.className}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

