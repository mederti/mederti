// Step 5 — live before/after regression for the 5 quick-win tools.
// Fires one representative question per tool through /api/chat and prints
// the model's output. Run after dev server is up on :3000.

const url = "http://localhost:3000/api/chat";

const QUESTIONS = [
  {
    id: "GOV-02 (sole-source essentials)",
    tool_expected: "get_sole_source_essentials",
    q: "Which WHO Essential Medicines in Australia have only one supplier nationally right now?",
  },
  {
    id: "GOV-14 (peer comparison)",
    tool_expected: "compare_shortage_burden",
    q: "How does Australia's shortage burden compare to the UK, US, Canada and the EU?",
  },
  {
    id: "SUP-24 (class concentration)",
    tool_expected: "get_class_concentration_risk",
    q: "Which drug classes are most exposed to upstream manufacturer concentration risk? Look at antibiotics (J01) specifically.",
  },
  {
    id: "HCL-20 (resolution stats)",
    tool_expected: "get_resolution_time_stats",
    q: "What's the historical resolution time distribution for J01 antibiotic shortages?",
  },
  {
    id: "SUP-25 (predictive signals)",
    tool_expected: "get_predictive_signals",
    q: "Are there early signals of new shortages in Australia that haven't been officially declared yet?",
  },
];

async function ask(q) {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text: q }] }),
  });
  const d = await res.json();
  return { secs: Math.round((Date.now() - t0) / 1000), ...d };
}

console.log("# Step 5 — quick-win tools live regression\n");
console.log(`# ${new Date().toISOString()}\n`);

for (const q of QUESTIONS) {
  console.log("=".repeat(80));
  console.log(`## ${q.id}`);
  console.log(`Expected tool: \`${q.tool_expected}\``);
  console.log(`Q: ${q.q}\n`);
  try {
    const r = await ask(q.q);
    if (r.error) {
      console.log(`**ERROR**: ${r.error}`);
    } else {
      console.log(`(${r.secs}s, tool_calls=${r.tool_calls}, truncated=${r.truncated})\n`);
      console.log(r.content || "(empty)");
    }
  } catch (e) {
    console.log(`**EXCEPTION**: ${e.message}`);
  }
  console.log("");
}
