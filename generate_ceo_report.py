#!/usr/bin/env python3
"""Generate Mederti CEO Update PDF — March 2026."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfgen import canvas as canvasmod
import datetime

OUTPUT = "/Users/findlaysingapore/mederti/Mederti_CEO_Update_Mar2026.pdf"

# ── Colours ──
DARK = HexColor("#0f1729")
TEAL = HexColor("#0d9488")
BLUE = HexColor("#3b82f6")
GREY = HexColor("#64748b")
LIGHT_BG = HexColor("#f8fafc")
BORDER = HexColor("#e2e8f0")
GREEN = HexColor("#16a34a")
RED = HexColor("#dc2626")
AMBER = HexColor("#d97706")

# ── Styles ──
sTitle = ParagraphStyle("Title", fontName="Helvetica-Bold", fontSize=28, textColor=DARK, spaceAfter=4)
sSubtitle = ParagraphStyle("Subtitle", fontName="Helvetica", fontSize=12, textColor=GREY, spaceAfter=24)
sH1 = ParagraphStyle("H1", fontName="Helvetica-Bold", fontSize=18, textColor=DARK, spaceBefore=24, spaceAfter=10)
sH2 = ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=14, textColor=DARK, spaceBefore=18, spaceAfter=8)
sBody = ParagraphStyle("Body", fontName="Helvetica", fontSize=10, textColor=DARK, leading=15, spaceAfter=6)
sBold = ParagraphStyle("Bold", fontName="Helvetica-Bold", fontSize=10, textColor=DARK, leading=15, spaceAfter=6)
sSmall = ParagraphStyle("Small", fontName="Helvetica", fontSize=9, textColor=GREY, leading=12)
sLabel = ParagraphStyle("Label", fontName="Helvetica", fontSize=9, textColor=GREY, leading=12)
sMetricVal = ParagraphStyle("MetricVal", fontName="Helvetica-Bold", fontSize=22, textColor=DARK, alignment=TA_LEFT)
sMetricLabel = ParagraphStyle("MetricLabel", fontName="Helvetica", fontSize=9, textColor=GREY, alignment=TA_LEFT)
sBullet = ParagraphStyle("Bullet", fontName="Helvetica", fontSize=10, textColor=DARK, leading=15, spaceAfter=4, leftIndent=16, bulletIndent=4)


def build():
    doc = SimpleDocTemplate(
        OUTPUT, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2.5*cm, bottomMargin=2*cm,
    )
    story = []
    w = doc.width

    # ── Header ──
    story.append(Paragraph("Mederti", sTitle))
    story.append(Paragraph("CEO Platform Update — Week of 18–23 March 2026", sSubtitle))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=16))

    # ── Database at a Glance ──
    story.append(Paragraph("Database at a Glance", sH1))

    metrics = [
        ("19,111", "Shortage events", "+3,848 this week"),
        ("13,078", "Active shortages", "68% of total"),
        ("22", "Countries tracked", "+7 new this week"),
        ("10,271", "Unique drugs", "Active substances"),
        ("216,509", "Drug products", "Full regulatory catalogue"),
        ("23,380", "Recalls tracked", "Across 11 markets"),
        ("31", "Active data sources", "Regulatory authorities"),
        ("47", "Scrapers running", "Automated 24/7"),
    ]

    # Build 2x4 metric cards as a table
    metric_cells = []
    row = []
    for i, (val, label, sub) in enumerate(metrics):
        cell_content = [
            Paragraph(val, sMetricVal),
            Paragraph(label, ParagraphStyle("ML", fontName="Helvetica-Bold", fontSize=10, textColor=DARK, spaceAfter=2)),
            Paragraph(sub, sSmall),
        ]
        row.append(cell_content)
        if (i + 1) % 4 == 0:
            metric_cells.append(row)
            row = []
    if row:
        while len(row) < 4:
            row.append([""])
        metric_cells.append(row)

    col_w = w / 4
    t = Table(metric_cells, colWidths=[col_w]*4, rowHeights=[70]*len(metric_cells))
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
    ]))
    story.append(t)
    story.append(Spacer(1, 16))

    # ── Country Breakdown ──
    story.append(Paragraph("Shortage Data by Country", sH1))

    country_data = [
        ["", "Country", "Total", "Active", "Status"],
        ["1", "Italy", "3,675", "1,773", "Established"],
        ["2", "United States", "3,023", "2,104", "Established"],
        ["3", "Canada", "2,052", "1,610", "Established"],
        ["4", "Spain", "1,812", "795", "Established"],
        ["5", "Switzerland", "1,738", "1,738", "Established"],
        ["6", "Finland", "1,193", "1,095", "Established"],
        ["7", "Australia", "1,099", "540", "Established"],
        ["8", "Japan", "799", "799", "Expanded"],
        ["9", "Norway", "682", "351", "Established"],
        ["10", "Belgium", "562", "562", "New"],
        ["11", "Germany", "485", "484", "Established"],
        ["12", "Ireland", "357", "353", "Fixed"],
        ["13", "Netherlands", "347", "346", "Established"],
        ["14", "France", "340", "58", "Established"],
        ["15", "Singapore", "296", "36", "Established"],
        ["16", "Greece", "230", "128", "New"],
        ["17", "Malaysia", "135", "129", "New"],
        ["18", "New Zealand", "111", "98", "Established"],
        ["19", "European Union", "75", "34", "Established"],
        ["20", "United Kingdom", "59", "5", "Fixed"],
        ["21", "Portugal", "30", "30", "New"],
        ["22", "UAE", "11", "10", "New"],
    ]

    col_widths = [24, w*0.35, 60, 60, 70]
    ct = Table(country_data, colWidths=col_widths)
    header_style = [
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (3, -1), "RIGHT"),
        ("ALIGN", (4, 0), (4, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, LIGHT_BG]),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
    ]
    # Highlight new countries
    for i, row in enumerate(country_data[1:], 1):
        if row[4] == "New":
            header_style.append(("TEXTCOLOR", (4, i), (4, i), GREEN))
            header_style.append(("FONTNAME", (4, i), (4, i), "Helvetica-Bold"))
        elif row[4] == "Fixed":
            header_style.append(("TEXTCOLOR", (4, i), (4, i), BLUE))
            header_style.append(("FONTNAME", (4, i), (4, i), "Helvetica-Bold"))
        elif row[4] == "Expanded":
            header_style.append(("TEXTCOLOR", (4, i), (4, i), AMBER))
            header_style.append(("FONTNAME", (4, i), (4, i), "Helvetica-Bold"))

    ct.setStyle(TableStyle(header_style))
    story.append(ct)

    # ── Page break ──
    story.append(PageBreak())

    # ── New Countries Added ──
    story.append(Paragraph("New Countries Added This Week", sH1))

    new_countries = [
        ["Country", "Records", "Source", "Method"],
        ["Belgium", "562", "PharmaStatus API (pharmastatus.be)", "Structured JSON API with severity scoring"],
        ["Greece", "230", "EOF shortage PDF", "PDF parsing with pdfplumber"],
        ["Malaysia", "135", "NPRA safety alerts", "HTML scraping (new URL after restructure)"],
        ["Ireland", "357", "HPRA shortage list", "Rewritten after API was auth-gated"],
        ["Portugal", "30", "INFARMED", "New URL + Excel export parsing"],
        ["UAE", "11", "Emirates Drug Establishment", "New agency (EDE) replaced MOHAP"],
        ["Japan (expanded)", "799 (target 2,433)", "MHLW Excel register", "16,500 product supply register"],
    ]

    nct = Table(new_countries, colWidths=[w*0.15, w*0.13, w*0.35, w*0.37])
    nct.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, LIGHT_BG]),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
    ]))
    story.append(nct)
    story.append(Spacer(1, 16))

    # ── Key Technical Wins ──
    story.append(Paragraph("Key Technical Wins", sH1))

    wins = [
        ("Staleness bug fixed",
         "Scrapers were silently marking active shortages as 'stale' when source data hadn't changed between runs. "
         "MHRA (GB) showed 0 active despite having 59 real records. Root cause: duplicate-payload detection was "
         "triggering cleanup_stale() which decayed everything. Fixed with a content-hash check."),
        ("SEO + AI search optimisation",
         "Full implementation: dynamic meta tags on every drug page (title includes shortage status + country), "
         "JSON-LD structured data (schema.org/Drug) for Google AI Overviews, dynamic sitemap.xml with all 10k+ drug pages, "
         "robots.txt explicitly allowing GPTBot/PerplexityBot/Claude-Web, llms.txt for AI crawler context, "
         "machine-readable paragraph on each drug page for AI citation."),
        ("Japan scraper rewrite",
         "Replaced brittle HTML scraping of PMDA shortage page (682 point-in-time records) with MHLW's weekly Excel "
         "supply register. Parses 16,500 pharmaceutical products, filters to non-normal supply statuses. "
         "Maps Japanese supply codes to severity levels."),
        ("Landing page accuracy",
         "All stats now pull live from Supabase with correct fallbacks. Fixed Supabase 1000-row limit bug that was "
         "truncating country count to 17 instead of 22. Updated all cards, footer, and OG image metadata."),
    ]

    for title, desc in wins:
        story.append(Paragraph(f"<b>{title}</b>", sBold))
        story.append(Paragraph(desc, sBody))
        story.append(Spacer(1, 4))

    # ── What's Not Working ──
    story.append(Paragraph("Known Blockers", sH1))

    blockers = [
        ["Issue", "Impact", "Status"],
        ["Railway deployment", "Live site shows no data — frontend can't reach backend API", "Blocked"],
        ["Austria / Czech Republic / Hungary", "JS SPAs requiring Playwright (not installed)", "Parked"],
        ["South Africa / Nigeria", "Regulator websites are down or restructured", "Parked"],
        ["Asia Pacific expansion", "Taiwan, Thailand, Philippines, Pakistan, Sri Lanka — none publish scrapeable data", "No source"],
        ["Japan partial import", "799 of 2,433 records imported (network timeout). Will complete on next cron run", "In progress"],
        ["Recall scrapers not in cron", "11 recall scrapers exist but only AU+CA have data in DB", "Ready to deploy"],
    ]

    bt = Table(blockers, colWidths=[w*0.4, w*0.42, w*0.18])
    bt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, LIGHT_BG]),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
    ]))
    story.append(bt)
    story.append(Spacer(1, 16))

    # ── Next Priorities ──
    story.append(Paragraph("Next Priorities", sH1))

    priorities = [
        ("1. Deploy backend on Railway", "Unblocks the live site — frontend currently shows empty data because it can't reach the API."),
        ("2. Run recall scrapers", "11 recall scrapers exist for AU, CA, US, GB, EU, SG, NZ, DE, FR, IT, ES. Need to add to cron and populate DB."),
        ("3. EMA Excel import", "EMA publishes a shortage catalogue Excel that could add 500+ EU records with country-level breakdowns."),
        ("4. Data quality automation", "Weekly audit cron to catch stale/missing records before users see them."),
    ]

    for title, desc in priorities:
        story.append(Paragraph(f"<b>{title}</b>", sBold))
        story.append(Paragraph(desc, sBody))
        story.append(Spacer(1, 4))

    # ── Footer line ──
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))
    story.append(Paragraph(
        f"Generated {datetime.datetime.now().strftime('%d %B %Y')} — Mederti Platform Intelligence",
        ParagraphStyle("Footer", fontName="Helvetica", fontSize=8, textColor=GREY, alignment=TA_CENTER),
    ))

    doc.build(story)
    print(f"PDF saved to {OUTPUT}")


if __name__ == "__main__":
    build()
