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
| `{{ .ConfirmationURL }}` | The single-use auth link (different per template) |
| `{{ .Email }}` | The recipient's email address |
| `{{ .SiteURL }}` | The project's site URL set in Auth → URL Configuration |
| `{{ .Token }}` | 6-digit OTP code (only useful if you handle OTP flows manually) |
| `{{ .TokenHash }}` | Hashed version of the token |

## Deliverability notes

- **Set the "Sender Name"** in Supabase → Auth → SMTP Settings to `Mederti` (no email; that comes from the `noreply@mederti.com` or whatever you've configured as the From address).
- If you're still on the **Supabase default SMTP** (rate-limited to 4/hour per project), upgrade to a real SMTP provider before launch — Resend, Postmark, or AWS SES all work. Your API keys are already in `.env.example` for Resend.
- Consider running **mail-tester.com** against a sample to make sure SPF / DKIM / DMARC are set on `mederti.com`.

## Future templates

If you add MFA, email-change, or magic-link-with-OTP, follow the same pattern — copy any of these files, swap the body copy, keep the header / footer / button structure intact.
