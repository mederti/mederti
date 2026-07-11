import type { ReactNode } from "react";
import ChatBackdrop from "./ChatBackdrop";
import AuthClose from "./AuthClose";

/**
 * Full-viewport shell for the auth pages. Renders a blurred mock of the /chat
 * UI as the backdrop, with a small "Mederti" home link in the corner and the
 * auth card centered on top. No site nav, no footer — keeps focus on the form.
 *
 * Pass `aside` to switch to a split layout: a value-proposition column on the
 * left, the form card on the right (the card comes first on small screens).
 */
export default function AuthShell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh", position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "32px 16px",
    }}>
      {/* Blurred chat backdrop */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        filter: "blur(10px) saturate(1.1)",
        transform: "scale(1.04)",
        pointerEvents: "none",
      }}>
        <ChatBackdrop />
      </div>

      {/* Subtle tint to keep the card readable without erasing the backdrop */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        background: "rgba(248, 250, 251, 0.25)",
        pointerEvents: "none",
      }} />

      {/* Close (X) + Escape-to-close */}
      <AuthClose />

      {aside ? (
        <div className="auth-split" style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 980 }}>
          <style>{`
            .auth-split{display:flex;align-items:center;gap:56px}
            .auth-split .auth-aside{flex:1 1 0;min-width:0}
            .auth-split .auth-card{flex:0 0 420px;max-width:420px;width:100%}
            @media(max-width:880px){
              .auth-split{flex-direction:column;gap:32px}
              .auth-split .auth-card{flex:0 0 auto;order:0}
              .auth-split .auth-aside{order:1;max-width:460px;text-align:center}
            }
          `}</style>
          <div className="auth-aside">{aside}</div>
          <div className="auth-card">{children}</div>
        </div>
      ) : (
        <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 420 }}>
          {children}
        </div>
      )}
    </div>
  );
}
