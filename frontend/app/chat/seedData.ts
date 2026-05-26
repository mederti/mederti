// Seed data for /chat2 v1. Wire to real tables (watchlist, watchlist_item,
// chat_folder) in v2.

export type Status = "red" | "amber" | "green";

export type WatchlistItem = {
  drug_slug: string;
  drug_name: string;
  status: Status;
};

export type Watchlist = {
  id: string;
  name: string;
  items: WatchlistItem[];
  itemCount?: number;
};

export type ChatStub = {
  id: string;
  title: string;
};

export type Folder = {
  id: string;
  name: string;
  chats: ChatStub[];
  chatCount?: number;
};

export type RecentChat = ChatStub & { bucket: "today" | "yesterday" | "7d" | "30d" };

export const SEED_WATCHLISTS: Watchlist[] = [
  {
    id: "wl-1",
    name: "Critical for AU",
    items: [
      { drug_slug: "amoxicillin-500mg", drug_name: "Amoxicillin 500mg", status: "red" },
      { drug_slug: "salbutamol-inhaler-100mcg", drug_name: "Salbutamol inhaler", status: "red" },
      { drug_slug: "methylphenidate-er-36mg", drug_name: "Methylphenidate ER 36mg", status: "amber" },
      { drug_slug: "atorvastatin-40mg", drug_name: "Atorvastatin 40mg", status: "green" },
    ],
  },
  { id: "wl-2", name: "Injectables — Hormuz", items: [], itemCount: 8 },
  { id: "wl-3", name: "GLP-1 family", items: [], itemCount: 5 },
];

export const SEED_FOLDERS: Folder[] = [
  {
    id: "f-1",
    name: "Geopolitical signals",
    chats: [
      { id: "c-101", title: "Strait of Hormuz impact on injectables" },
      { id: "c-102", title: "China API export disruption Q1" },
      { id: "c-103", title: "India monsoon & manufacturing impact" },
    ],
  },
  { id: "f-2", name: "Supplier intelligence", chats: [], chatCount: 7 },
  { id: "f-3", name: "Regulatory comparisons", chats: [], chatCount: 4 },
  { id: "f-4", name: "Customer demos", chats: [], chatCount: 2 },
];

export const SEED_RECENT_CHATS: RecentChat[] = [
  { id: "r-1", title: "Aurobindo amoxicillin Q2 outlook", bucket: "yesterday" },
  { id: "r-2", title: "FDA vs TGA reporting discrepancies", bucket: "yesterday" },
  { id: "r-3", title: "GLP-1 supply forecast 2026", bucket: "yesterday" },
  { id: "r-4", title: "Top 10 longest-running shortages", bucket: "7d" },
  { id: "r-5", title: "Valsartan recall pattern analysis", bucket: "7d" },
  { id: "r-6", title: "Why does France only show 162 records?", bucket: "7d" },
  { id: "r-7", title: "Paediatric ibuprofen suspension AU", bucket: "7d" },
];

export const RECENT_BUCKET_LABELS: Record<RecentChat["bucket"], string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};
