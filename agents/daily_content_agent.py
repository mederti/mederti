"""
Daily Content Agent — generates one intelligence article per day.

Cron: 0 21 * * * UTC  (7:00 AM AEST)
Entry: python -m agents.daily_content_agent
"""

import json
import os
import re
import sys
import datetime
import logging
from pathlib import Path
from collections import Counter

from dotenv import load_dotenv

load_dotenv()  # Load .env before any other imports that need env vars

import anthropic
from backend.utils.db import get_supabase_client
from backend.utils.logger import get_logger

log = get_logger("mederti.agent.daily_content")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CONTENT_SCHEDULE = {
    0: "NEWS",         # Monday
    1: "ANALYSIS",     # Tuesday
    2: "DATA_REPORT",  # Wednesday
    3: "NEWS",         # Thursday
    4: "ANALYSIS",     # Friday
    5: "DATA_REPORT",  # Saturday
    6: "NEWS",         # Sunday
}

CONTENT_TYPE_TO_CATEGORY = {
    "NEWS": "article",
    "ANALYSIS": "article",
    "DATA_REPORT": "data",
    "PODCAST_SUMMARY": "media",
}

SYSTEM_PROMPT = """You are a senior pharmaceutical supply chain journalist and analyst writing for Mederti Intelligence — the authoritative industry publication for pharmaceutical shortage intelligence, read by pharmacists, hospital procurement teams, regulators and pharmaceutical suppliers.

Your writing should be in the style of Bloomberg, The Economist or MIT Technology Review: precise, data-driven, authoritative, and accessible to an informed professional audience. Never sensationalise. Never speculate beyond what the data supports. Always cite the specific regulatory sources. Write in British English.

You MUST respond with valid JSON only. No markdown fences, no commentary outside the JSON object."""

NEWS_PROMPT = """Write a news article about the following shortage event.

Output a JSON object with these exact fields:
{{
  "title": "Strong news headline, under 80 characters",
  "description": "2-3 sentence summary for card display, max 60 words",
  "meta_description": "SEO meta description, max 160 characters",
  "pull_quote": "One impactful sentence to highlight",
  "read_time": "X min read",
  "sections": [
    {{"body": "Lead paragraph — who/what/where/when. No heading for the lead."}},
    {{"heading": "Section heading", "body": "Section content..."}},
    ...
  ]
}}

Include: a dateline, a lead paragraph that captures the who/what/where/when, 3-4 body paragraphs with analysis, and a closing paragraph on outlook. 4-6 sections total.

Data:
{context}"""

ANALYSIS_PROMPT = """Write an analytical piece examining the underlying causes and implications of this shortage.

Output a JSON object with these exact fields:
{{
  "title": "Compelling analytical headline, under 80 characters",
  "description": "2-3 sentence summary for card display, max 60 words",
  "meta_description": "SEO meta description, max 160 characters",
  "pull_quote": "One impactful sentence to highlight",
  "read_time": "X min read",
  "sections": [
    {{"body": "Opening that frames the broader issue. No heading for the lead."}},
    {{"heading": "Section heading", "body": "Section content..."}},
    ...
  ]
}}

Include: an opening that frames the broader issue, 4-5 analytical paragraphs examining causes, global context, supply chain factors and clinical implications, and a forward-looking conclusion. 5-7 sections total.

Data:
{context}"""

DATA_REPORT_PROMPT = """Write a data-focused report on current shortage trends. Lead with the most significant number.

Output a JSON object with these exact fields:
{{
  "title": "Report-style headline leading with data, under 80 characters",
  "description": "2-3 sentence summary for card display, max 60 words",
  "meta_description": "SEO meta description, max 160 characters",
  "pull_quote": "One impactful data-driven sentence to highlight",
  "read_time": "X min read",
  "sections": [
    {{"body": "Executive summary of 3 key findings. No heading for the lead."}},
    {{"heading": "Section heading", "body": "Detailed data analysis..."}},
    ...
  ]
}}

Include: an executive summary of 3 key findings, detailed data analysis in 4 paragraphs, a section on what the data means for each stakeholder group (pharmacists, hospitals, suppliers), and a methodology note. 5-7 sections total.

Data:
{context}"""

