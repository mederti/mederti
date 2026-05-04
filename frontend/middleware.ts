import { NextRequest, NextResponse } from "next/server";
import { createServerClient as createSupabaseSsr } from "@supabase/ssr";

const MOBILE_UA_REGEX =
  /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

/**
 * Soft-launch mode.
 *
 * When `NEXT_PUBLIC_SOFT_LAUNCH=true`, the site exposes only the five
 * pages we want for the initial public release:
 *   /              (homepage)
 *   /signup        (sign up)
 *   /login         (sign in)
 *   /search        (drug search)
 *   /drugs/[id]    (drug detail)
 *   /intelligence  (Pharma Brief)
 * Plus the auth/account/onboarding scaffolding needed for those to work.
 *
 * Everything else 308-redirects to /coming-soon. Flip the env var off
 * (or unset it) and the full site reappears — no code changes needed.
 *
 * Set the var on the Vercel "preview" environment to demo soft-launch
 * on preview URLs while production stays normal.
 */
const SOFT_LAUNCH =
  (process.env.NEXT_PUBLIC_SOFT_LAUNCH ?? "").toLowerCase() === "true";

const SOFT_LAUNCH_ALLOW: ReadonlyArray<string> = [
  "/",                  // homepage
  "/signup",
  "/login",
  "/auth",              // OAuth/email confirm callbacks
  "/forgot-password",
  "/reset-password",
  "/onboarding",        // post-signup profiling
  "/account",           // user can manage their account
  "/search",            // drug search
  "/drugs",             // /drugs/[id]
  "/intelligence",      // Pharma Brief and any subroutes
  "/coming-soon",
  "/admin",             // separately gated by requireAdmin
  "/privacy",
  "/terms",
];

function softLaunchAllowed(pathname: string): boolean {
  if (pathname === "/") return true;
  for (const p of SOFT_LAUNCH_ALLOW) {
    if (p === "/") continue;
    if (pathname === p) return true;
    if (pathname.startsWith(p + "/")) return true;
  }
  return false;
}

/**
 * Routes that DO NOT require authentication.
 * Everything else (the actual product) requires a signed-in user.
 *
 * Marketing / persona pages stay public for SEO and acquisition.
 * Auth pages stay public so users can log in / sign up.
 */
const PUBLIC_PATHS: ReadonlyArray<string> = [
  "/",                    // landing
  "/about",
  "/pricing",
  "/contact",
  "/privacy",
  "/terms",
  "/login",
  "/signup",
  "/auth",                // any auth callback paths
  "/forgot-password",
  "/reset-password",
  // Persona / marketing pages
  "/pharmacists",
  "/hospitals",
  "/doctors",
  "/government",
  "/governments",
  "/suppliers",           // and /suppliers/directory, /suppliers/[slug] (public discovery)
  // Public APIs that are safe to expose
  // (handled separately below — we let middleware skip /api/* via matcher)
];

/**
 * Returns true if the request path is public (no auth required).
 */
function isPublic(pathname: string): boolean {
  // Exact root
  if (pathname === "/") return true;
  // Exact matches and prefix matches
  for (const p of PUBLIC_PATHS) {
    if (p === "/") continue;
    if (pathname === p) return true;
    if (pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ua = req.headers.get("user-agent") ?? "";
  const isMobile = MOBILE_UA_REGEX.test(ua);

  const res = NextResponse.next();

  // Set device cookie (preserved from existing behaviour)
  res.cookies.set("mederti-device", isMobile ? "mobile" : "desktop", {
    path: "/",
    maxAge: 60 * 60 * 24,
    sameSite: "lax",
  });

  // ── Soft-launch gate ──
  // When NEXT_PUBLIC_SOFT_LAUNCH=true, redirect anything off the
  // 5-page allowlist to /coming-soon. Auth + onboarding still work.
  if (SOFT_LAUNCH && !softLaunchAllowed(pathname)) {
    const url = new URL("/coming-soon", req.url);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url, 308);
  }

  // ── Skip auth gating for public paths ──
  if (isPublic(pathname)) {
    return res;
  }

  // ── Auth check via Supabase SSR ──
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    "";

  if (!supabaseUrl || !supabaseAnonKey) {
    // If env not configured, fall through (don't break local dev)
    return res;
  }

  const supabase = createSupabaseSsr(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookies) {
        cookies.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Build login redirect with return URL
    const returnUrl = pathname + req.nextUrl.search;
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", returnUrl);
    return NextResponse.redirect(loginUrl);
  }

  // ── Onboarding gate ──
  // If the user is signed in but hasn't finished onboarding, bounce them
  // to /onboarding. We allow them to stay on /onboarding itself, /account
  // (so they can fix anything there), and any /api/* (skipped via matcher).
  if (
    pathname !== "/onboarding" &&
    !pathname.startsWith("/account") &&
    !pathname.startsWith("/auth")
  ) {
    // Cheap async check: read the onboarding flag from user_profiles.
    // We use the same Supabase SSR client so RLS lets the user see their own row.
    try {
      const { data: profile, error } = await supabase
        .from("user_profiles")
        .select("onboarding_done")
        .eq("user_id", user.id)
        .maybeSingle();
      // Fail-open: if the column doesn't exist (migration 025 not yet
      // applied) or the lookup fails, do NOT redirect — that would trap
      // every user in /onboarding, which itself can't write the column.
      if (error) {
        const msg = (error.message ?? "").toLowerCase();
        if (msg.includes("could not find") || msg.includes("schema cache") || msg.includes("column")) {
          // Schema not migrated; let them through.
        }
      } else if (profile && profile.onboarding_done === false) {
        return NextResponse.redirect(new URL("/onboarding", req.url));
      } else if (!profile) {
        // If no row yet, send them to onboarding so we can create it
        return NextResponse.redirect(new URL("/onboarding", req.url));
      }
    } catch {
      // If the lookup fails, don't block the user — fall through.
    }
  }

  return res;
}

export const config = {
  // Skip API routes, static, image optimisation, favicons, robots, sitemap, llms.txt
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|llms.txt|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|eot)).*)",
  ],
};
