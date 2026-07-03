// Shared types + presentation metadata for the watchlist risk board
// (hospital-pharmacist feedback #5). Lives in lib/ so the API route and the
// client component share one definition without cross-importing.

export type RiskTier = "short_now" | "anticipated" | "early_warning" | "watching";

export type RiskItem = {
  drug_id: string;
  name: string;
  who_essential: boolean;
  tier: RiskTier;
  severity: string | null;
  est_return: string | null;
  anticipated_start: string | null;
  days_until: number | null;
  peer_count: number;
  peers: string[];
};

export type RiskBoardResponse = {
  country: string;
  imminent_window_days: number;
  imminent: number;
  counts: Record<RiskTier, number>;
  items: RiskItem[];
};

// Display order = severity order. `cls` maps to a colour block defined in the
// component's scoped CSS.
export const TIER_META: Record<RiskTier, { label: string; cls: string; blurb: string }> = {
  short_now: {
    label: "In shortage now",
    cls: "rb-crit",
    blurb: "Active shortage declared in your market",
  },
  anticipated: {
    label: "Anticipated",
    cls: "rb-warn",
    blurb: "A shortage has been flagged before it starts",
  },
  early_warning: {
    label: "Early warning",
    cls: "rb-info",
    blurb: "Short in peer markets — not yet declared in yours",
  },
  watching: {
    label: "Watching",
    cls: "rb-quiet",
    blurb: "On your list, currently in supply",
  },
};

export const TIER_ORDER: RiskTier[] = ["short_now", "anticipated", "early_warning", "watching"];
