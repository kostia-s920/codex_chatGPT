import { ThreadsPost } from "../scraper/types";

const TAG_KEYWORDS: Record<string, string[]> = {
  AI: ["ai", "llm", "gpt", "automation", "agent"],
  Growth: ["growth", "acquisition", "funnel", "retention", "viral"],
  Marketing: ["marketing", "brand", "content", "campaign", "seo"],
  HR: ["hr", "hiring", "talent", "recruitment", "people ops"],
  SaaS: ["saas", "subscription", "arr", "mrr", "churn"],
  LMS: ["lms", "learning", "course", "education", "training"],
};

export function scoreViralPotential(post: ThreadsPost): number {
  const likesComponent = Math.min(post.likes / 500, 1) * 45;
  const repliesComponent = Math.min(post.replies / 80, 1) * 35;
  const repostComponent = Math.min(post.reposts / 40, 1) * 20;
  return Math.round(likesComponent + repliesComponent + repostComponent);
}

export function inferTags(text: string): string[] {
  const normalized = text.toLowerCase();
  const tags = Object.entries(TAG_KEYWORDS)
    .filter(([, keys]) => keys.some((key) => normalized.includes(key)))
    .map(([tag]) => tag);

  return tags.length > 0 ? tags : ["General"];
}
