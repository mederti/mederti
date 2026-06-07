// Client-side recent-activity log (anon-friendly, localStorage-backed).
// Powers the search-page sidebar "Search history" and "My medicines" lists
// before a user signs in. Capped, deduped, and SSR-safe.

const SEARCH_KEY = "mederti:recent-searches:v1";
const MEDICINE_KEY = "mederti:recent-medicines:v1";
const CAP = 5;

/** Fired on the window whenever either list changes, so open views refresh live. */
export const RECENT_EVENT = "mederti:recent-updated";

export type RecentMedicine = { id: string; name: string };

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    /* quota / private-mode — best effort */
  }
}

export function getRecentSearches(): string[] {
  return read<string>(SEARCH_KEY);
}

export function addRecentSearch(term: string) {
  const t = term.trim();
  if (t.length < 2) return;
  const lower = t.toLowerCase();
  // Drop near-duplicates: existing entries that are a prefix of this term
  // (or vice-versa), so "amox" → "amoxicillin" collapses to one row.
  const next = [
    t,
    ...getRecentSearches().filter((s) => {
      const sl = s.toLowerCase();
      return sl !== lower && !sl.startsWith(lower) && !lower.startsWith(sl);
    }),
  ].slice(0, CAP);
  write(SEARCH_KEY, next);
}

export function getRecentMedicines(): RecentMedicine[] {
  return read<RecentMedicine>(MEDICINE_KEY).filter((m) => m && m.id && m.name);
}

export function addRecentMedicine(med: RecentMedicine) {
  if (!med?.id || !med?.name) return;
  const next = [med, ...getRecentMedicines().filter((m) => m.id !== med.id)].slice(0, CAP);
  write(MEDICINE_KEY, next);
}