PROMPT_MAP = {
    "NEWS": NEWS_PROMPT,
    "ANALYSIS": ANALYSIS_PROMPT,
    "DATA_REPORT": DATA_REPORT_PROMPT,
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_todays_content_type() -> str:
    weekday = datetime.date.today().weekday()
    return CONTENT_SCHEDULE[weekday]


def was_recently_covered(supabase, drug_id: str, days: int = 7) -> bool:
    """Check if a drug was already covered in the last N days."""
    cutoff = (
        datetime.datetime.now(datetime.timezone.utc)
        - datetime.timedelta(days=days)
    ).isoformat()
    result = (
        supabase.table("intelligence_articles")
        .select("id")
        .eq("drug_id", drug_id)
        .gte("created_at", cutoff)
        .limit(1)
        .execute()
    )
    return len(result.data) > 0


def slugify(drug_name: str, date: datetime.date) -> str:
    """Generate URL-safe slug: 'amoxicillin-shortage-2026-03-13'."""
    slug_base = drug_name.lower().strip()
    slug_base = re.sub(r"[^a-z0-9\s-]", "", slug_base)
    slug_base = re.sub(r"[\s]+", "-", slug_base)
    slug_base = re.sub(r"-+", "-", slug_base).strip("-")
    return f"{slug_base}-shortage-{date.isoformat()}"


def parse_claude_json(text: str) -> dict:
    """Parse JSON from Claude response, stripping markdown fences if present."""
    cleaned = text.strip()
    # Strip markdown code fences
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        # Remove first line (```json or ```) and last line (```)
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()
    return json.loads(cleaned)


# ---------------------------------------------------------------------------
# Story selection
# ---------------------------------------------------------------------------

def find_story(supabase) -> dict | None:
    """Find the most newsworthy shortage event. Returns context dict or None."""
    now = datetime.datetime.now(datetime.timezone.utc)
    twenty_four_hours_ago = (now - datetime.timedelta(hours=24)).isoformat()

    # --- Priority 1: New critical shortages in last 24h ---
    log.info("Checking priority 1: new critical shortages")
    result = (
        supabase.table("shortage_events")
        .select("id, drug_id, country, country_code, severity, status, reason, start_date, created_at, drugs(id, generic_name, brand_names, atc_code)")
        .eq("severity", "critical")
        .eq("status", "active")
        .gte("created_at", twenty_four_hours_ago)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    if result.data:
        # Group by drug_id, pick the one affecting most countries
        by_drug: dict[str, list] = {}
        for ev in result.data:
            did = ev["drug_id"]
            if did not in by_drug:
                by_drug[did] = []
            by_drug[did].append(ev)

        for drug_id, events in sorted(by_drug.items(), key=lambda x: len(x[1]), reverse=True):
            if was_recently_covered(supabase, drug_id):
                continue
            drug_info = events[0].get("drugs", {})
            drug_name = drug_info.get("generic_name", "Unknown")
            countries = list({e["country_code"] or e["country"] for e in events if e.get("country_code") or e.get("country")})
            return _build_story_context(
                supabase, drug_id, drug_name, drug_info, events, countries,
                "New critical shortage declared in last 24 hours",
            )

    # --- Priority 2: Severity escalations ---
    log.info("Checking priority 2: severity escalations")
    result = (
        supabase.table("shortage_status_log")
        .select("id, shortage_event_id, drug_id, old_severity, new_severity, changed_at")
        .gte("changed_at", twenty_four_hours_ago)
        .order("changed_at", desc=True)
        .limit(50)
        .execute()
    )
    if result.data:
        sev_rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        scored = []
        for entry in result.data:
            old_r = sev_rank.get(entry.get("old_severity"), 0)
            new_r = sev_rank.get(entry.get("new_severity"), 0)
            if new_r > old_r:
                scored.append((new_r - old_r, entry))
        scored.sort(key=lambda x: x[0], reverse=True)

        for _score, entry in scored:
            drug_id = entry["drug_id"]
            if was_recently_covered(supabase, drug_id):
                continue
            # Fetch drug info
            drug_res = supabase.table("drugs").select("id, generic_name, brand_names, atc_code").eq("id", drug_id).single().execute()
            if not drug_res.data:
                continue
            drug_info = drug_res.data
            drug_name = drug_info["generic_name"]
            # Get active shortage events for this drug
            events_res = (
                supabase.table("shortage_events")
                .select("id, drug_id, country, country_code, severity, status, reason, start_date")
                .eq("drug_id", drug_id)
                .eq("status", "active")
                .execute()
            )
            events = events_res.data or []
            countries = list({e["country_code"] or e["country"] for e in events if e.get("country_code") or e.get("country")})
            return _build_story_context(
                supabase, drug_id, drug_name, drug_info, events, countries,
                f"Severity escalation: {entry.get('old_severity')} → {entry.get('new_severity')}",
            )

    # --- Priority 3: Most multi-country shortage ---
    log.info("Checking priority 3: most multi-country shortages")
    result = (
        supabase.table("shortage_events")
        .select("drug_id, country_code")
        .eq("status", "active")
        .execute()
    )
    if result.data:
        drug_countries: dict[str, set] = {}
        for row in result.data:
            did = row["drug_id"]
            cc = row.get("country_code")
            if did and cc:
                drug_countries.setdefault(did, set()).add(cc)

        ranked = sorted(drug_countries.items(), key=lambda x: len(x[1]), reverse=True)
        for drug_id, cc_set in ranked:
            if len(cc_set) < 2:
                break  # No point if only 1 country
            if was_recently_covered(supabase, drug_id):
                continue
            drug_res = supabase.table("drugs").select("id, generic_name, brand_names, atc_code").eq("id", drug_id).single().execute()
            if not drug_res.data:
                continue
            drug_info = drug_res.data
            drug_name = drug_info["generic_name"]
            events_res = (
                supabase.table("shortage_events")
                .select("id, drug_id, country, country_code, severity, status, reason, start_date")
                .eq("drug_id", drug_id)
                .eq("status", "active")
                .execute()
            )
            events = events_res.data or []
            countries = list(cc_set)
            return _build_story_context(
                supabase, drug_id, drug_name, drug_info, events, countries,
                f"Active shortage across {len(countries)} countries",
            )

    # --- Priority 4: Highest risk velocity ---
    log.info("Checking priority 4: highest risk velocity")
    now_date = datetime.date.today()
    thirty_days_ago = (now - datetime.timedelta(days=30)).isoformat()
    sixty_days_ago = (now - datetime.timedelta(days=60)).isoformat()

    recent = (
        supabase.table("shortage_events")
        .select("drug_id, created_at")
        .eq("status", "active")
        .gte("created_at", sixty_days_ago)
        .execute()
    )
    if recent.data:
        last30: Counter = Counter()
        prior30: Counter = Counter()
        for row in recent.data:
            did = row["drug_id"]
            created = row["created_at"]
            if created >= thirty_days_ago:
                last30[did] += 1
            else:
                prior30[did] += 1

        # Score by velocity (acceleration)
        velocity_scores = []
        for did in set(last30) | set(prior30):
            l = last30[did]
            p = prior30[did]
            if p > 0:
                v = (l - p) * 4 + min(l, 10) * 2
            elif l > 0:
                v = l * 5
            else:
                v = 0
            velocity_scores.append((max(0, v), did))

        velocity_scores.sort(reverse=True)
        for _score, drug_id in velocity_scores:
            if _score < 5:
                break
            if was_recently_covered(supabase, drug_id):
                continue
            drug_res = supabase.table("drugs").select("id, generic_name, brand_names, atc_code").eq("id", drug_id).single().execute()
            if not drug_res.data:
                continue
            drug_info = drug_res.data
            drug_name = drug_info["generic_name"]
            events_res = (
                supabase.table("shortage_events")
                .select("id, drug_id, country, country_code, severity, status, reason, start_date")
                .eq("drug_id", drug_id)
                .eq("status", "active")
                .execute()
            )
            events = events_res.data or []
            countries = list({e["country_code"] or e["country"] for e in events if e.get("country_code") or e.get("country")})
            return _build_story_context(
                supabase, drug_id, drug_name, drug_info, events, countries,
                f"High risk velocity score ({_score})",
            )

    log.info("No newsworthy events found across all priority levels")
    return None


def _build_story_context(
    supabase, drug_id: str, drug_name: str, drug_info: dict,
    events: list, countries: list, priority_reason: str,
) -> dict:
    """Assemble the full story context dict for Claude."""
    # Severity breakdown
    severities = Counter(e.get("severity") for e in events if e.get("severity"))

    # Get recent status log entries for this drug
    log_res = (
        supabase.table("shortage_status_log")
        .select("old_severity, new_severity, old_status, new_status, changed_at")
        .eq("drug_id", drug_id)
        .order("changed_at", desc=True)
        .limit(10)
        .execute()
    )
    status_log = log_res.data or []

    return {
        "drug_id": drug_id,
        "drug_name": drug_name,
        "drug_info": {
            "generic_name": drug_info.get("generic_name"),
            "brand_names": drug_info.get("brand_names"),
            "atc_code": drug_info.get("atc_code"),
        },
        "priority_reason": priority_reason,
        "shortage_events": [
            {
                "id": e.get("id"),
                "country": e.get("country"),
                "country_code": e.get("country_code"),
                "severity": e.get("severity"),
                "status": e.get("status"),
                "reason": e.get("reason"),
                "start_date": e.get("start_date"),
            }
            for e in events[:20]  # Cap at 20 events to keep context manageable
        ],
        "countries_affected": countries,
        "severity_breakdown": dict(severities),
        "total_active_shortages": len(events),
        "status_log_entries": [
            {
                "old_severity": s.get("old_severity"),
                "new_severity": s.get("new_severity"),
                "old_status": s.get("old_status"),
                "new_status": s.get("new_status"),
                "changed_at": s.get("changed_at"),
            }
            for s in status_log
        ],
    }


# ---------------------------------------------------------------------------
# Article generation
# ---------------------------------------------------------------------------

def generate_article(content_type: str, story_context: dict) -> dict:
    """Generate an article using Claude API. Returns parsed article dict."""
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    prompt_template = PROMPT_MAP[content_type]
    user_prompt = prompt_template.format(context=json.dumps(story_context, indent=2, default=str))

    log.info("Calling Claude API", extra={"content_type": content_type, "drug": story_context["drug_name"]})

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    response_text = message.content[0].text
    try:
        article = parse_claude_json(response_text)
    except json.JSONDecodeError:
        log.warning("First JSON parse failed, retrying with explicit instruction")
        retry_msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_prompt},
                {"role": "assistant", "content": response_text},
                {"role": "user", "content": "Your response was not valid JSON. Please output ONLY the JSON object, no markdown fences or other text."},
            ],
        )
        article = parse_claude_json(retry_msg.content[0].text)

    # Validate required fields
    required = ["title", "description", "sections"]
    for field in required:
        if field not in article:
            raise ValueError(f"Generated article missing required field: {field}")

    if not isinstance(article["sections"], list) or len(article["sections"]) == 0:
        raise ValueError("Generated article has empty sections")

    return article


