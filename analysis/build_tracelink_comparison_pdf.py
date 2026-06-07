#!/usr/bin/env python3
"""Generate the TraceLink vs Mederti comparison PDF."""

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)

OUT = "TraceLink_vs_Mederti_comparison.pdf"

# ---- palette (mederti ink/green) ----
INK = colors.HexColor("#0F1A14")
GREEN = colors.HexColor("#1F7A4D")
LIGHT_GREEN = colors.HexColor("#E6F2EC")
GREY = colors.HexColor("#5B6660")
HAIR = colors.HexColor("#D5DBD7")
ZEBRA = colors.HexColor("#F6F8F7")

styles = getSampleStyleSheet()

def S(name, **kw):
    return ParagraphStyle(name, parent=styles["Normal"], **kw)

title_style = S("title", fontName="Helvetica-Bold", fontSize=22, leading=26,
                textColor=INK, spaceAfter=2)
subtitle_style = S("subtitle", fontName="Helvetica", fontSize=10.5, leading=14,
                   textColor=GREY, spaceAfter=2)
h2_style = S("h2", fontName="Helvetica-Bold", fontSize=13, leading=16,
             textColor=GREEN, spaceBefore=14, spaceAfter=6)
body_style = S("body", fontName="Helvetica", fontSize=9.5, leading=13,
               textColor=INK, spaceAfter=6)
cell_style = S("cell", fontName="Helvetica", fontSize=8.2, leading=10.5,
               textColor=INK)
cell_bold = S("cellb", fontName="Helvetica-Bold", fontSize=8.2, leading=10.5,
              textColor=INK)
head_style = S("head", fontName="Helvetica-Bold", fontSize=8.6, leading=11,
               textColor=colors.white)
edge_style = S("edge", fontName="Helvetica-Bold", fontSize=8.0, leading=10,
               textColor=GREEN)
small_grey = S("sg", fontName="Helvetica", fontSize=8, leading=11, textColor=GREY)


def P(text, st=cell_style):
    return Paragraph(text, st)


def make_table(rows, col_widths):
    # rows[0] is header
    data = []
    header = [P(c, head_style) for c in rows[0]]
    data.append(header)
    for r in rows[1:]:
        cells = [P(r[0], cell_bold)]
        cells.append(P(r[1], cell_style))
        cells.append(P(r[2], cell_style))
        cells.append(P(r[3], edge_style))
        data.append(cells)

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, INK),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, HAIR),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), ZEBRA))
    t.setStyle(TableStyle(style))
    return t


story = []

# ---- header band ----
story.append(Paragraph("TraceLink&nbsp;&nbsp;vs&nbsp;&nbsp;Mederti", title_style))
story.append(Paragraph(
    "Competitive comparison &mdash; data visibility &amp; interaction model", subtitle_style))
story.append(Paragraph("Prepared 3 June 2026", small_grey))
story.append(Spacer(1, 6))
story.append(HRFlowable(width="100%", thickness=1.2, color=GREEN,
                        spaceBefore=2, spaceAfter=2))
story.append(Spacer(1, 8))

story.append(Paragraph(
    "TraceLink&rsquo;s &ldquo;AI mode&rdquo; search and its Product Availability Intelligence (PAI) "
    "engine occupy the same conceptual space as Mederti: natural-language, persona-led entry into "
    "drug-shortage and sourcing intelligence. The two solve it from opposite ends of the data spectrum. "
    "This sheet compares what each can <i>see</i> and how each is <i>used</i>.", body_style))

# ---- Section A ----
story.append(Paragraph("A.&nbsp;&nbsp;Data visibility", h2_style))

col_w = [38*mm, 52*mm, 52*mm, 20*mm]

data_rows = [
    ["Dimension", "TraceLink (PAI + Amadeus)", "Mederti", "Edge"],
    ["Primary data source",
     "Proprietary network master data &mdash; POs, inventory levels, shipment notices (via MINT) from 300k+ companies, 35B+ serialized products",
     "~29k shortage events scraped from ~35 national regulators + recalls, ATC, RxNorm, pricing, 124 intelligence sources",
     "Different moats"],
    ["Shortage signal origin",
     "ASHP feed (US-only) + inferred network demand/supply imbalance",
     "Regulator notices across AU, US, EU, UK, CA, JP, KR, BR, ZA, etc. &mdash; natively multi-country",
     "Mederti"],
    ["Granularity",
     "NDC-level (specific package / manufacturer)",
     "INN / molecule-level (salt-stripped, UNII/RxNorm-resolved), rolling brands &rarr; generic",
     "Split"],
    ["Who can see what",
     "Gated &mdash; you only see NDCs your company is licensed to view; requires network membership",
     "Fully open &mdash; any persona queries the whole global dataset, no membership",
     "Mederti"],
    ["Geographic scope",
     "US-centric (ASHP); network global but shortage prediction is US",
     "~35 countries, multi-country drug universe",
     "Mederti"],
    ["Supply-side / sourcing data",
     "&ldquo;Alternate supply source&rdquo; = other members on their network",
     "API supplier concentration from FDA DMF, DECRS country-of-manufacture, WHO-PQ API makers &mdash; open &amp; auditable",
     "Different"],
    ["Recall / causal links",
     "Not a stated feature",
     "Recalls + recall &rarr; shortage causal links",
     "Mederti"],
    ["Transparency / citability",
     "Black-box ML over proprietary data &mdash; not externally citable",
     "Every answer traces to a named regulator source; methodology explainable",
     "Mederti"],
    ["Real-time transaction visibility",
     "Yes &mdash; live POs, inventory, shipments",
     "No &mdash; we do not see commercial transactions",
     "TraceLink"],
    ["Update cadence",
     "Near-real-time (network transactions)",
     "Daily scrapers (staggered cron)",
     "TraceLink"],
]
story.append(make_table(data_rows, col_w))

