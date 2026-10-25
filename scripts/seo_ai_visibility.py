"""
AI-visibility section of the weekly SEO report (scripts/seo_weekly_report.py).

Two signals:

  1. Citation check — asks a fixed set of shortage questions
     (scripts/seo_ai_prompts.json) to AI assistants with live web search, the
     way a pharmacist would, and records for each answer whether Mederti was
       • cited     — a mederti.com URL is among the answer's citations
       • retrieved — the search found a mederti.com page but the answer didn't cite it
       • mentioned — "Mederti" appears in the answer text with no link
       • absent    — none of the above
     plus which domains WERE cited, i.e. who we're losing to.

  2. AI referral traffic — visits whose referrer is an AI assistant
     (chatgpt.com, perplexity.ai, claude.ai, copilot, gemini), last 7 days vs
     the 7 before, from the Vercel Web Analytics query API.

Each provider runs only when its credentials are set, so the report degrades
to "not configured" rather than failing:

  ANTHROPIC_API_KEY      Claude (Opus 5.5 + web search) — via the anthropic SDK
  OPENAI_API_KEY         ChatGPT (Responses API + web_search)  [shape unverified, no key yet]
  PERPLEXITY_API_KEY     Perplexity (Sonar)                    [shape unverified, no key yet]
  VERCEL_ANALYTICS_TOKEN AI referral traffic

Answers vary run to run, so treat one week's single miss as noise and watch
the trend. Cost: ~10 questions × each enabled provider, roughly $1–3/week for
Claude at current pricing.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROMPTS_FILE = Path(__file__).with_name("seo_ai_prompts.json")
OUR_DOMAIN = "mederti.com"
NAME_RE = re.compile(r"\bmederti\b", re.I)
# Links written into the answer itself. With the dynamic-filtering web search
# tool, Claude reads results through code execution and cites sources as
# markdown links in the text rather than as citation objects, so both count.
URL_RE = re.compile(r"https?://[^\s)\]>\"'`]+")

# Referrer hostnames that mean "a person clicked through from an AI assistant".
AI_REFERRERS = {
    "chatgpt.com": "ChatGPT", "chat.openai.com": "ChatGPT",
    "perplexity.ai": "Perplexity",
    "claude.ai": "Claude",
    "copilot.microsoft.com": "Copilot",
    "gemini.google.com": "Gemini",
    "chat.mistral.ai": "Mistral",
    "chat.deepseek.com": "DeepSeek",
}

LEVELS = ("cited", "retrieved", "mentioned", "absent")
ICON = {"cited": "✅ cited", "retrieved": "🟡 found, not cited", "mentioned": "🟡 named, no link",
        "absent": "—", "error": "⚠️ error", "refused": "⚠️ refused"}


def _domain(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    return host.removeprefix("www.")


def _ours(url: str) -> bool:
    d = _domain(url)
    return d == OUR_DOMAIN or d.endswith("." + OUR_DOMAIN)


def _classify(text: str, cited: list[str], retrieved: list[str]) -> str:
    if any(_ours(u) for u in cited):
        return "cited"
    if any(_ours(u) for u in retrieved):
        return "retrieved"
    if NAME_RE.search(text or ""):
        return "mentioned"
    return "absent"


# ── Providers ───────────────────────────────────────────────────────────────

def ask_claude(question: str) -> dict:
    import anthropic  # only needed when this provider is enabled

    client = anthropic.Anthropic()
    messages = [{"role": "user", "content": question}]
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 5}]
    cited, retrieved, text = [], [], []
    try:
        for _ in range(4):  # server-side search loop can pause_turn; resume a few times at most
            resp = client.beta.messages.create(
                model="claude-opus-5-5",
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": "medium"},
                tools=tools,
                messages=messages,
            )
            if resp.stop_reason == "refusal":
                return {"level": "refused", "error": getattr(resp.stop_details, "category", None)}
            for block in resp.content:
                if block.type == "web_search_tool_result" and isinstance(block.content, list):
                    retrieved += [r.url for r in block.content if getattr(r, "url", None)]
                elif block.type == "text":
                    text.append(block.text)
                    cited += [c.url for c in (block.citations or []) if getattr(c, "url", None)]
            if resp.stop_reason != "pause_turn":
                break
            messages = [{"role": "user", "content": question}, {"role": "assistant", "content": resp.content}]
    except anthropic.RateLimitError as e:
        return {"level": "error", "error": f"rate limited: {e.message}"}
    except anthropic.APIStatusError as e:
        return {"level": "error", "error": f"HTTP {e.status_code}: {e.message}"[:200]}
    except anthropic.APIConnectionError as e:
        return {"level": "error", "error": f"connection: {e}"[:200]}
    body = "\n".join(text)
    return {"text": body, "cited": cited + URL_RE.findall(body), "retrieved": retrieved}


def _post_json(url: str, payload: dict, key: str, timeout: int = 180) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def ask_openai(question: str) -> dict:
    # Responses API with the hosted web_search tool. Not yet run against a real
    # key — if the response shape has moved, this row reports an error rather
    # than a wrong answer.
    try:
        d = _post_json("https://api.openai.com/v1/responses", {
            "model": os.environ.get("OPENAI_MODEL", "gpt-5"),
            "tools": [{"type": "web_search"}],
            "input": question,
        }, os.environ["OPENAI_API_KEY"])
    except urllib.error.HTTPError as e:
        return {"level": "error", "error": f"HTTP {e.code}"}
    except Exception as e:  # noqa: BLE001
        return {"level": "error", "error": str(e)[:200]}
    cited, retrieved, text = [], [], []
    for item in d.get("output", []):
        if item.get("type") == "web_search_call":
            retrieved += [s.get("url") for s in (item.get("action") or {}).get("sources", []) if s.get("url")]
        elif item.get("type") == "message":
            for c in item.get("content", []):
                text.append(c.get("text", ""))
                cited += [a["url"] for a in c.get("annotations", []) if a.get("type") == "url_citation" and a.get("url")]
    if not text and not cited:
        return {"level": "error", "error": "unrecognised response shape"}
    return {"text": "\n".join(text), "cited": cited, "retrieved": retrieved}


def ask_perplexity(question: str) -> dict:
    # Sonar returns the sources it used as `citations`; `search_results` (when
    # present) is the wider retrieved set. Not yet run against a real key.
    try:
        d = _post_json("https://api.perplexity.ai/chat/completions", {
            "model": os.environ.get("PERPLEXITY_MODEL", "sonar"),
            "messages": [{"role": "user", "content": question}],
        }, os.environ["PERPLEXITY_API_KEY"])
    except urllib.error.HTTPError as e:
        return {"level": "error", "error": f"HTTP {e.code}"}
    except Exception as e:  # noqa: BLE001
        return {"level": "error", "error": str(e)[:200]}
    try:
        text = d["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return {"level": "error", "error": "unrecognised response shape"}
    cited = [u for u in d.get("citations", []) if isinstance(u, str)]
    retrieved = [r.get("url") for r in d.get("search_results", []) if isinstance(r, dict) and r.get("url")]
    return {"text": text, "cited": cited, "retrieved": retrieved}


PROVIDERS = {
    "Claude": ("ANTHROPIC_API_KEY", ask_claude),
    "ChatGPT": ("OPENAI_API_KEY", ask_openai),
    "Perplexity": ("PERPLEXITY_API_KEY", ask_perplexity),
}


def citation_check() -> dict:
    questions = json.loads(PROMPTS_FILE.read_text())["questions"]
    enabled = {name: fn for name, (env, fn) in PROVIDERS.items() if os.environ.get(env)}
    jobs = [(name, q) for name in enabled for q in questions]

    def run(job):
        name, q = job
        r = enabled[name](q["q"])
        level = r.get("level") or _classify(r.get("text", ""), r.get("cited", []), r.get("retrieved", []))
        cited = r.get("cited", [])
        return {
            "provider": name, "id": q["id"], "q": q["q"], "level": level, "error": r.get("error"),
            "mederti_urls": sorted({u for u in cited + r.get("retrieved", []) if _ours(u)}),
            "cited_domains": sorted({_domain(u) for u in cited if u}),
            "retrieved_domains": sorted({_domain(u) for u in r.get("retrieved", []) if u}),
        }

    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(run, jobs))

    summary = {}
    for name in enabled:
        rows = [r for r in results if r["provider"] == name]
        summary[name] = {lv: sum(1 for r in rows if r["level"] == lv) for lv in (*LEVELS, "error", "refused")}
        summary[name]["asked"] = len(rows)
    return {
        "providers": {name: ("on" if name in enabled else f"off — set {env}") for name, (env, _) in PROVIDERS.items()},
        "results": results,
        "summary": summary,
    }


# ── AI referral traffic ─────────────────────────────────────────────────────

def ai_referrals() -> dict:
    token = os.environ.get("VERCEL_ANALYTICS_TOKEN")
    if not token:
        return {"available": False, "reason": "set VERCEL_ANALYTICS_TOKEN (Vercel access token scoped to the team)"}
    project = os.environ.get("VERCEL_ANALYTICS_PROJECT_ID", "prj_YEn45c67WshFBA6D6jP6NwkYBwk5")
    team = os.environ.get("VERCEL_ANALYTICS_TEAM_ID", "team_fwNsQpnIDnvi9VPRfxPf03QH")
    today = dt.date.today()

    def window(start: dt.date, end: dt.date) -> dict[str, int]:
        qs = urllib.parse.urlencode({"projectId": project, "teamId": team, "by": "referrerHostname",
                                     "since": start.isoformat(), "until": end.isoformat(), "limit": "100"})
        req = urllib.request.Request(f"https://api.vercel.com/v1/query/web-analytics/visits/aggregate?{qs}",
                                     headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.load(r).get("data", [])
        out: dict[str, int] = {}
        for row in rows:
            host = str(row.get("referrerHostname") or "").lower().removeprefix("www.")
            label = next((v for k, v in AI_REFERRERS.items() if host == k or host.endswith("." + k)), None)
            if label:
                out[label] = out.get(label, 0) + int(row.get("visitors") or 0)
        return out

    try:
        this = window(today - dt.timedelta(days=6), today)
        last = window(today - dt.timedelta(days=13), today - dt.timedelta(days=7))
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"Vercel Analytics query failed: {e}"[:200]}
    return {"available": True, "this_week": this, "last_week": last,
            "total": sum(this.values()), "total_prev": sum(last.values())}


def build() -> dict:
    return {"citations": citation_check(), "referrals": ai_referrals()}


# ── Markdown ────────────────────────────────────────────────────────────────

def render_md(ai: dict, prev: dict | None) -> list[str]:
    c, ref = ai["citations"], ai["referrals"]
    pc = (prev or {}).get("citations", {}).get("summary", {})
    L = ["## AI assistant visibility", ""]
    on = [p for p, s in c["providers"].items() if s == "on"]
    off = [f"{p} ({s})" for p, s in c["providers"].items() if s != "on"]

    if on:
        L += ["How often AI assistants with live web search cite mederti.com when asked a fixed set of "
              f"{len(json.loads(PROMPTS_FILE.read_text())['questions'])} shortage questions. One answer per "
              "question per week, so read the trend, not a single miss. Claude's API answers name sources in "
              "prose and rarely include links, so for Claude \"found\" (the search surfaced a mederti.com page) "
              "and \"named\" are the signals to watch.", "",
              "| Assistant | Cited | Found, not cited | Named, no link | Absent | Errors | Last week cited |",
              "|---|---|---|---|---|---|---|"]
        for p in on:
            s = c["summary"][p]
            was = pc.get(p, {}).get("cited")
            L.append(f"| {p} | **{s['cited']}/{s['asked']}** | {s['retrieved']} | {s['mentioned']} | {s['absent']} | "
                     f"{s['error'] + s['refused']} | {was if was is not None else '—'} |")
        L += ["", "| Question | " + " | ".join(on) + " |", "|---|" + "---|" * len(on)]
        by_q: dict[str, dict] = {}
        for r in c["results"]:
            by_q.setdefault(r["id"], {"q": r["q"]})[r["provider"]] = r
        for qid, row in by_q.items():
            cells = []
            for p in on:
                r = row.get(p)
                cell = ICON.get(r["level"], r["level"]) if r else "—"
                if r and r.get("error"):
                    cell += f" ({r['error']})"
                cells.append(cell)
            L.append(f"| {row['q']} | " + " | ".join(cells) + " |")

        # Who the assistants cite instead of us.
        rivals: dict[str, int] = {}
        for r in c["results"]:
            for d in r["cited_domains"]:
                if d != OUR_DOMAIN:
                    rivals[d] = rivals.get(d, 0) + 1
        if rivals:
            top = sorted(rivals.items(), key=lambda x: -x[1])[:10]
            L += ["", "**Most-cited sources across all answers:** " + ", ".join(f"{d} ×{n}" for d, n in top)]
        # What the searches surfaced, cited or not: the field we compete in.
        seen: dict[str, int] = {}
        for r in c["results"]:
            for d in r.get("retrieved_domains", []):
                seen[d] = seen.get(d, 0) + 1
        if seen:
            top = sorted(seen.items(), key=lambda x: -x[1])[:10]
            ours = seen.get(OUR_DOMAIN, 0)
            L += ["", f"**Sources the searches surfaced** (answers where each appeared; mederti.com: {ours}): "
                  + ", ".join(f"{d} ×{n}" for d, n in top)]
    else:
        L.append("_Citation check not running — no AI provider keys set._")
    if off:
        L += ["", "_Not checked: " + "; ".join(off) + "._"]

    L += ["", "**Visits referred by AI assistants (last 7 days)**", ""]
    if ref.get("available"):
        if ref["total"] == 0 and ref["total_prev"] == 0:
            L.append("None recorded this week or last.")
        else:
            L.append(f"{ref['total']} visitors (previous 7 days: {ref['total_prev']}). " + ", ".join(
                f"{k} {v}" for k, v in sorted(ref["this_week"].items(), key=lambda x: -x[1])))
    else:
        L.append(f"_Not available: {ref['reason']}._")
    L.append("")
    return L
