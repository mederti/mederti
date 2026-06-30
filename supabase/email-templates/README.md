# Mederti Supabase Email Templates

Branded HTML email templates for the four user-facing Supabase auth flows.
Mobile-friendly, table-based layout, brand colours from `globals.css`.

## How to install

1. Open Supabase Dashboard → **Authentication** → **Email Templates**
2. For each of the four templates below, click into it and replace the contents:

| Template in dashboard | File to paste | Suggested subject line |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `Confirm your Mederti account` |
| Magic Link | `magic-link.html` | `Your Mederti sign-in link` |
| Reset Password | `reset-password.html` | `Reset your Mederti password` |
| Invite user | `invite.html` | `You've been invited to Mederti` |

3. Hit **Save** on each.

## ⚠️ These templates use the `token_hash` flow — not `{{ .ConfirmationURL }}`

Each link points directly at `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=…`.
The callback (`frontend/app/auth/callback/route.ts`) calls `verifyOtp({ token_hash, type })`
server-side. This deliberately avoids the PKCE `code` flow, which silently breaks when:

- a corporate email scanner **prefetches** the link and burns the one-time code before the user clicks, or
- the user **opens the email on a different device/browser** than the one that requested it (the PKCE `code_verifier` cookie isn't there).

Both failure modes land the user back on the site **logged-out with no error** — the exact "magic link doesn't log me in" symptom.

**Required dashboard setting:** Authentication → URL Configuration → **Site URL must be `https://mederti.com`** (this is what `{{ .SiteURL }}` expands to). Because the link goes straight to Site URL, it does **not** depend on the Redirect-URLs allowlist for the email flows. The callback still accepts PKCE `code` too, so OAuth (Google/Apple) is unaffected.

## What you're getting

- **Visual consistency** with the live site — same Inter typography, same `#0F172A` slate primary, same off-white `#f8fafb` canvas, same 12px rounded card border.
- **Preview text** in the email client preview pane (one-line teaser before the user opens the message).
- **Both a CTA button and a paste-able link** — many corporate email clients strip buttons, so the URL is always shown as a fallback in a monospace block.
- **Mobile-safe** layout (max-width 560px, table-based for Outlook compatibility).
- **Voice match** — short, declarative, plain-words, the same tone as the rest of the product.

## Variables Supabase will substitute at send time

These are the only placeholders you can use safely:

| Variable | What it expands to |
|---|---|
| `{{ .TokenHash }}` | Hashed one-time token — **what these templates use**, verified by `/auth/callback` via `verifyOtp` |
| `{{ .SiteURL }}` | The project's site URL set in Auth → URL Configuration (must be `https://mederti.com`) |
| `{{ .Email }}` | The recipient's email address |
| `{{ .ConfirmationURL }}` | The single-use PKCE link — **no longer used** (fragile to prefetch / cross-device) |
| `{{ .Token }}` | 6-digit OTP code (only useful if you handle OTP flows manually) |

## Deliverability notes

- **Set the "Sender Name"** in Supabase → Auth → SMTP Settings to `Mederti` (no email; that comes from the `noreply@mederti.com` or whatever you've configured as the From address).
- If you're still on the **Supabase default SMTP** (rate-limited to 4/hour per project), upgrade to a real SMTP provider before launch — Resend, Postmark, or AWS SES all work. Your API keys are already in `.env.example` for Resend.
- Consider running **mail-tester.com** against a sample to make sure SPF / DKIM / DMARC are set on `mederti.com`.

## Future templates

If you add MFA, email-change, or magic-link-with-OTP, follow the same pattern — copy any of these files, swap the body copy, keep the header / footer / button structure intact.
