import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/chat/supabase";
import { checkRateLimit, getClientIp } from "@/lib/chat/rate-limit";
import type { LeadInput, LeadResponse, LeadType } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: LeadType[] = ["pre_order", "forward_order", "supplier_interest", "order"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<Response> {
  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Try again later." } satisfies LeadResponse,
      { status: 429 }
    );
  }

  let body: LeadInput;
  try {
    body = (await req.json()) as LeadInput;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." } satisfies LeadResponse, { status: 400 });
  }

  if (!body || !VALID_TYPES.includes(body.lead_type)) {
    return Response.json(
      { ok: false, error: "Invalid or missing lead_type." } satisfies LeadResponse,
      { status: 400 }
    );
  }
  if (!body.contact_email || !EMAIL_RE.test(body.contact_email)) {
    return Response.json(
      { ok: false, error: "Valid contact_email is required." } satisfies LeadResponse,
      { status: 400 }
    );
  }

  console.log(
    `[lead] ip=${ip} type=${body.lead_type} email=${body.contact_email} drug=${body.drug_name ?? body.drug_id ?? "-"} supplier=${body.supplier_name ?? "-"}`
  );

  const user_agent = req.headers.get("user-agent") || null;

  const row = {
    lead_type: body.lead_type,
    contact_email: body.contact_email.trim().toLowerCase(),
    contact_name: body.contact_name?.trim() || null,
    company_name: body.company_name?.trim() || null,
    country_code: body.country_code?.trim() || null,
    drug_id: body.drug_id || null,
    drug_name: body.drug_name?.trim() || null,
    alternative_drug_id: body.alternative_drug_id || null,
    alternative_drug_name: body.alternative_drug_name?.trim() || null,
    supplier_name: body.supplier_name?.trim() || null,
    volume_estimate: body.volume_estimate?.trim() || null,
    notes: body.notes?.trim() || null,
    source: "mederti-chat",
    user_agent,
    ip,
    raw_payload: body as unknown as Record<string, unknown>,
  };

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("leads").insert(row).select("id").single();
    if (error) {
      const friendly = error.message?.includes("relation") || error.code === "42P01"
        ? "leads table not yet created in Supabase — paste supabase/migrations/0001_leads.sql into the SQL editor"
        : error.message;
      console.warn(`[lead] persist failed (${error.code ?? "?"}): ${friendly}`);
      return Response.json(
        { ok: true, persisted: false, error: friendly } satisfies LeadResponse,
        { status: 200 }
      );
    }
    return Response.json(
      { ok: true, lead_id: data?.id, persisted: true } satisfies LeadResponse,
      { status: 200 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[lead] unexpected error:", msg);
    return Response.json(
      { ok: true, persisted: false, error: msg } satisfies LeadResponse,
      { status: 200 }
    );
  }
}
