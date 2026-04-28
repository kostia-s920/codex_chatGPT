import "dotenv/config";
import cron from "node-cron";
import { ThreadsToTelegramAgent } from "./agent/pipeline";
import { loadConfig } from "./config/env";
import { logger } from "./config/logger";
import { ThreadsScraper } from "./scraper/threadsScraper";
import { TelegramClient } from "./telegram/telegramClient";

export type RunMode = "cron" | "run-once" | "scrape-only" | "test-telegram";

function parseMode(argv: string[]): RunMode {
  const modeArg = argv[2] as RunMode | undefined;
  return modeArg ?? "cron";
}

async function runCron(agent: ThreadsToTelegramAgent, schedule: string): Promise<void> {
  cron.schedule(schedule, async () => {
    logger.info("Scheduled run triggered", { schedule });
    await agent.runOnce();
  });

  logger.info("Threads -> Telegram agent cron mode started", { schedule });
}

async function runScrapeOnly(): Promise<void> {
  const config = loadConfig({ requireOpenAi: false, requireTelegram: false });
  const scraper = new ThreadsScraper(config);
  const [keywordPosts, creatorPosts] = await Promise.all([
    scraper.fetchByKeywords(config.keywords),
    scraper.fetchByCreators(config.creators),
  ]);

  const posts = [...keywordPosts, ...creatorPosts];
  console.log(JSON.stringify(posts, null, 2));
  logger.info("Scrape-only run completed", { total: posts.length });
}

async function runTelegramTest(): Promise<void> {
  const config = loadConfig({ requireOpenAi: false, requireTelegram: true });
  const telegram = new TelegramClient(config);
  const profileText = config.profileName ? `Profile: ${config.profileName}` : "Profile: default";
  const message = `✅ Threads agent Telegram test\n${profileText}\n${new Date().toISOString()}`;
  await telegram.sendInsight(message);
  logger.info("Telegram test message sent successfully");
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv);

  if (mode === "scrape-only") {
    await runScrapeOnly();
    return;
  }

  if (mode === "test-telegram") {
    await runTelegramTest();
    return;
  }

  const config = loadConfig();
  const agent = new ThreadsToTelegramAgent(config);

  if (mode === "run-once") {
    await agent.runOnce();
    return;
  }

  if (config.runImmediately) {
    await agent.runOnce();
  }

  await runCron(agent, config.cronSchedule);
}

main().catch((error) => {
  logger.error("Fatal startup error", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
