import fs from "node:fs/promises";
import path from "node:path";
import { chromium, Page } from "playwright";
import { AppConfig } from "../config/env";
import { logger } from "../config/logger";
import { Scraper, ThreadsPost } from "./types";

interface RawExtraction {
  id: string;
  url: string;
  authorHandle: string;
  text: string;
  likesText?: string;
  repliesText?: string;
  repostsText?: string;
  timestamp?: string;
}

const POST_CONTAINER_SELECTORS = [
  "article",
  "div[role='article']",
  "div[data-pressable-container='true']",
  "div[tabindex='0']",
];

function parseMetric(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 0;

  const match = normalized.match(/([\d.,]+)\s*([kmb])?/i);
  if (!match) return 0;

  const base = Number(match[1].replace(/,/g, ""));
  if (Number.isNaN(base)) return 0;

  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") return Math.round(base * 1_000);
  if (suffix === "m") return Math.round(base * 1_000_000);
  if (suffix === "b") return Math.round(base * 1_000_000_000);
  return Math.round(base);
}

function normalizeRawPost(post: RawExtraction): Omit<ThreadsPost, "source"> {
  return {
    id: post.id,
    url: post.url,
    authorHandle: post.authorHandle,
    text: post.text,
    likes: parseMetric(post.likesText),
    replies: parseMetric(post.repliesText),
    reposts: parseMetric(post.repostsText),
    timestamp: post.timestamp,
  };
}

export class ThreadsScraper implements Scraper {
  private readonly debugMode: boolean;

  constructor(private readonly config: AppConfig) {
    this.debugMode = ["1", "true", "yes"].includes((process.env.SCRAPER_DEBUG ?? "").toLowerCase());
  }

  async fetchByKeywords(keywords: string[]): Promise<ThreadsPost[]> {
    const all: ThreadsPost[] = [];
    for (const keyword of keywords) {
      const url = `https://www.threads.com/search?q=${encodeURIComponent(keyword)}`;
      const posts = await this.scrapePage(url, { type: "keyword", value: keyword });
      all.push(...posts);
    }
    return all;
  }

  async fetchByCreators(creators: string[]): Promise<ThreadsPost[]> {
    const all: ThreadsPost[] = [];
    for (const creator of creators) {
      const handle = creator.startsWith("@") ? creator.slice(1) : creator;
      if (!handle) continue;
      const url = `https://www.threads.com/@${encodeURIComponent(handle)}`;
      const posts = await this.scrapePage(url, { type: "creator", value: handle });
      all.push(...posts);
    }
    return all;
  }

  private async scrapePage(
    url: string,
    source: { type: "keyword" | "creator"; value: string }
  ): Promise<ThreadsPost[]> {
    logger.info("Scraping Threads page", { url, source, debugMode: this.debugMode });
    const browser = await chromium.launch({ headless: this.config.scrapeHeadless });

    try {
      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000);
      await this.smoothScroll(page);

      logger.info("Threads page loaded", {
        source,
        currentUrl: page.url(),
        title: await page.title(),
      });

      if (this.debugMode) {
        await this.writeDebugArtifacts(page);
      }

      const visibility = await this.detectVisibilitySignals(page);
      logger.info("Threads visibility signals", { source, ...visibility });

      const extracted = await this.extractWithLocators(page);
      return extracted.map((post) => ({ ...normalizeRawPost(post), source }));
    } catch (error) {
      logger.error("Scrape failed", {
        url,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    } finally {
      await browser.close();
    }
  }

  private async detectVisibilitySignals(page: Page): Promise<{
    loginWallVisible: boolean;
    emptyStateVisible: boolean;
    postsVisible: boolean;
    candidateCount: number;
  }> {
    const loginWallVisible =
      (await page.getByText(/log in|sign up|continue with instagram/i).first().count()) > 0 ||
      (await page.locator("input[name='username'], input[name='password']").count()) > 0;

    const emptyStateVisible =
      (await page.getByText(/no results|try searching for something else|nothing to see here/i).first().count()) > 0;

    const candidateCount = await this.countCandidateContainers(page);
    const postsVisible = candidateCount > 0;

    return {
      loginWallVisible,
      emptyStateVisible,
      postsVisible,
      candidateCount,
    };
  }

  private async countCandidateContainers(page: Page): Promise<number> {
    let total = 0;
    for (const selector of POST_CONTAINER_SELECTORS) {
      total += await page.locator(selector).count();
    }
    return total;
  }

  private async writeDebugArtifacts(page: Page): Promise<void> {
    const debugDir = path.resolve(process.cwd(), "debug");
    await fs.mkdir(debugDir, { recursive: true });

    const screenshotPath = path.join(debugDir, "threads-page.png");
    const htmlPath = path.join(debugDir, "threads-page.html");

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const html = await page.content();
    await fs.writeFile(htmlPath, html, "utf8");

    logger.info("Scraper debug artifacts written", {
      screenshotPath,
      htmlPath,
      currentUrl: page.url(),
    });
  }

  private async extractWithLocators(page: Page): Promise<RawExtraction[]> {
    const resultsMap = new Map<string, RawExtraction>();

    for (const selector of POST_CONTAINER_SELECTORS) {
      const containers = page.locator(selector);
      const total = await containers.count();
      const limit = Math.min(total, this.config.maxPostsPerSource);

      logger.debug("Scanning selector", { selector, total, limit });

      for (let i = 0; i < limit; i++) {
        const container = containers.nth(i);
        const link = container.locator('a[href*="/post/"]').first();

        let href = await link.getAttribute("href");
        if (!href) continue;
        if (!href.startsWith("http")) href = `https://www.threads.com${href}`;

        const id = (href.split("/post/")[1] || href).split(/[/?#]/)[0];
        if (resultsMap.has(id)) continue;

        const text = (await container.textContent())?.trim() ?? "";
        if (!text) continue;

        const authorText = (await container.locator("a[href^='/@']").first().textContent()) ?? "unknown";
        const authorHandle = authorText.replace("@", "").trim() || "unknown";

        const likesText = text.match(/(\d[\d.,]*\s*[kmb]?)\s+likes?/i)?.[1] ?? "";
        const repliesText = text.match(/(\d[\d.,]*\s*[kmb]?)\s+repl(?:y|ies)/i)?.[1] ?? "";
        const repostsText = text.match(/(\d[\d.,]*\s*[kmb]?)\s+reposts?/i)?.[1] ?? "";

        const timeLocator = container.locator("time").first();
        const hasTime = (await timeLocator.count()) > 0;
        const timestamp = hasTime ? (await timeLocator.getAttribute("datetime")) ?? undefined : undefined;

        resultsMap.set(id, {
          id,
          url: href,
          authorHandle,
          text,
          likesText,
          repliesText,
          repostsText,
          timestamp,
        });

        if (resultsMap.size >= this.config.maxPostsPerSource) break;
      }

      if (resultsMap.size >= this.config.maxPostsPerSource) break;
    }

    logger.info("Locator extraction complete", {
      currentUrl: page.url(),
      extracted: resultsMap.size,
    });

    return Array.from(resultsMap.values());
  }

  private async smoothScroll(page: Page): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(900);
    }
  }
}
