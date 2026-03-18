import { cookies, headers } from "next/headers";

const MOBILE_UA_REGEX =
  /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export async function getDevice(): Promise<"mobile" | "desktop"> {
  // 1. Check cookie (set by middleware)
  const cookieStore = await cookies();
  const cookie = cookieStore.get("mederti-device")?.value as
    | "mobile"
    | "desktop"
    | undefined;
  if (cookie) return cookie;

  // 2. Fallback: read user-agent header directly
  const headerStore = await headers();
  const ua = headerStore.get("user-agent") ?? "";
  return MOBILE_UA_REGEX.test(ua) ? "mobile" : "desktop";
}
