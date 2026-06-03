"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; text: string };

// Strip the chat API's custom card/markup tags + markdown markers so the
// inline column shows clean prose (the full /chat page renders the rich cards).
function clean(t: string): string {
  return t
    // remove whole card/source/followup blocks (tags AND their contents)
    .replace(/<sources>[\s\S]*?<\/sources>/gi, "")
    .replace(/<followups>[\s\S]*?<\/followups>/gi, "")
    .replace(/<sub_table>[\s\S]*?<\/sub_table>/gi, "")
    // unclosed trailing block while still streaming
    .replace(/<(sources|followups|sub_table)>[\s\S]*$/gi, "")
    .replace(/<drug_card[^>]*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function V1Chat({ drugName }: { drugName: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, status]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", text: q }];
    setMsgs([...next, { role: "assistant", text: "" }]);
    setBusy(true);
    setStatus("Thinking…");

    // Ground the conversation to this drug on the first turn.
    const apiMsgs = next.map((m, i) => ({
      role: m.role,
      text: m.role === "user" && i === 0 ? `I'm viewing the Mederti page for ${drugName}. ${m.text}` : m.text,
    }));

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: apiMsgs }),
      });
      if (!resp.ok || !resp.body) {
        if (resp.status === 429) throw new Error("You've reached the free question limit — try again shortly.");
        throw new Error("Sorry — couldn't reach the assistant. Try again.");
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          nl = buf.indexOf("\n");
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "text_delta" && typeof evt.delta === "string") {
              acc += evt.delta;
              setStatus(null);
              setMsgs((cur) => {
                const copy = [...cur];
                copy[copy.length - 1] = { role: "assistant", text: acc };
                return copy;
              });
            } else if (evt.type === "tool_start") {
              setStatus("Checking regulator data…");
            } else if (evt.type === "done" && typeof evt.content === "string") {
              acc = evt.content;
              setMsgs((cur) => {
                const copy = [...cur];
                copy[copy.length - 1] = { role: "assistant", text: acc };
                return copy;
              });
            } else if (evt.type === "error") {
              throw new Error(evt.message || "Assistant error.");
            }
          } catch {
            /* skip malformed line */
          }
        }
      }
      if (!acc.trim()) {
        setMsgs((cur) => {
          const copy = [...cur];
          copy[copy.length - 1] = { role: "assistant", text: "I couldn't find an answer for that — try rephrasing." };
          return copy;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setMsgs((cur) => {
        const copy = [...cur];
        copy[copy.length - 1] = { role: "assistant", text: msg };
        return copy;
      });
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  const suggestions = [
    `What can I substitute for ${drugName}?`,
    "Which countries are affected?",
    "How long did past shortages last?",
  ];

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <div className="chat-h-l"><span className="chat-ic">✦</span><div><div className="chat-title">Ask about this medicine</div><div className="chat-sub">Grounded in live regulator data</div></div></div>
        <span className="chat-free-tag">FREE</span>
      </div>

      <div className="chat-stream" ref={streamRef}>
        <div className="chat-msg ai"><div className="chat-bubble">Ask me anything about this shortage — substitutes, who&apos;s affected, how long it may last.</div></div>
        {msgs.map((m, i) => {
          const body = m.role === "assistant" ? clean(m.text) : m.text;
          // Skip the empty trailing assistant placeholder — the status line below
          // shows progress, so rendering it here too would duplicate the message.
          if (!body) return null;
          return (
            <div key={i} className={`chat-msg ${m.role === "user" ? "user" : "ai"}`}>
              <div className="chat-bubble" style={{ whiteSpace: "pre-wrap" }}>{body}</div>
            </div>
          );
        })}
        {busy && status && <div className="chat-msg ai"><div className="chat-bubble" style={{ color: "var(--text-4)", fontStyle: "italic" }}>{status}</div></div>}
      </div>

      {msgs.length === 0 && (
        <div className="chat-suggest">
          {suggestions.map((q) => (
            <button key={q} type="button" className="chat-q" onClick={() => send(q)}>{q}</button>
          ))}
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => { e.preventDefault(); send(input); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          disabled={busy}
          style={{ pointerEvents: "auto", cursor: "text", color: "var(--text)" }}
        />
        <button type="submit" className="chat-send" disabled={busy} aria-label="Send">↑</button>
      </form>
    </div>
  );
}
