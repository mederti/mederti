import { NextRequest, NextResponse } from "next/server";

const MOBILE_UA_REGEX =
  /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export function middleware(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  const isMobile = MOBILE_UA_REGEX.test(ua);

  const res = NextResponse.next();

  // Set cookie so client components can read it without flash
  res.cookies.set("mederti-device", isMobile ? "mobile" : "desktop", {
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
    sameSite: "lax",
  });

  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
