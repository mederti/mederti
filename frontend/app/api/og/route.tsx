import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Default social preview card (og:image / twitter:image) for mederti.com.
// Light theme, laid out on a 48px grid. Sized for 1200×630 and checked for
// legibility down to ~280px wide (Slack / compact X cards).
// Keep claims non-perishable — this image is cached by every platform.

export const runtime = "nodejs";

const C = {
  bg: "#F6F8F7",
  bgTint: "#EAF2EF",
  text: "#0B1A1C",
  muted: "#5A6B69",
  soft: "#7C8C8A",
  faint: "#8A9A98",
  mint: "#0E9F7E",
  line: "rgba(10,30,30,0.09)",
};

const REGULATORS = ["FDA", "EMA", "MHRA", "TGA"];

export async function GET() {
  const dir = join(process.cwd(), "app/api/og/fonts");
  const [displaySemi, textMedium, logo] = await Promise.all([
    readFile(join(dir, "InterDisplay-SemiBold.ttf")),
    readFile(join(dir, "Inter-Medium.ttf")),
    readFile(join(process.cwd(), "public/logo-black.png")),
  ]);
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: C.bg,
          backgroundImage: `radial-gradient(circle at 88% 30%, ${C.bgTint} 0%, ${C.bg} 70%)`,
          fontFamily: "Inter",
          color: C.text,
        }}
      >
        {/* left column */}
        <div
          style={{
            position: "absolute",
            top: 72,
            left: 80,
            width: 690,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} height={60} width={244} alt="mederti" style={{ objectFit: "contain", objectPosition: "left" }} />
          <div
            style={{
              marginTop: 58,
              display: "flex",
              flexDirection: "column",
              fontSize: 76,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              fontWeight: 600,
            }}
          >
            <div style={{ display: "flex" }}>Every drug shortage.</div>
            <div style={{ display: "flex" }}>Every regulator.</div>
            <div style={{ display: "flex", color: C.soft }}>One verified view.</div>
          </div>
          <div
            style={{
              marginTop: 30,
              display: "flex",
              alignItems: "center",
              fontSize: 27,
              fontWeight: 500,
              color: C.muted,
              letterSpacing: "-0.01em",
            }}
          >
            {["51 countries", "Official sources", "Daily"].map((t, i) => (
              <div key={t} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && (
                  <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#B8C4C2", margin: "0 14px" }} />
                )}
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* regulator panel */}
        <div
          style={{
            position: "absolute",
            top: 210,
            left: 814,
            width: 314,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#FFFFFF",
            border: `1px solid ${C.line}`,
            borderRadius: 22,
            padding: "10px 26px 12px",
            boxShadow: "0 28px 70px rgba(10,40,40,0.10)",
          }}
        >
          {REGULATORS.map((r) => (
            <div
              key={r}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "17px 0",
                borderBottom: `1px solid ${C.line}`,
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              <div style={{ display: "flex" }}>{r}</div>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: "rgba(14,159,126,0.14)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.mint }} />
              </div>
            </div>
          ))}
          <div style={{ display: "flex", padding: "17px 0", fontSize: 22, fontWeight: 500, color: C.faint }}>
            + more
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Inter", data: displaySemi, weight: 600, style: "normal" },
        { name: "Inter", data: textMedium, weight: 500, style: "normal" },
      ],
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
    },
  );
}