# ---------------------------------------------------------------------------
# Save draft
# ---------------------------------------------------------------------------

def save_draft(supabase, article: dict, story_context: dict, content_type: str) -> str:
    """Save generated article as draft. Returns the article ID."""
    today = datetime.date.today()
    slug = slugify(story_context["drug_name"], today)

    row = {
        "slug": slug,
        "title": article["title"],
        "description": article["description"],
        "category": CONTENT_TYPE_TO_CATEGORY[content_type],
        "content_type": content_type,
        "body_json": article["sections"],
        "author": "Mederti Intelligence",
        "read_time": article.get("read_time"),
        "status": "draft",
        "drug_id": story_context["drug_id"],
        "drug_name": story_context["drug_name"],
        "shortage_event_id": story_context["shortage_events"][0]["id"] if story_context["shortage_events"] else None,
        "source_data": story_context,
        "meta_description": article.get("meta_description"),
        "pull_quote": article.get("pull_quote"),
    }

    result = supabase.table("intelligence_articles").insert(row).execute()
    article_id = result.data[0]["id"] if result.data else "unknown"
    return article_id


# ---------------------------------------------------------------------------
# File logging
# ---------------------------------------------------------------------------

def log_to_file(title: str, article_id: str):
    """Append draft info to logs/content_agent.log."""
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    log_path = log_dir / "content_agent.log"
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with open(log_path, "a") as f:
        f.write(f"[{timestamp}] Draft created: {title} (id={article_id})\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    log.info("Daily content agent started")

    try:
        supabase = get_supabase_client()
    except Exception as e:
        log.error("Failed to connect to Supabase", extra={"error": str(e)})
        return 1

    # Step 1: Content type
    content_type = get_todays_content_type()
    log.info("Content type for today", extra={"content_type": content_type, "weekday": datetime.date.today().strftime("%A")})

    # Step 2: Find story
    try:
        story = find_story(supabase)
    except Exception as e:
        log.error("Failed during story selection", extra={"error": str(e)}, exc_info=True)
        return 1

    if story is None:
        log.info("No newsworthy events found — no article generated today")
        return 0

    log.info("Story selected", extra={
        "drug": story["drug_name"],
        "countries": story["countries_affected"],
        "reason": story["priority_reason"],
    })

    # Step 3: Generate article
    try:
        article = generate_article(content_type, story)
    except Exception as e:
        log.error("Failed to generate article", extra={"error": str(e)}, exc_info=True)
        return 1

    log.info("Article generated", extra={"title": article["title"]})

    # Step 4: Save draft
    try:
        article_id = save_draft(supabase, article, story, content_type)
    except Exception as e:
        log.error("Failed to save draft", extra={"error": str(e)}, exc_info=True)
        return 1

    log.info("Draft saved", extra={"id": article_id, "title": article["title"]})
    log_to_file(article["title"], article_id)

    return 0


if __name__ == "__main__":
    sys.exit(main())
