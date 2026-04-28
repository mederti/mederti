import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

const resend =
  process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== "re_placeholder"
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

async function getAuthUserId(): Promise<string | null> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function getSupplier(userId: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("supplier_profiles")
    .select("id, company_name, contact_email, verified, tier")
    .eq("user_id", userId)
    .maybeSingle();
  return data as { id: string; company_name: string; contact_email: string; verified: boolean; tier: string } | null;
}

/* GET: list quotes submitted by the logged-in supplier */
export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supplier = await getSupplier(userId);
  if (!supplier) return NextResponse.json({ quotes: [], profile_required: true });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("supplier_quotes")
    .select(`
      id, enquiry_id, quote_amount, currency, available_quantity, delivery_eta,
      notes, pipeline_stage, valid_until, viewed_by_buyer_at, won_at, lost_reason,
      created_at, updated_at,
      supplier_enquiries!inner (id, drug_name, drug_id, country, urgency, organisation, user_email, created_at)
    `)
    .eq("supplier_id", supplier.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("supplier/quotes GET:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ quotes: data ?? [] });
}

/* POST: submit a new quote against an enquiry */
export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supplier = await getSupplier(userId);
  if (!supplier) return NextResponse.json({ error: "Set up supplier profile first" }, { status: 400 });

  const body = await req.json();
  if (!body.enquiry_id) {
    return NextResponse.json({ error: "enquiry_id required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Fetch the enquiry to get buyer info for notification
  const { data: enquiry } = await admin
    .from("supplier_enquiries")
    .select("id, drug_name, country, user_email, organisation, urgency")
    .eq("id", body.enquiry_id)
    .maybeSingle();

  if (!enquiry) return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });

  // Insert quote
  const payload = {
    enquiry_id: body.enquiry_id,
    supplier_id: supplier.id,
    quote_amount: body.quote_amount ? Number(body.quote_amount) : null,
    currency: body.currency || "AUD",
    available_quantity: body.available_quantity || null,
    delivery_eta: body.delivery_eta || null,
    minimum_order_quantity: body.minimum_order_quantity || null,
    shipping_terms: body.shipping_terms || null,
    payment_terms: body.payment_terms || null,
    notes: body.notes || null,
    valid_until: body.valid_until || null,
    pipeline_stage: "submitted",
  };

  const { data: quote, error } = await admin
    .from("supplier_quotes")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("supplier/quotes POST:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Track analytics
  await admin.from("supplier_analytics_events").insert({
    supplier_id: supplier.id,
    event_type: "quote_submitted",
    metadata: { enquiry_id: body.enquiry_id, drug_name: enquiry.drug_name },
  });

  // Email the buyer
  if (resend && enquiry.user_email) {
    const subject = `Quote received for ${enquiry.drug_name} from ${supplier.company_name}`;
    const verifiedBadge = supplier.verified ? "✓ Verified supplier" : "Supplier";
    const formatPrice = (a: number | null, c: string) => a ? `${c} ${a.toFixed(2)}` : "On request";

    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
        to: enquiry.user_email,
        subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #0F172A; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <div style="font-size: 11px; letter-spacing: 0.1em; color: #5EEAD4; text-transform: uppercase; font-weight: 700;">
                ${verifiedBadge}
              </div>
              <h2 style="margin: 8px 0 0; font-size: 22px;">${supplier.company_name}</h2>
              <div style="font-size: 14px; color: #94A3B8; margin-top: 8px;">has submitted a quote for your enquiry</div>
            </div>
            <div style="padding: 24px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: none;">
              <h3 style="margin: 0 0 16px; font-size: 16px; color: #0F172A;">${enquiry.drug_name}</h3>
              <table cellpadding="8" style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr style="border-bottom: 1px solid #E2E8F0;">
                  <td style="color: #64748B; width: 40%;">Unit price</td>
                  <td style="font-weight: 600; color: #0F172A;">${formatPrice(payload.quote_amount, payload.currency)}</td>
                </tr>
                ${payload.available_quantity ? `<tr style="border-bottom: 1px solid #E2E8F0;"><td style="color: #64748B;">Available quantity</td><td style="color: #0F172A;">${payload.available_quantity}</td></tr>` : ""}
                ${payload.delivery_eta ? `<tr style="border-bottom: 1px solid #E2E8F0;"><td style="color: #64748B;">Delivery ETA</td><td style="color: #0F172A;">${payload.delivery_eta}</td></tr>` : ""}
                ${payload.minimum_order_quantity ? `<tr style="border-bottom: 1px solid #E2E8F0;"><td style="color: #64748B;">MOQ</td><td style="color: #0F172A;">${payload.minimum_order_quantity}</td></tr>` : ""}
                ${payload.shipping_terms ? `<tr style="border-bottom: 1px solid #E2E8F0;"><td style="color: #64748B;">Shipping</td><td style="color: #0F172A;">${payload.shipping_terms}</td></tr>` : ""}
                ${payload.payment_terms ? `<tr style="border-bottom: 1px solid #E2E8F0;"><td style="color: #64748B;">Payment</td><td style="color: #0F172A;">${payload.payment_terms}</td></tr>` : ""}
                ${payload.valid_until ? `<tr style="border-bottom: 1px solid #E2E8F0;"><td style="color: #64748B;">Valid until</td><td style="color: #0F172A;">${payload.valid_until}</td></tr>` : ""}
              </table>
              ${payload.notes ? `<div style="margin-top: 16px; padding: 12px; background: white; border-radius: 6px; font-size: 13px; color: #475569;">${payload.notes}</div>` : ""}
              <div style="margin-top: 24px; padding: 16px; background: white; border-radius: 6px;">
                <div style="font-size: 12px; color: #64748B; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;">Reply directly</div>
                <div style="margin-top: 6px;"><a href="mailto:${supplier.contact_email}?subject=Re: ${enquiry.drug_name} quote" style="color: #0D9488; font-weight: 600; font-size: 14px; text-decoration: none;">${supplier.contact_email}</a></div>
              </div>
            </div>
            <div style="padding: 16px 24px; background: #0F172A; color: #94A3B8; font-size: 11px; border-radius: 0 0 8px 8px; text-align: center;">
              Sent via Mederti — global pharmaceutical supply intelligence
            </div>
          </div>
        `,
      });
    } catch (e) {
      console.error("[supplier/quotes] buyer email failed:", e);
    }
  }

  return NextResponse.json({ quote });
}

/* PATCH: update quote pipeline stage (won/lost/etc.) */
export async function PATCH(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supplier = await getSupplier(userId);
  if (!supplier) return NextResponse.json({ error: "No supplier profile" }, { status: 400 });

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const updates: Record<string, unknown> = {};
  if (body.pipeline_stage) updates.pipeline_stage = body.pipeline_stage;
  if (body.lost_reason !== undefined) updates.lost_reason = body.lost_reason;
  if (body.pipeline_stage === "won") updates.won_at = new Date().toISOString();

  const { data, error } = await admin
    .from("supplier_quotes")
    .update(updates)
    .eq("id", body.id)
    .eq("supplier_id", supplier.id)
    .select()
    .single();

  if (error) {
    console.error("supplier/quotes PATCH:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.pipeline_stage === "won") {
    await admin.from("supplier_analytics_events").insert({
      supplier_id: supplier.id,
      event_type: "quote_won",
      metadata: { quote_id: body.id },
    });
  }

  return NextResponse.json({ quote: data });
}