# ---- Section B ----
story.append(Paragraph("B.&nbsp;&nbsp;Interaction model", h2_style))

inter_rows = [
    ["Dimension", "TraceLink", "Mederti", "Edge"],
    ["Conversational surface",
     "&ldquo;AI mode&rdquo; search box (lead-gen) &rarr; Amadeus chat",
     "Persona-aware /chat, DB-grounded",
     "Comparable"],
    ["What the chat answers",
     "Phase-zero Amadeus = docs/help bot over TraceLink University content; says &ldquo;I don&rsquo;t understand&rdquo; on unknown queries",
     "Synthesizes over 29k live shortage events, drug lookups &amp; macro intelligence catalogue &mdash; answers the domain, not the manual",
     "Mederti"],
    ["LLM",
     "OpenAI-based, heavy guardrails, narrow scope to avoid hallucination",
     "Claude Opus, tool-using, web-search enabled, DB-grounded with source-priority guidance",
     "Mederti"],
    ["Predictive output UX",
     "PAI dashboard &mdash; red/yellow/green daily traffic signals, 90-day NDC forecasts, production recommendations",
     "Persona views + predictive-signals (peer-set lead-time) + INN vulnerability score",
     "Split"],
    ["Persona awareness",
     "Role = your network position (manufacturer / distributor)",
     "Explicit personas: pharmacist, procurement, supplier, doctor, gov, hospital &mdash; UI auto-routes",
     "Mederti"],
    ["Agentic / task execution",
     "OPUS Agents &mdash; no-code agents that execute supply tasks (monitor orders, verify lead times, flag exceptions)",
     "Chat is advisory; agentic roadmap planned but not shipped",
     "TraceLink"],
    ["Forward-looking framing",
     "&ldquo;90 days in advance, &gt;80% accuracy&rdquo; headline",
     "Vulnerability / fragility model + peer lead-time signals (earlier-stage)",
     "Split"],
    ["Who can use it",
     "Existing paying network members",
     "Anyone, public site",
     "Mederti"],
]
story.append(make_table(inter_rows, col_w))

# ---- synthesis ----
story.append(Paragraph("Synthesis", h2_style))

synth = Table([[Paragraph(
    "<b>TraceLink sees fewer drugs, deeper</b> &mdash; real transactions, NDC-level, US, members-only, "
    "black-box, but it can <i>execute</i>. <b>Mederti sees more drugs, transparently</b> &mdash; global "
    "regulators, molecule-resolved, open, cited, but advisory with no transaction-level demand signal.<br/><br/>"
    "Their unbeatable advantage is live transaction visibility. Ours is <b>breadth + neutrality + "
    "explainability</b>. Tellingly, the trigger query &mdash; <i>&ldquo;I&rsquo;m an importer in Australia, how can "
    "you help me source shortages?&rdquo;</i> &mdash; sits <b>outside TraceLink&rsquo;s wheelhouse</b>: that importer "
    "isn&rsquo;t on their network, AU isn&rsquo;t in their ASHP-driven prediction scope, and phase-zero Amadeus "
    "would likely answer &ldquo;I don&rsquo;t understand.&rdquo; It is squarely Mederti&rsquo;s supplier / importer persona.",
    body_style)]], colWidths=[162*mm])
synth.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), LIGHT_GREEN),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ("LINEBEFORE", (0, 0), (0, -1), 3, GREEN),
]))
story.append(synth)

story.append(Spacer(1, 10))
story.append(Paragraph(
    "Sources: TraceLink PAI product page &amp; FAQ (data inputs: TraceLink network + ASHP, licensed NDCs); "
    "Amadeus and OPUS Agents press releases; &ldquo;90 days in advance, &gt;80% accuracy&rdquo; announcement. "
    "Mederti side grounded in the live schema and codebase.", small_grey))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(HAIR)
    canvas.setLineWidth(0.5)
    canvas.line(18*mm, 14*mm, A4[0]-18*mm, 14*mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(18*mm, 9*mm, "Mederti — confidential competitive analysis")
    canvas.drawRightString(A4[0]-18*mm, 9*mm, "Page %d" % doc.page)
    canvas.restoreState()


doc = SimpleDocTemplate(
    OUT, pagesize=A4,
    leftMargin=18*mm, rightMargin=18*mm, topMargin=16*mm, bottomMargin=18*mm,
    title="TraceLink vs Mederti — Competitive Comparison",
    author="Mederti",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT)
