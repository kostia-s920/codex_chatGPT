import { AppConfig } from "../config/env";
import { logger } from "../config/logger";
import { AgentDatabase } from "../db/database";
import { OpenAiProcessor } from "../processor/openaiProcessor";
import { passesEngagement, isSupportedLanguage } from "../processor/filter";
import { withRetry } from "../processor/retry";
import { inferTags, scoreViralPotential } from "../processor/scoring";
import { ThreadsScraper } from "../scraper/threadsScraper";
import { ThreadsPost } from "../scraper/types";
import { TelegramClient } from "../telegram/telegramClient";

export class ThreadsToTelegramAgent {
  private readonly scraper: ThreadsScraper;
  private readonly db: AgentDatabase;
  private readonly processor: OpenAiProcessor;
  private readonly telegram: TelegramClient;

  constructor(private readonly config: AppConfig) {
    this.scraper = new ThreadsScraper(config);
    this.db = new AgentDatabase(config.dbPath);
    this.processor = new OpenAiProcessor(config);
    this.telegram = new TelegramClient(config);
  }

  async fetchCandidates(): Promise<ThreadsPost[]> {
    const [keywordPosts, creatorPosts] = await Promise.all([
      withRetry(() => this.scraper.fetchByKeywords(this.config.keywords), 2, 1500),
      withRetry(() => this.scraper.fetchByCreators(this.config.creators), 2, 1500),
    ]);

    return this.deduplicate([...keywordPosts, ...creatorPosts]);
  }

  async runOnce(): Promise<void> {
    logger.info("Agent run started", { profile: this.config.profileName ?? "default" });

    const allPosts = await this.fetchCandidates();
    logger.info("Fetched posts", { total: allPosts.length });

    for (const post of allPosts) {
      try {
        await this.processPost(post);
      } catch (error) {
        logger.error("Post processing failed", {
          postId: post.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("Agent run completed");
  }

  private deduplicate(posts: ThreadsPost[]): ThreadsPost[] {
    const map = new Map<string, ThreadsPost>();
    for (const post of posts) {
      if (!map.has(post.id)) {
        map.set(post.id, post);
      }
    }
    return Array.from(map.values());
  }

  private async processPost(post: ThreadsPost): Promise<void> {
    if (this.db.isProcessed(post.id)) {
      logger.debug("Skipping duplicate", { postId: post.id });
      return;
    }

    if (!passesEngagement(post, this.config)) {
      logger.debug("Skipping low engagement", { postId: post.id });
      return;
    }

    if (!isSupportedLanguage(post.text)) {
      logger.debug("Skipping unsupported language", { postId: post.id });
      return;
    }

    const analysis = await withRetry(() => this.processor.classifyAndExtract(post), 2, 2000);

    if (!analysis.isRelevant) {
      logger.debug("Skipping low relevance", { postId: post.id, reason: analysis.relevanceReason });
      return;
    }

    const tags = inferTags(post.text);
    const viralScore = scoreViralPotential(post);

    const message = this.telegram.formatMessage({
      postText: post.text,
      summary: analysis.summary,
      insight: analysis.insight,
      action: analysis.action,
      link: post.url,
      replyIdea: analysis.replyIdea,
      tags,
      viralScore,
    });

    await withRetry(() => this.telegram.sendInsight(message), 2, 1500);

    this.db.markProcessed(post);
    this.db.saveInsight({
      postId: post.id,
      postUrl: post.url,
      summary: analysis.summary,
      insight: analysis.insight,
      action: analysis.action,
      replyIdea: analysis.replyIdea,
      tags,
      viralScore,
    });

    logger.info("Insight sent", { postId: post.id, tags, viralScore });
  }
}
