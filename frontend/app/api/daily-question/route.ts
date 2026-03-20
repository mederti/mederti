import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// In-memory cache — resets on redeploy, good enough for daily cadence
let cache: { question: string; generated: number } | null = null;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function GET() {
  // Serve from cache if fresh
  if (cache && Date.now() - cache.generated < CACHE_TTL) {
    return NextResponse.json({ question: cache.question, cached: true });
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        } as any,
      ],
      system: `You are generating a single topical question for a pharmaceutical supply chain intelligence platform called Mederti.

The question should:
- Be directly relevant to pharmaceutical supply chains, drug shortages, or medicine availability
- Reference a real current news event or geopolitical development from the last 7 days
- Be conversational and thought-provoking
- Be 10-20 words maximum
- NOT be answerable purely from a drug shortage database — it should invite broader geopolitical/supply chain discussion
- Examples of good questions:
  "How might the Red Sea shipping disruptions affect antibiotic supply chains this quarter?"
  "What does the new US tariff on Chinese APIs mean for generic drug prices?"
  "Could the India-Pakistan tensions disrupt global generic medicine supply?"

Search for current pharmaceutical supply chain news, then generate ONE question. Respond with ONLY the question text, nothing else.`,
      messages: [
        {
          role: "user",
          content:
            "Search for today's most relevant pharmaceutical supply chain or drug shortage news, then generate one topical question.",
        },
      ],
    });

    // Extract the text response
    const question = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("")
      .trim()
      .replace(/^["']|["']$/g, ""); // strip quotes if any

    // Cache it
    cache = { question, generated: Date.now() };

    return NextResponse.json({ question, cached: false });
  } catch (error) {
    console.error("Daily question generation failed:", error);
    // Fallback question if generation fails
    return NextResponse.json({
      question:
        "How are current geopolitical tensions affecting global pharmaceutical supply chains?",
      cached: false,
      fallback: true,
    });
  }
}
