import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";

const FALLBACK_QUESTION =
  "How are current geopolitical tensions affecting global pharmaceutical supply chains?";

const ONE_DAY_SECONDS = 24 * 60 * 60;

async function generateQuestion(): Promise<{ question: string; fallback: boolean; reason?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { question: FALLBACK_QUESTION, fallback: true, reason: "missing_api_key" };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 80,
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

    const question = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("")
      .trim()
      .replace(/^["']|["']$/g, "");

    if (!question) {
      return { question: FALLBACK_QUESTION, fallback: true, reason: "empty_response" };
    }

    return { question, fallback: false };
  } catch (error) {
    console.error("Daily question generation failed:", error);
    return { question: FALLBACK_QUESTION, fallback: true, reason: "generation_error" };
  }
}

const getCachedQuestion = unstable_cache(generateQuestion, ["mederti-daily-question"], {
  revalidate: ONE_DAY_SECONDS,
  tags: ["daily-question"],
});

export async function GET() {
  const result = await getCachedQuestion();
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": `public, s-maxage=${ONE_DAY_SECONDS}, stale-while-revalidate=${ONE_DAY_SECONDS}`,
    },
  });
}
