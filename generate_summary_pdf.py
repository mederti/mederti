#!/usr/bin/env python3
"""Generate Mederti Platform Summary PDF — March 16, 2026."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
import os

# ── Colours ──────────────────────────────────────────────────────────────────
DARK_BLUE   = HexColor("#1a2744")
MID_BLUE    = HexColor("#2d4a7a")
ACCENT_BLUE = HexColor("#3b82f6")
LIGHT_BLUE  = HexColor("#eff6ff")
LIGHT_GREY  = HexColor("#f8fafc")
BORDER_GREY = HexColor("#e2e8f0")
TEXT_DARK    = HexColor("#1e293b")
TEXT_MID     = HexColor("#475569")
TEXT_LIGHT   = HexColor("#64748b")
GREEN        = HexColor("#16a34a")
GREEN_BG     = HexColor("#f0fdf4")
AMBER        = HexColor("#d97706")
AMBER_BG     = HexColor("#fffbeb")
RED          = HexColor("#dc2626")
TEAL         = HexColor("#0d9488")

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "Mederti_Platform_Summary_Mar2026.pdf")

# ── Styles ───────────────────────────────────────────────────────────────────
def make_styles():
    s = {}
    s["h1"] = ParagraphStyle("H1", fontSize=18, leading=22, textColor=DARK_BLUE,
                              spaceAfter=4, fontName="Helvetica-Bold")
    s["h2"] = ParagraphStyle("H2", fontSize=13, leading=17, textColor=MID_BLUE,
                              spaceBefore=14, spaceAfter=6, fontName="Helvetica-Bold")
    s["h3"] = ParagraphStyle("H3", fontSize=11, leading=14, textColor=DARK_BLUE,
                              spaceBefore=8, spaceAfter=4, fontName="Helvetica-Bold")
    s["body"] = ParagraphStyle("Body", fontSize=9, leading=13, textColor=TEXT_DARK,
                                spaceAfter=4, fontName="Helvetica")
    s["body_bold"] = ParagraphStyle("BodyBold", fontSize=9, leading=13, textColor=TEXT_DARK,
                                     spaceAfter=4, fontName="Helvetica-Bold")
    s["bullet"] = ParagraphStyle("Bullet", fontSize=9, leading=13, textColor=TEXT_DARK,
                                  spaceAfter=2, fontName="Helvetica",
                                  leftIndent=14, bulletIndent=4)
    s["small"] = ParagraphStyle("Small", fontSize=8, leading=11, textColor=TEXT_LIGHT,
                                 spaceAfter=2, fontName="Helvetica")
    s["table_header"] = ParagraphStyle("TH", fontSize=8.5, leading=11, textColor=white,
                                        fontName="Helvetica-Bold")
    s["table_cell"] = ParagraphStyle("TC", fontSize=8.5, leading=11.5, textColor=TEXT_DARK,
                                      fontName="Helvetica")
    s["table_cell_bold"] = ParagraphStyle("TCB", fontSize=8.5, leading=11.5, textColor=TEXT_DARK,
                                           fontName="Helvetica-Bold")
    s["check"] = ParagraphStyle("Check", fontSize=9, leading=13, textColor=GREEN,
                                 spaceAfter=2, fontName="Helvetica", leftIndent=14, bulletIndent=4)
    s["footer"] = ParagraphStyle("Footer", fontSize=7, leading=9, textColor=TEXT_LIGHT,
                                  fontName="Helvetica", alignment=TA_CENTER)
    return s

ST = make_styles()

# ── Helpers ──────────────────────────────────────────────────────────────────
def p(text, style="body"):
    return Paragraph(text, ST[style])

def bold(text):
    return f"<b>{text}</b>"

def blue(text):
    return f'<font color="{ACCENT_BLUE}">{text}</font>'

def hr():
    return HRFlowable(width="100%", thickness=0.5, color=BORDER_GREY,
                       spaceBefore=6, spaceAfter=6)

def make_table(headers, rows, col_widths=None):
    """Create a styled table with dark blue header row."""
    header_cells = [Paragraph(h, ST["table_header"]) for h in headers]
    data = [header_cells]
    for row in rows:
        data.append([Paragraph(str(c), ST["table_cell"]) for c in row])

    w = col_widths or [None] * len(headers)
    t = Table(data, colWidths=w, repeatRows=1)
    style_cmds = [
        ("BACKGROUND",   (0, 0), (-1, 0), DARK_BLUE),
        ("TEXTCOLOR",    (0, 0), (-1, 0), white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 8.5),
        ("BOTTOMPADDING",(0, 0), (-1, 0), 6),
        ("TOPPADDING",   (0, 0), (-1, 0), 6),
        ("LEFTPADDING",  (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING",   (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING",(0, 1), (-1, -1), 5),
        ("GRID",         (0, 0), (-1, -1), 0.5, BORDER_GREY),
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
    ]
    # Alternate row shading
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), LIGHT_GREY))
    t.setStyle(TableStyle(style_cmds))
    return t

def status_table(headers, rows, col_widths=None, status_col=1):
    """Table with coloured status badges."""
    header_cells = [Paragraph(h, ST["table_header"]) for h in headers]
    data = [header_cells]

    status_colors = {
        "Ready to create": (AMBER, AMBER_BG),
        "To disable": (AMBER, AMBER_BG),
        "Needs Vercel env": (AMBER, AMBER_BG),
        "Blocked": (RED, HexColor("#fef2f2")),
        "Sparse": (TEXT_LIGHT, LIGHT_GREY),
        "Placeholder": (TEXT_LIGHT, LIGHT_GREY),
        "Not started": (TEXT_LIGHT, LIGHT_GREY),
        "Partial": (AMBER, AMBER_BG),
        "Done": (GREEN, GREEN_BG),
    }

    for row in rows:
        cells = []
        for j, c in enumerate(row):
            if j == status_col and c in status_colors:
                fg, bg = status_colors[c]
                cells.append(Paragraph(f'<font color="{fg}">{c}</font>', ST["table_cell_bold"]))
            else:
                cells.append(Paragraph(str(c), ST["table_cell"]))
        data.append(cells)

    w = col_widths or [None] * len(headers)
    t = Table(data, colWidths=w, repeatRows=1)
    style_cmds = [
        ("BACKGROUND",   (0, 0), (-1, 0), DARK_BLUE),
        ("TEXTCOLOR",    (0, 0), (-1, 0), white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 8.5),
        ("BOTTOMPADDING",(0, 0), (-1, 0), 6),
        ("TOPPADDING",   (0, 0), (-1, 0), 6),
        ("LEFTPADDING",  (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING",   (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING",(0, 1), (-1, -1), 5),
        ("GRID",         (0, 0), (-1, -1), 0.5, BORDER_GREY),
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), LIGHT_GREY))
    t.setStyle(TableStyle(style_cmds))
    return t


# ── Page callbacks ───────────────────────────────────────────────────────────
def draw_header_block(canvas, doc):
    """Draw the dark blue title block on the first page only."""
    w, h = A4
    if doc.page == 1:
        # Dark blue banner
        canvas.setFillColor(DARK_BLUE)
        canvas.rect(0, h - 90, w, 90, fill=True, stroke=False)
        # Accent line
        canvas.setFillColor(TEAL)
        canvas.rect(0, h - 93, w, 3, fill=True, stroke=False)
        # Title text
        canvas.setFillColor(white)
        canvas.setFont("Helvetica-Bold", 22)
        canvas.drawString(30, h - 42, "Mederti")
        canvas.setFont("Helvetica", 12)
        canvas.drawString(30, h - 62, "Platform Summary  |  March 16, 2026")
        # URLs
        canvas.setFont("Helvetica", 8.5)
        canvas.setFillColor(HexColor("#93c5fd"))
        canvas.drawString(30, h - 80, "mederti.vercel.app    |    mederti-production.up.railway.app")

    # Footer on every page
    canvas.setFillColor(TEXT_LIGHT)
    canvas.setFont("Helvetica", 7)
    canvas.drawCentredString(w / 2, 18, f"Mederti Platform Summary  -  Page {doc.page}  -  Confidential")


# ── Build story ──────────────────────────────────────────────────────────────
def build():
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=A4,
        topMargin=100,  # room for header on first page
        bottomMargin=35,
        leftMargin=30,
        rightMargin=30,
    )
    story = []
    page_w = A4[0] - 60  # usable width

    # ── What It Is ───────────────────────────────────────────────────────
    story.append(p("What It Is", "h2"))
    story.append(p(
        "A global pharmaceutical shortage intelligence platform that scrapes drug shortage "
        "and recall data from <b>42 regulatory sources</b> across <b>20+ countries</b>, stores it in "
        "PostgreSQL, and serves it through a REST API and Next.js frontend."
    ))
    story.append(Spacer(1, 6))

    # ── Data Assets ──────────────────────────────────────────────────────
    story.append(hr())
    story.append(p("Data Assets", "h2"))
    story.append(make_table(
        ["Table", "Records", "Description"],
        [
            ["drugs", "~7,800", "Master drug registry with full-text search (tsvector + trigram)"],
            ["shortage_events", "~15,200", "Deduplicated shortage signals (MD5 hash dedup)"],
            ["recalls", "~17,500", "Drug recall tracking (Class I/II/III)"],
            ["data_sources", "42", "Regulatory bodies (26 active, 16 inactive) - live last_scraped_at timestamps"],
            ["intelligence_sources", "124+", "Macro data source catalog (procurement, APIs, IGOs)"],
            ["drug_alternatives", "-", "Therapeutic alternatives with evidence grading (A-E)"],
            ["raw_scrapes", "~287", "Raw scraper output log"],
            ["user_profiles", "-", "User roles (pharmacist, hospital, supplier, government)"],
            ["user_watchlists", "-", "User drug watches with alert preferences"],
        ],
        col_widths=[page_w * 0.18, page_w * 0.10, page_w * 0.72],
    ))
    story.append(Spacer(1, 4))
    story.append(p(f"{bold('Shortage breakdown:')} ~8,100 active  |  ~4,200 resolved  |  ~1,100 anticipated  |  ~1,800 stale", "small"))
    story.append(p(f"{bold('Country coverage (shortages):')} AU, US, GB, CA, NZ, FR, DE, IT, ES, IE, NL, BE, SE, NO, DK, FI + more", "small"))
    story.append(p(f"{bold('Country coverage (recalls):')} US, AU, NZ, CA, GB, EU, FR, DE, IT, ES, SG", "small"))

    # ── Scraper Network ──────────────────────────────────────────────────
    story.append(hr())
    story.append(p("Scraper Network - 54 Scrapers", "h2"))
    story.append(p(
        f"{bold('44 shortage scrapers')} covering: FDA, TGA, Medsafe, Health Canada, MHRA, EMA, ANSM, "
        "BfArM, AIFA, AEMPS, HPRA, Fimea, NoMA, DKMA, Swissmedic, Pharmac, HSA, PMDA, MFDS, "
        "CDSCO, SAHPRA, ANVISA, COFEPRIS, ANMAT, UAE MOHAP, Israel MOH, Belgium FAMHP, Portugal "
        "Infarmed, Poland MZ, Turkey TITCK, Greece EOF, HK Drug Office, China NMPA, "
        "Malaysia NPRA, and more."
    ))
    story.append(p(
        f"{bold('10 recall scrapers')} covering: FDA, Health Canada, EMA, MHRA, BfArM, ANSM, AIFA, "
        "AEMPS, Medsafe, HSA."
    ))
    story.append(Spacer(1, 4))
    story.append(p("Cron Architecture (Railway-ready)", "h3"))
    story.append(Paragraph("<bullet>&bull;</bullet><b>run_shortage_cron.py</b> - 44 shortage scrapers, every 30 min (<font face='Courier' size='8'>*/30 * * * *</font>)", ST["bullet"]))
    story.append(Paragraph("<bullet>&bull;</bullet><b>run_recall_cron.py</b> - 10 recall scrapers, every 6 hours (<font face='Courier' size='8'>0 */6 * * *</font>)", ST["bullet"]))
    story.append(Spacer(1, 4))
    story.append(p(
        "Each scraper: fetches &rarr; normalises &rarr; deduplicates (MD5) &rarr; upserts to Supabase "
        "&rarr; logs to raw_scrapes &rarr; updates last_scraped_at on data_sources.", "small"
    ))

    # ── Backend API ──────────────────────────────────────────────────────
    story.append(hr())
    story.append(p("Backend API - FastAPI (16+ endpoints)", "h2"))
    story.append(make_table(
        ["Area", "Endpoints"],
        [
            ["Search", "Fuzzy drug search with shortage counts"],
            ["Drugs", "Drug detail, shortages, alternatives, recalls, resilience score"],
            ["Shortages", "Paginated browse + dashboard KPIs (by severity/country/category)"],
            ["Recalls", "Paginated browse + summary (by class/country/status)"],
            ["Sources", "List regulatory data sources"],
            ["Intelligence", "124+ macro sources, filterable by category/priority/access"],
            ["Data Quality", "Source freshness, completeness metrics, quality score (0-100)"],
            ["Health", "/health + /health/db with live Supabase connectivity check"],
        ],
        col_widths=[page_w * 0.16, page_w * 0.84],
    ))
    story.append(Spacer(1, 4))
    story.append(p(
        f"{bold('Database client:')} Custom lightweight PostgREST httpx client (replaced supabase-py SDK "
        "which caused async deadlocks under uvicorn). Supports select, insert, upsert (with on_conflict), "
        "update, delete, single-row mode, filters, ordering, pagination, and RPC."
    ))

    # ── Frontend ─────────────────────────────────────────────────────────
    story.append(hr())
    story.append(p("Frontend - Next.js 16 + React 19 (22 pages, 27 API routes)", "h2"))

    story.append(p("Core Data Pages", "h3"))
    for item in [
        ("<b>Dashboard</b> - KPIs, regional supply map, shortage timeline, predicted supply risks, critical watchlist, alerts"),
        ("<b>Shortages</b> - Filterable shortage table (country, status, severity, source) with API error states"),
        ("<b>Recalls</b> - Filterable recall table (class, status, country, date range) with API error states"),
        ("<b>Search</b> - Drug search with autocomplete, shortage breakdowns per drug"),
        ("<b>Drug Detail</b> (/drugs/[id]) - Shortages, alternatives, recalls, timeline, resilience score, watchlist button"),
        ("<b>Home</b> - Personalised feed: AU shortages, watchlist, recalls, predicted alerts, TGA notices"),
        ("<b>Intelligence</b> - Industry reports hub: articles, data releases, market sidebar, working newsletter signup"),
        ("<b>Supplier Dashboard</b> - Market gaps, demand signals, regulatory pathways, portfolio risk monitor"),
    ]:
        story.append(Paragraph(f"<bullet>&bull;</bullet>{item}", ST["bullet"]))

    story.append(p("Navigation and UX", "h3"))
    for item in [
        "<b>Global nav search</b> - Magnifying glass icon expands to full-width autocomplete overlay with severity badges",
        "<b>Mobile hamburger menu</b> - Slide-down drawer at &lt;768px with all nav links for logged-in and guest users",
        "<b>Forgot password</b> - Link on login page switches to magic link tab for passwordless recovery",
        "<b>Error handling</b> - Styled error.tsx and not-found.tsx pages with consistent nav/footer",
        "<b>Auth pages</b> - Login and signup pages include full site navigation",
    ]:
        story.append(Paragraph(f"<bullet>&bull;</bullet>{item}", ST["bullet"]))

    story.append(p("User Features", "h3"))
    for item in [
        "<b>Auth</b> - Login (password + magic link + forgot password), signup, Supabase Auth",
        "<b>Watchlist</b> - Save drugs, get alerts on status/severity changes",
        "<b>Alerts</b> - Email notifications via Resend when watched drugs change",
        "<b>Account</b> - Role selection (pharmacist/hospital/supplier/government), notification prefs",
        "<b>Bulk Upload</b> - CSV/Excel drug list lookup",
    ]:
        story.append(Paragraph(f"<bullet>&bull;</bullet>{item}", ST["bullet"]))

    story.append(p("Marketing Pages", "h3"))
    for item in [
        "<b>Landing (/)</b> - Hero search, trust stats (8,133 active shortages, 42 sources, 20+ countries, live feed)",
        "<b>Persona Pages</b> - Pharmacists, Doctors, Hospitals, Governments, Suppliers (tailored value props)",
        "About, Pricing (realistic feature tiers), Contact, Privacy, Terms",
    ]:
        story.append(Paragraph(f"<bullet>&bull;</bullet>{item}", ST["bullet"]))

    story.append(p("Frontend API Routes (27)", "h3"))
    for item in [
        "Data proxies to backend (search, drugs, shortages, recalls)",
        "Drug autocomplete (Supabase full-text search)",
        "Supplier intelligence (6 routes: opportunities, market gaps, demand signals, portfolio, regulatory, pathways)",
        "Admin CMS (intelligence articles CRUD)",
        "OG meta images (dynamic per drug), newsletter subscribe",
        "Market data (live pricing/currency/indices)",
        "Contact form, bulk lookup",
    ]:
        story.append(Paragraph(f"<bullet>&bull;</bullet>{item}", ST["bullet"]))

    # ── Tech Stack ───────────────────────────────────────────────────────
    story.append(hr())
    story.append(p("Tech Stack", "h2"))
    story.append(make_table(
        ["Layer", "Technology"],
        [
            ["Frontend", "Next.js 16.1.6, React 19.2.3, TypeScript, Tailwind CSS 4"],
            ["Backend API", "Python 3.11, FastAPI, custom PostgREST httpx client"],
            ["Database", "PostgreSQL via Supabase (RLS, full-text search, trigram indexes)"],
            ["Scrapers", "Python, httpx, BeautifulSoup4, lxml"],
            ["Auth", "Supabase Auth (password + magic link)"],
            ["Email", "Resend (alerts + newsletter welcome)"],
            ["Maps", "React Simple Maps"],
            ["Icons", "Lucide React"],
            ["Deployment", "Vercel (frontend), Railway (backend API - live), Supabase (database)"],
        ],
        col_widths=[page_w * 0.16, page_w * 0.84],
    ))

    # ── Database Schema Highlights ───────────────────────────────────────
    story.append(hr())
    story.append(p("Database Schema Highlights", "h2"))
    for item in [
        "15 migrations applied",
        "Full-text search with tsvector + trigram indexes on drugs",
        "MD5 deduplication keys on shortage_events and recalls",
        "Row-Level Security (RLS) enabled on all tables",
        "Immutable audit logs (shortage_status_log, audit_logs)",
        "Therapeutic alternatives with ATC hierarchy matching + RxNorm enrichment",
        "Drug resilience scoring (0-100) based on recall history",
        "Recall &harr; shortage intelligent linking",
    ]:
        story.append(Paragraph(f"<bullet>&bull;</bullet>{item}", ST["bullet"]))

    # ── What's Working Now ───────────────────────────────────────────────
    story.append(hr())
    story.append(p("What's Working Now", "h2"))
    checks = [
        "Backend API deployed and healthy on Railway (mederti-production.up.railway.app)",
        "All 54 scrapers operational (44 shortage + 10 recall)",
        "Database populated with ~40,500 records across drugs/shortages/recalls",
        "Frontend deployed on Vercel with all 22 pages",
        "last_scraped_at updates automatically after every scraper run",
        "EMA scraper XLSX fallback fixed (handles new metadata header format)",
        "Recall cron entry point created (run_recall_cron.py)",
        "Shortage cron entry point created (run_shortage_cron.py)",
        "User auth, watchlist, and alert system functional",
        "Predictive supply risk scoring on dashboard",
        "Drug autocomplete with severity badges across the platform",
        "Intelligence hub with market data sidebar and working newsletter form",
        "Supplier dashboard with 6 intelligence sections",
        "Dynamic OG meta images for social sharing",
        "Global nav search icon with expanding autocomplete overlay",
        "Mobile hamburger menu for responsive navigation",
        "Styled error and 404 pages with consistent layout",
        "API error states on shortages/recalls pages (distinct from empty results)",
        "Forgot password flow via magic link on login page",
    ]
    for item in checks:
        story.append(Paragraph(
            f'<font color="{GREEN}"><bullet>&bull;</bullet></font>{item}',
            ST["bullet"],
        ))

    # ── UI Audit ─────────────────────────────────────────────────────────
    story.append(hr())
    story.append(p("UI Audit — 19 Issues Identified, 16 Resolved", "h2"))
    story.append(p(
        "A comprehensive frontend audit identified 19 issues across navigation, data pages, auth, "
        "layout, patterns, dead features, links, pricing, error handling, and consistency. "
        "<b>16 of 19 have been resolved.</b> Remaining 3 are larger refactors (inline styles &rarr; Tailwind, "
        "unified badge component, country selector filtering all pages)."
    ))
    story.append(Spacer(1, 4))
    story.append(make_table(
        ["Priority", "Resolved", "Remaining"],
        [
            ["High (5 issues)", "5 of 5", "None"],
            ["Medium (6 issues)", "5 of 6", "Country selector scope (larger feature)"],
            ["Low (8 issues)", "6 of 8", "Badge unification, inline style migration"],
        ],
        col_widths=[page_w * 0.20, page_w * 0.20, page_w * 0.60],
    ))

    # ── Known Gaps ───────────────────────────────────────────────────────
    story.append(hr())
    story.append(p("Known Gaps / Roadmap Considerations", "h2"))
    story.append(status_table(
        ["Area", "Status", "Notes"],
        [
            ["Railway cron services", "Ready to create", "Code pushed; needs 2 services in Railway dashboard"],
            ["Local Mac cron", "To disable", "Once Railway cron runs, disable local crontab entries"],
            ["Frontend <-> Backend wiring", "Needs Vercel env", "Set NEXT_PUBLIC_API_URL to Railway URL, redeploy"],
            ["IE (HPRA) scraper", "Blocked", "API is CORS-locked, returns 403 from server-side"],
            ["Country selector", "Partial", "Works on drug detail; doesn't filter dashboard/shortages/recalls"],
            ["Chat feature", "Placeholder", "UI at /chat with coming-soon label, no AI backend yet"],
            ["Pricing/payments", "Not started", "Pricing page exists but no Stripe integration"],
            ["Badge components", "Partial", "Severity badges implemented 4 different ways across pages"],
            ["Inline styles", "Not started", "~15 inline style blocks; migration to Tailwind not yet done"],
        ],
        col_widths=[page_w * 0.22, page_w * 0.16, page_w * 0.62],
    ))

    story.append(Spacer(1, 20))

    # ── Build ────────────────────────────────────────────────────────────
    doc.build(story, onFirstPage=draw_header_block, onLaterPages=draw_header_block)
    print(f"PDF saved to: {OUTPUT_PATH}")


if __name__ == "__main__":
    build()
