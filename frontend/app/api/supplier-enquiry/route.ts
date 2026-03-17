import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { Resend } from "resend";
import { getPartnerForCountry } from "@/lib/suppliers";

const resend =
  process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== "re_placeholder"
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

export async function POST(req: NextRequest) {
  const { drugName, drugId, quantity, urgency, organisation, message, country, userEmail, userId } =
    await req.json();

  if (!drugName || !urgency || !country) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const partner = getPartnerForCountry(country);
  if (!partner) {
    return NextResponse.json({ error: "No partner for this country" }, { status: 404 });
  }

  // Override contact email with env var if set
  const EMAIL_OVERRIDES: Record<string, string | undefined> = {
    AU: process.env.SUPPLIER_AU_EMAIL,
    GB: process.env.SUPPLIER_GB_EMAIL,
  };
  const partnerEmail = EMAIL_OVERRIDES[country] ?? partner.contactEmail;

  // Save to Supabase
  const sb = getSupabaseAdmin();
  const { error: dbError } = await sb.from("supplier_enquiries").insert({
    drug_id: drugId ?? null,
    drug_name: drugName,
    quantity,
    urgency,
    organisation,
    message,
    country,
    partner_id: partner.id,
    user_email: userEmail ?? null,
    user_id: userId ?? null,
    status: "sent",
  });

  if (dbError) {
    console.error("[supplier-enquiry] DB insert failed:", dbError.message);
    return NextResponse.json({ error: "Failed to save enquiry" }, { status: 500 });
  }

  // Email to partner
  if (resend) {
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
        to: partnerEmail,
        subject: `[Mederti] ${urgency.toUpperCase()} enquiry — ${drugName}`,
        html: `
          <h2>New supplier enquiry via Mederti</h2>
          <table cellpadding="6">
            <tr><td><strong>Drug</strong></td><td>${drugName}</td></tr>
            <tr><td><strong>Urgency</strong></td><td>${urgency}</td></tr>
            <tr><td><strong>Quantity</strong></td><td>${quantity || "Not specified"}</td></tr>
            <tr><td><strong>Organisation</strong></td><td>${organisation || "Not provided"}</td></tr>
            <tr><td><strong>Contact email</strong></td><td>${userEmail || "Not provided"}</td></tr>
            <tr><td><strong>Message</strong></td><td>${message || "—"}</td></tr>
          </table>
          <p>Please respond within ${partner.responseTime}.</p>
        `,
      });
    } catch (e) {
      console.error("[supplier-enquiry] Partner email failed:", e);
    }

    // Confirmation to user
    if (userEmail) {
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
          to: userEmail,
          subject: `Your enquiry for ${drugName} has been sent`,
          html: `
            <h2>Enquiry sent to ${partner.name}</h2>
            <p>Your enquiry for <strong>${drugName}</strong> has been forwarded to <strong>${partner.name}</strong>.</p>
            <p>They will respond within <strong>${partner.responseTime}</strong>.</p>
            <p>Urgency: ${urgency} · Quantity: ${quantity || "not specified"}</p>
            <p>—<br>The Mederti team</p>
          `,
        });
      } catch (e) {
        console.error("[supplier-enquiry] User confirmation email failed:", e);
      }
    }
  } else {
    console.log(`[supplier-enquiry] RESEND_API_KEY not set — skipping emails for ${drugName}`);
  }

  return NextResponse.json({ success: true, partner: partner.name });
}
