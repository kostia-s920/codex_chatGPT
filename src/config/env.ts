import path from "node:path";
import { AgentProfile, loadProfile } from "./profile";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return ["true", "1", "yes", "y"].includes(value.toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface ConfigLoadOptions {
  requireOpenAi?: boolean;
  requireTelegram?: boolean;
}

export interface AppConfig {
  openAiApiKey: string;
  openAiModel: string;
  telegramBotToken: string;
  telegramChatId: string;
  scrapeHeadless: boolean;
  runImmediately: boolean;
  cronSchedule: string;
  keywords: string[];
  creators: string[];
  likesThreshold: number;
  minReplyRatio: number;
  dbPath: string;
  maxPostsPerSource: number;
  profileName?: string;
  profile?: AgentProfile;
}

export function loadConfig(options: ConfigLoadOptions = {}): AppConfig {
  const requireOpenAi = options.requireOpenAi ?? true;
  const requireTelegram = options.requireTelegram ?? true;

  const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const telegramChatId = process.env.TELEGRAM_CHAT_ID ?? "";

  if (requireOpenAi && !openAiApiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  if (requireTelegram && !telegramBotToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }
  if (requireTelegram && !telegramChatId) {
    throw new Error("Missing TELEGRAM_CHAT_ID");
  }

  const profileName = process.env.AGENT_PROFILE?.trim() || undefined;
  const profile = loadProfile(profileName);
  const fallbackKeywords = ["marketing", "AI", "growth", "SaaS", "HR", "LMS"];

  return {
    openAiApiKey,
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    telegramBotToken,
    telegramChatId,
    scrapeHeadless: parseBoolean(process.env.SCRAPE_HEADLESS, true),
    runImmediately: parseBoolean(process.env.RUN_IMMEDIATELY, true),
    cronSchedule: process.env.CRON_SCHEDULE ?? "0 */2 * * *",
    keywords: parseCsv(process.env.THREADS_KEYWORDS, profile?.topics ?? fallbackKeywords),
    creators: parseCsv(process.env.THREADS_CREATORS, []),
    likesThreshold: parseNumber(process.env.ENGAGEMENT_LIKES_THRESHOLD, 50),
    minReplyRatio: parseNumber(process.env.MIN_REPLY_RATIO, 0.2),
    dbPath: path.resolve(process.env.DB_PATH ?? "./data/threads-agent.db"),
    maxPostsPerSource: parseNumber(process.env.MAX_POSTS_PER_SOURCE, 20),
    profileName,
    profile,
  };
}
