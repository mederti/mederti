import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { getPartnerForCountry } from "@/lib/suppliers";
import { recordDemandSignal } from "@/lib/demand-signal";
import { getClientIp } from "@/lib/chat/rate-limit";

const resend =
  process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== "re_placeholder"
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

// The Mederti sourcing team is always notified of an enquiry — they coordinate
// sourcing on the buyer's behalf, especially in markets with no local wholesale
// partner (every country outside AU/GB). Overridable via env.
const MEDERTI_INBOX = process.env.MEDERTI_SOURCING_EMAIL ?? "hello@mederti.com";

/**
 * POST /api/supplier-enquiry
 *
 * Buyer submits enquiry. We:
 *  1. Save to supplier_enquiries
 *  2. Email the legacy AU/GB partners (Barwon, Alliance) for backward compat
 *  3. Email all registered suppliers serving this country (marketplace lead notification)
 *  4. Insert in-app notification rows for each matched supplier
 *  5. Email confirmation to buyer
 */
export async function POST(req: NextRequest) {
  // SECURITY: `userId` is NEVER read from the request body — it would be
  // spoofable, allowing an attacker to plant enquiries under another user's
  // account (which the `Users can view own enquiries` RLS policy would then
  // expose to the spoofed owner). We resolve the caller from the session
  // cookie below. `userEmail` from the body is treated only as a fallback
  // contact address for anonymous enquiries.
  const { drugName, drugId, quantity, urgency, organisation, message, country, userEmail: bodyContactEmail } =
    await req.json();

  if (!drugName || !urgency || !country) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Demand-signal instrumentation — enquiry signal (Sprint 4 PR 1).
  // Recorded BEFORE the rest of the workflow so a downstream Resend / RLS
  // failure doesn't suppress the buyer-side signal.
  recordDemandSignal({
    signal_type: "enquiry",
    drug_id: drugId ?? null,
    raw_query: drugName,
    country_code: country,
    identifier: getClientIp(req),
  });

  // Resolve the calling user from the auth session. Null for anonymous
  // enquiries — those are still allowed (no signin required), but their
  // user_id is left null so they can't appear in anyone else's history.
  let sessionUserId: string | null = null;
  let sessionUserEmail: string | null = null;
  try {
    const sbSession = await createServerClient();
    const { data: { user } } = await sbSession.auth.getUser();
    sessionUserId = user?.id ?? null;
    sessionUserEmail = user?.email ?? null;
  } catch {
    // Anonymous enquiry — leave both null.
  }

  // Contact email: prefer the verified session email; fall back to the
  // body-provided one only for anonymous submissions.
  const contactEmail: string | null = sessionUserEmail ?? bodyContactEmail ?? null;

  const partner = getPartnerForCountry(country);
  // Note: partner is now optional — marketplace suppliers may exist instead
  const sb = getSupabaseAdmin();

  // ── 1. Save to DB ──
  const { data: enquiry, error: dbError } = await sb
    .from("supplier_enquiries")
    .insert({
      drug_id: drugId ?? null,
      drug_name: drugName,
      quantity,
      urgency,
      organisation,
      message,
      country,
      partner_id: partner?.id ?? "marketplace",
      user_email: contactEmail,
      user_id: sessionUserId,
      status: "sent",
    })
    .select()
    .single();

  if (dbError || !enquiry) {
    console.error("[supplier-enquiry] DB insert failed:", dbError?.message);
    return NextResponse.json({ error: "Failed to save enquiry" }, { status: 500 });
  }

  // ── 2. Find all marketplace suppliers serving this country ──
  const { data: matchedSuppliers } = await sb
    .from("supplier_profiles")
    .select("id, company_name, contact_email, tier, verified, countries_served")
    .or(`countries_served.cs.{${country}},countries_served.eq.{}`);

  const targetSuppliers = (matchedSuppliers ?? []).filter((s) => {
    const cs = (s.countries_served as string[]) ?? [];
    return cs.length === 0 || cs.includes(country);
  });

  // ── 3. Insert in-app notifications for each supplier ──
  if (targetSuppliers.length > 0) {
    const notifications = targetSuppliers.map((s) => ({
      supplier_id: s.id,
      notification_type: "new_enquiry",
      title: `New ${urgency} enquiry: ${drugName}`,
      body: `${organisation || "A buyer"} in ${country} is looking for ${drugName}${quantity ? ` (${quantity})` : ""}. Submit a quote within 24h to maximise win rate.`,
      link_url: `/supplier-dashboard/inbox`,
      related_enquiry_id: enquiry.id,
    }));

    await sb.from("supplier_notifications").insert(notifications);

    // Track analytics
    await sb.from("supplier_analytics_events").insert(
      targetSuppliers.map((s) => ({
        supplier_id: s.id,
        event_type: "enquiry_received",
        drug_id: drugId ?? null,
        buyer_country: country,
      }))
    );
  }

  // ── 4. Send emails ──
  if (resend) {
    // 4a-0. Always notify the Mederti sourcing team. This is the primary
    // recipient for the universal "Find a supplier" CTA on the drug page.
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
        to: MEDERTI_INBOX,
        replyTo: contactEmail ?? undefined,
        subject: `[Mederti sourcing] ${urgency.toUpperCase()} request — ${drugName} (${country})`,
        html: leadEmailHtml({ drugName, urgency, quantity, organisation, userEmail: contactEmail, message, country, supplierName: "Mederti sourcing" }),
      });
    } catch (e) {
      console.error("[supplier-enquiry] Mederti inbox email failed:", e);
    }

    // 4a. Email legacy partner (backward compatible)
    if (partner) {
      const EMAIL_OVERRIDES: Record<string, string | undefined> = {
        AU: process.env.SUPPLIER_AU_EMAIL,
        GB: process.env.SUPPLIER_GB_EMAIL,
      };
      const partnerEmail = EMAIL_OVERRIDES[country] ?? partner.contactEmail;
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
          to: partnerEmail,
          subject: `[Mederti] ${urgency.toUpperCase()} enquiry — ${drugName}`,
          html: leadEmailHtml({ drugName, urgency, quantity, organisation, userEmail: contactEmail, message, country, supplierName: partner.name }),
        });
      } catch (e) {
        console.error("[supplier-enquiry] Partner email failed:", e);
      }
    }

    // 4b. Email each marketplace supplier (the new revenue mechanic)
    for (const s of targetSuppliers) {
      // Skip free-tier suppliers if they're past the tier limit (handled in inbox UI)
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
          to: s.contact_email,
          subject: `[Mederti] New ${urgency} buyer enquiry — ${drugName} in ${country}`,
          html: leadEmailHtml({
            drugName,
            urgency,
            quantity,
            organisation,
            userEmail: contactEmail,
            message,
            country,
            supplierName: s.company_name,
          }),
        });
      } catch (e) {
        console.error(`[supplier-enquiry] Supplier email failed for ${s.company_name}:`, e);
      }
    }

    // 4c. Confirmation to buyer. Framed around the Mederti sourcing team (who
    // are always notified); mentions matched suppliers only when some exist.
    if (contactEmail) {
      const supplierCount = targetSuppliers.length + (partner ? 1 : 0);
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
          to: contactEmail,
          subject: `We've received your request for ${drugName}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px;">
              <h2 style="color: #0F172A;">Request received</h2>
              <p>Thanks — the Mederti sourcing team has received your request for <strong>${drugName}</strong> and will look into whether it can be sourced for you.</p>
              ${supplierCount > 0
                ? `<p>We've also forwarded it to ${supplierCount} supplier${supplierCount === 1 ? "" : "s"} serving ${country}, so you may receive quotes directly within 24–48 hours.</p>`
                : `<p>We'll get back to you by email, typically within one business day.</p>`}
              <table cellpadding="6" style="margin: 16px 0;">
                <tr><td>Urgency:</td><td><strong>${urgency}</strong></td></tr>
                <tr><td>Quantity:</td><td>${quantity || "not specified"}</td></tr>
                <tr><td>Country:</td><td>${country}</td></tr>
              </table>
              <p style="color: #64748B; font-size: 13px;">— The Mederti team</p>
            </div>
          `,
        });
      } catch (e) {
        console.error("[supplier-enquiry] User confirmation email failed:", e);
      }
    }
  } else {
    console.log(`[supplier-enquiry] RESEND_API_KEY not set — skipping emails for ${drugName}`);
  }

  return NextResponse.json({
    success: true,
    suppliers_notified: targetSuppliers.length + (partner ? 1 : 0),
  });
}

function leadEmailHtml(p: {
  drugName: string;
  urgency: string;
  quantity: string | null;
  organisation: string | null;
  userEmail: string | null;
  message: string | null;
  country: string;
  supplierName: string;
}): string {
  const urgencyColor =
    p.urgency.toLowerCase() === "critical" ? "#DC2626" :
    p.urgency.toLowerCase() === "urgent" ? "#D97706" : "#64748B";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0F172A; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <div style="font-size: 11px; letter-spacing: 0.1em; color: #5EEAD4; text-transform: uppercase; font-weight: 700;">
          New buyer enquiry
        </div>
        <h2 style="margin: 8px 0 0; font-size: 24px;">${p.drugName}</h2>
        <div style="margin-top: 8px; display: inline-block; padding: 4px 10px; background: ${urgencyColor}; color: white; font-size: 11px; font-weight: 700; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em;">
          ${p.urgency}
        </div>
      </div>
      <div style="padding: 24px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: none;">
        <table cellpadding="8" style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="color: #64748B; width: 35%;">Country</td>
            <td style="color: #0F172A; font-weight: 600;">${p.country}</td>
          </tr>
          ${p.quantity ? `<tr style="border-bottom: 1px solid #E2E8F0;"><td style="color: #64748B;">Quantity needed</td><td style="color: #0F172A;">${p.quantity}</td></tr>` : ""}
          ${p.organisation ? `<tr style="border-bottom: 1px solid #E2E8F0;"><td style="color: #64748B;">Organisation</td><td style="color: #0F172A;">${p.organisation}</td></tr>` : ""}
          ${p.userEmail ? `<tr style="border-bottom: 1px solid #E2E8F0;"><td style="color: #64748B;">Contact email</td><td><a href="mailto:${p.userEmail}" style="color: #0D9488;">${p.userEmail}</a></td></tr>` : ""}
        </table>
        ${p.message ? `<div style="margin-top: 16px; padding: 12px; background: white; border-radius: 6px; font-size: 13px; color: #475569; border-left: 3px solid #0D9488;">${p.message}</div>` : ""}
        <div style="margin-top: 24px; text-align: center;">
          <a href="https://mederti.vercel.app/supplier-dashboard/inbox" style="display: inline-block; padding: 12px 24px; background: #0D9488; color: white; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
            View enquiry & submit quote
          </a>
        </div>
      </div>
      <div style="padding: 16px 24px; background: #0F172A; color: #94A3B8; font-size: 11px; border-radius: 0 0 8px 8px; text-align: center;">
        Sent to ${p.supplierName} via Mederti — global pharmaceutical supply intelligence
      </div>
    </div>
  `;
}
