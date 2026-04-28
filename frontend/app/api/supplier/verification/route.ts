import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

const resend =
  process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== "re_placeholder"
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

async function getUserId(): Promise<string | null> {
  try {
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/* GET — current verification status + uploaded documents */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from("supplier_profiles")
    .select("id, verification_status, verification_requested_at, verified")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) return NextResponse.json({ profile_required: true });

  const { data: docs } = await admin
    .from("supplier_documents")
    .select("id, document_type, document_name, expires_on, status, created_at, rejection_reason")
    .eq("supplier_id", (profile as { id: string }).id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    verification_status: (profile as { verification_status: string }).verification_status,
    verified: (profile as { verified: boolean }).verified,
    requested_at: (profile as { verification_requested_at: string | null }).verification_requested_at,
    documents: docs ?? [],
  });
}

/* POST — submit a verification request (with document references) */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from("supplier_profiles")
    .select("id, company_name, contact_email")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) return NextResponse.json({ error: "No supplier profile" }, { status: 400 });

  const supplierId = (profile as { id: string }).id;
  const body = await req.json();
  const documents = Array.isArray(body.documents) ? body.documents : [];

  // Insert document references (we don't store actual files yet — they're emailed)
  if (documents.length > 0) {
    await admin.from("supplier_documents").insert(
      documents.map((d: { document_type: string; document_name: string; expires_on?: string }) => ({
        supplier_id: supplierId,
        document_type: d.document_type,
        document_name: d.document_name,
        expires_on: d.expires_on || null,
        status: "pending",
      }))
    );
  }

  // Mark profile as verification pending
  await admin
    .from("supplier_profiles")
    .update({
      verification_status: "pending",
      verification_requested_at: new Date().toISOString(),
    })
    .eq("id", supplierId);

  // Notify Mederti team via email
  if (resend) {
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "intelligence@mederti.com",
        to: process.env.MEDERTI_OPS_EMAIL ?? "verification@mederti.com",
        subject: `[Verification request] ${(profile as { company_name: string }).company_name}`,
        html: `
          <h2>New verification request</h2>
          <p><strong>${(profile as { company_name: string }).company_name}</strong> has requested verified status.</p>
          <p>Contact: <a href="mailto:${(profile as { contact_email: string }).contact_email}">${(profile as { contact_email: string }).contact_email}</a></p>
          <p>Documents declared:</p>
          <ul>
            ${documents.map((d: { document_type: string; document_name: string }) => `<li>${d.document_type}: ${d.document_name}</li>`).join("")}
          </ul>
          <p><a href="https://mederti.vercel.app/admin/verifications">Review request →</a></p>
        `,
      });
    } catch (e) {
      console.error("[verification] email failed:", e);
    }
  }

  return NextResponse.json({ success: true });
}
