import OpenAI from "openai";
import { AppConfig } from "../config/env";
import { ThreadsPost } from "../scraper/types";

export interface ClassifiedInsight {
  isRelevant: boolean;
  relevanceReason: string;
  summary: string;
  insight: string;
  action: string;
  replyIdea?: string;
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    isRelevant: { type: "boolean" },
    relevanceReason: { type: "string" },
    summary: { type: "string" },
    insight: { type: "string" },
    action: { type: "string" },
    replyIdea: { type: ["string", "null"] },
  },
  required: ["isRelevant", "relevanceReason", "summary", "insight", "action"],
} as const;

export class OpenAiProcessor {
  private readonly client: OpenAI;

  constructor(private readonly config: AppConfig) {
    this.client = new OpenAI({ apiKey: config.openAiApiKey });
  }

  async classifyAndExtract(post: ThreadsPost): Promise<ClassifiedInsight> {
    const profileContext = this.config.profile
      ? `Profile: ${this.config.profile.name}
Topics: ${this.config.profile.topics.join(", ")}
Language preference: ${this.config.profile.language}
Preferred outputs: ${this.config.profile.output.join(", ")}`
      : "No profile selected.";

    const prompt = `You are an analyst for marketing teams.
Return strict JSON with keys:
- isRelevant (boolean)
- relevanceReason (string)
- summary (1-2 sentences)
- insight (why this matters)
- action (concrete marketing action)
- replyIdea (optional concise reply draft)

Target domains: marketing, AI, growth, SaaS, HR, LMS.
${profileContext}
Post text:\n${post.text}\n
Metrics: likes=${post.likes}, replies=${post.replies}, reposts=${post.reposts}.`;

    const response = await this.client.responses.create({
      model: this.config.openAiModel,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "threads_insight",
          schema: OUTPUT_SCHEMA,
          strict: true,
        },
      },
      temperature: 0.2,
    });

    const raw = response.output_text;
    const parsed = this.safeParse(raw);

    return {
      isRelevant: Boolean(parsed.isRelevant),
      relevanceReason: typeof parsed.relevanceReason === "string" ? parsed.relevanceReason : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      insight: typeof parsed.insight === "string" ? parsed.insight : "",
      action: typeof parsed.action === "string" ? parsed.action : "",
      replyIdea: typeof parsed.replyIdea === "string" ? parsed.replyIdea : undefined,
    };
  }

  private safeParse(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error("OpenAI returned non-JSON output");
      }
      return JSON.parse(match[0]) as Record<string, unknown>;
    }
  }
}
