/**
 * Static visual mock of the /chat page, used as a blurred backdrop for the
 * auth pages. Pure layout — no state, no fetches, no auth. The login/signup
 * card sits on top.
 */
export default function ChatBackdrop() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed", inset: 0,
        display: "flex", background: "#f8fafb",
        userSelect: "none", pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* Sidebar */}
      <aside style={{
        width: 280, flexShrink: 0,
        background: "#fff",
        borderRight: "1px solid #e2e8f0",
        padding: "16px 14px",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 8px" }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#0f172a" }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>mederti</div>
        </div>

        <div style={{
          background: "#0f172a", color: "#fff",
          padding: "10px 12px", borderRadius: 10,
          fontSize: 13, fontWeight: 500,
        }}>
          + New chat
        </div>

        <div style={{
          background: "#f1f5f9", color: "#64748b",
          padding: "9px 12px", borderRadius: 10,
          fontSize: 13, display: "flex", justifyContent: "space-between",
        }}>
          <span>🔍 Search chats</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>⌘K</span>
        </div>

        <div style={{ marginTop: 4 }}>
          <SectionLabel>WATCHLISTS</SectionLabel>
          <SidebarRow indent={0} bold>📑 Critical for AU <Badge>4</Badge></SidebarRow>
          <SidebarRow indent={1}><Dot color="#dc2626" /> Amoxicillin 500mg</SidebarRow>
          <SidebarRow indent={1}><Dot color="#dc2626" /> Salbutamol inhaler</SidebarRow>
          <SidebarRow indent={1}><Dot color="#ea580c" /> Methylphenidate ER 36mg</SidebarRow>
          <SidebarRow indent={1}><Dot color="#16a34a" /> Atorvastatin 40mg</SidebarRow>
          <SidebarRow indent={0}>📑 Injectables — Hormuz <Badge>8</Badge></SidebarRow>
          <SidebarRow indent={0}>📑 GLP-1 family <Badge>5</Badge></SidebarRow>
        </div>

        <div>
          <SectionLabel>FOLDERS</SectionLabel>
          <SidebarRow indent={0} bold>📁 Geopolitical signals <Badge>3</Badge></SidebarRow>
          <SidebarRow indent={1}>Strait of Hormuz impact on i…</SidebarRow>
          <SidebarRow indent={1}>China API export disruption Q1</SidebarRow>
          <SidebarRow indent={1}>India monsoon &amp; manufacturi…</SidebarRow>
          <SidebarRow indent={0}>📁 Supplier intelligence <Badge>7</Badge></SidebarRow>
          <SidebarRow indent={0}>📁 Regulatory comparisons <Badge>4</Badge></SidebarRow>
          <SidebarRow indent={0}>📁 Customer demos <Badge>2</Badge></SidebarRow>
        </div>

        <div>
          <SectionLabel>TODAY</SectionLabel>
          <SidebarRow indent={0}>insulin shortages</SidebarRow>
        </div>

        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: "10px 6px" }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "#0f172a", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 600,
          }}>R</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>Rob</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Mederti · Founder</div>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", background: "#fff" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 24px", borderBottom: "1px solid #e2e8f0",
        }}>
          <div style={{ display: "flex", gap: 6 }}>
            <NavTab>🔲 Dashboard</NavTab>
            <NavTab active>💬 Chat</NavTab>
            <NavTab>📈 Intelligence</NavTab>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{
              fontSize: 13, padding: "6px 12px", borderRadius: 8,
              border: "1px solid #e2e8f0", color: "#0f172a",
            }}>🇦🇺 AU ▾</div>
            <div style={{ fontSize: 18, color: "#64748b" }}>🔔</div>
          </div>
        </div>

        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <h1 style={{
            fontSize: 32, fontWeight: 700, color: "#0f172a",
            marginBottom: 16, textAlign: "center",
          }}>
            What do you need to know?
          </h1>
          <p style={{
            fontSize: 15, color: "#64748b", maxWidth: 580,
            textAlign: "center", lineHeight: 1.55, marginBottom: 28,
          }}>
            Ask about drug shortages, recalls, or substitutes across the markets
            Mederti indexes. Live regulator data — and honest about what's not covered.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <Chip highlight>How will Iran's Strait of Hormuz closure affect critical injectable shortages?</Chip>
            <Chip>Is amoxicillin in shortage in Australia?</Chip>
            <Chip>Show me critical antibiotic shortages globally</Chip>
            <Chip>What's substitutable for hydrochlorothiazide?</Chip>
          </div>
        </div>

        <div style={{ padding: "0 24px 24px" }}>
          <div style={{
            maxWidth: 720, margin: "0 auto",
            padding: "14px 18px", borderRadius: 14,
            background: "#fff", border: "1px solid #e2e8f0",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            display: "flex", alignItems: "center", gap: 12, color: "#94a3b8", fontSize: 14,
          }}>
            <span>📎</span><span>[ ]</span>
            <span style={{ flex: 1 }}>Ask anything, upload a spreadsheet, or scan a barcode…</span>
            <span>↑</span>
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", marginTop: 12 }}>
            AI-powered · regulatory sources worldwide · Not medical advice
          </div>
        </div>
      </main>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: "#94a3b8",
      letterSpacing: 0.6, padding: "8px 6px 4px",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <span>{children}</span><span>+</span>
    </div>
  );
}

function SidebarRow({
  children, indent = 0, bold = false,
}: { children: React.ReactNode; indent?: number; bold?: boolean }) {
  return (
    <div style={{
      fontSize: 13, color: bold ? "#0f172a" : "#475569",
      padding: "6px 6px", paddingLeft: 6 + indent * 16,
      display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between",
      fontWeight: bold ? 500 : 400,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{
    width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0,
  }} />;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span style={{
    fontSize: 11, color: "#94a3b8", marginLeft: "auto",
  }}>{children}</span>;
}

function NavTab({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div style={{
      fontSize: 13, padding: "6px 12px", borderRadius: 8,
      background: active ? "#f1f5f9" : "transparent",
      color: active ? "#0f172a" : "#64748b",
      fontWeight: active ? 600 : 500,
    }}>{children}</div>
  );
}

function Chip({ children, highlight = false }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <div style={{
      fontSize: 13, padding: "8px 16px", borderRadius: 999,
      border: `1px solid ${highlight ? "#0f766e" : "#e2e8f0"}`,
      background: highlight ? "#f0fdfa" : "#fff",
      color: "#0f172a", textAlign: "center",
    }}>{children}</div>
  );
}
