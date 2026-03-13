import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/* ── Types ── */
interface StockQuote {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

interface CurrencyQuote {
  pair: string;
  label: string;
  rate: number;
  change: number;
  changePercent: number;
}

interface FreightData {
  index: number;
  change: number;
  changePercent: number;
  sparkline: number[];
}

interface CommodityRow {
  name: string;
  price: number;
  unit: string;
  trend: number; // percent change 30d
}

interface FdaApproval {
  drugName: string;
  applicationType: string;
  status: string;
  date: string;
  url: string;
}

interface MarketData {
  stocks: StockQuote[];
  shortageManufacturerCount: number;
  currencies: CurrencyQuote[];
  freight: FreightData;
  commodities: CommodityRow[];
  fda: FdaApproval[];
  updatedAt: string;
  errors: string[];
}

/* ── In-memory cache ── */
let cache: MarketData | null = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/* ── Ticker configs ── */
const STOCK_TICKERS = [
  { ticker: "NVS", name: "Novartis" },
  { ticker: "PFE", name: "Pfizer" },
  { ticker: "MRK", name: "Merck" },
  { ticker: "AZN", name: "AstraZeneca" },
  { ticker: "GSK", name: "GSK" },
  { ticker: "SNY", name: "Sanofi" },
  { ticker: "ABBV", name: "AbbVie" },
];

const CURRENCY_PAIRS = [
  { pair: "USDINR=X", label: "USD/INR" },
  { pair: "USDCNY=X", label: "USD/CNY" },
  { pair: "AUDUSD=X", label: "AUD/USD" },
];

/* ── Mock commodity data (indicative, updated manually) ── */
const COMMODITIES: CommodityRow[] = [
  { name: "Penicillin G", price: 28.50, unit: "$/kg", trend: 4.2 },
  { name: "Paracetamol API", price: 5.80, unit: "$/kg", trend: -1.8 },
  { name: "Amoxicillin trihydrate", price: 22.40, unit: "$/kg", trend: 7.5 },
  { name: "Azithromycin API", price: 42.00, unit: "$/kg", trend: 2.3 },
  { name: "Metformin HCl", price: 3.20, unit: "$/kg", trend: -0.5 },
];

/* ── Yahoo Finance chart fetch ── */
async function fetchYahooQuote(ticker: string): Promise<{
  price: number; prevClose: number; sparkline: number[];
} | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=30d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const closes: number[] = result.indicators?.quote?.[0]?.close?.filter(
      (v: number | null) => v !== null,
    ) ?? [];
    return {
      price: meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0,
      prevClose: meta.chartPreviousClose ?? meta.previousClose ?? 0,
      sparkline: closes.slice(-30),
    };
  } catch {
    return null;
  }
}

/* ── FDA recent approvals ── */
async function fetchFdaApprovals(): Promise<FdaApproval[]> {
  try {
    const url = "https://api.fda.gov/drug/drugsfda.json?search=submissions.submission_type:ORIG+AND+submissions.submission_status:AP&sort=submissions.submission_status_date:desc&limit=5";
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (json.results ?? []).slice(0, 5).map((r: any) => {
      const sub = r.submissions?.[0] ?? {};
      const products = r.products ?? [];
      const brandName = products[0]?.brand_name ?? "Unknown";
      const appType = r.application_number?.startsWith("NDA") ? "NDA"
        : r.application_number?.startsWith("ANDA") ? "ANDA"
        : r.application_number?.startsWith("BLA") ? "BLA"
        : r.application_number?.slice(0, 3) ?? "NDA";
      return {
        drugName: brandName,
        applicationType: appType,
        status: sub.submission_status === "AP" ? "Approved" : sub.submission_status ?? "Pending",
        date: sub.submission_status_date
          ? `${sub.submission_status_date.slice(0, 4)}-${sub.submission_status_date.slice(4, 6)}-${sub.submission_status_date.slice(6, 8)}`
          : "",
        url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${(r.application_number ?? "").replace(/\D/g, "")}`,
      };
    });
  } catch {
    return [];
  }
}

/* ── Manufacturer shortage cross-ref ── */
async function getShortageManufacturerCount(): Promise<number> {
  try {
    const supabase = getSupabaseAdmin();
    const { count } = await supabase
      .from("manufacturers")
      .select("id", { count: "exact", head: true });
    // Simple heuristic: return count of manufacturers that exist
    // In production this would cross-reference with shortage_events
    return Math.min(count ?? 3, 7);
  } catch {
    return 3;
  }
}

/* ── Main handler ── */
export async function GET() {
  // Return cache if fresh
  if (cache && Date.now() - cacheTs < CACHE_TTL) {
    return NextResponse.json(cache, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
    });
  }

  const errors: string[] = [];

  // Fetch stocks in parallel
  const stockPromises = STOCK_TICKERS.map(async (s) => {
    const q = await fetchYahooQuote(s.ticker);
    if (!q) {
      errors.push(`stock:${s.ticker}`);
      return null;
    }
    const change = q.price - q.prevClose;
    const changePercent = q.prevClose > 0 ? (change / q.prevClose) * 100 : 0;
    return {
      ticker: s.ticker,
      name: s.name,
      price: Math.round(q.price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
    } satisfies StockQuote;
  });

  // Fetch currencies in parallel
  const currPromises = CURRENCY_PAIRS.map(async (c) => {
    const q = await fetchYahooQuote(c.pair);
    if (!q) {
      errors.push(`currency:${c.pair}`);
      return null;
    }
    const change = q.price - q.prevClose;
    const changePercent = q.prevClose > 0 ? (change / q.prevClose) * 100 : 0;
    return {
      pair: c.pair,
      label: c.label,
      rate: Math.round(q.price * 10000) / 10000,
      change: Math.round(change * 10000) / 10000,
      changePercent: Math.round(changePercent * 100) / 100,
    } satisfies CurrencyQuote;
  });

  // Fetch freight (BDI via ^BDI on Yahoo)
  const freightPromise = (async (): Promise<FreightData> => {
    const q = await fetchYahooQuote("^BDI");
    if (!q) {
      errors.push("freight:BDI");
      return { index: 0, change: 0, changePercent: 0, sparkline: [] };
    }
    const change = q.price - q.prevClose;
    const changePercent = q.prevClose > 0 ? (change / q.prevClose) * 100 : 0;
    return {
      index: Math.round(q.price),
      change: Math.round(change),
      changePercent: Math.round(changePercent * 100) / 100,
      sparkline: q.sparkline,
    };
  })();

  // Fetch FDA + manufacturer count in parallel
  const [stocks, currencies, freight, fda, shortageManufacturerCount] = await Promise.all([
    Promise.all(stockPromises),
    Promise.all(currPromises),
    freightPromise,
    fetchFdaApprovals(),
    getShortageManufacturerCount(),
  ]);

  if (fda.length === 0) errors.push("fda");

  const data: MarketData = {
    stocks: stocks.filter((s): s is StockQuote => s !== null),
    shortageManufacturerCount: Math.min(shortageManufacturerCount, stocks.filter(Boolean).length),
    currencies: currencies.filter((c): c is CurrencyQuote => c !== null),
    freight,
    commodities: COMMODITIES,
    fda,
    updatedAt: new Date().toISOString(),
    errors,
  };

  // Update cache
  cache = data;
  cacheTs = Date.now();

  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" },
  });
}
