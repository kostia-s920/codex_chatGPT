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

function parseMetric(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.trim().toLowerCase();
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
  constructor(private readonly config: AppConfig) {}

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
    logger.info("Scraping Threads page", { url, source });

    let browser;

    try {
      browser = await chromium.launch({ headless: this.config.scrapeHeadless });

      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000);
      await this.smoothScroll(page);

      logger.info("Threads page loaded", {
        source,
        currentUrl: page.url(),
        title: await page.title(),
      });

      const extracted = await this.extractWithLocators(page);

      return extracted.map((post) => ({
        ...normalizeRawPost(post),
        source,
      }));
    } catch (error) {
      logger.error("Scrape failed", {
        url,
        source,
        error: error instanceof Error ? error.message : String(error),
      });

      return [];
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private async extractWithLocators(page: Page): Promise<RawExtraction[]> {
    const results: RawExtraction[] = [];
    const articles = page.locator("article");
    const total = await articles.count();
    const limit = Math.min(total, this.config.maxPostsPerSource);

    for (let i = 0; i < limit; i++) {
      const article = articles.nth(i);

      const text = (await article.textContent())?.trim() ?? "";
      if (!text) continue;

      const link = article.locator('a[href*="/post/"]').first();
      let href = await link.getAttribute("href");

      if (!href) {
        href = page.url();
      }

      if (!href.startsWith("http")) {
        href = `https://www.threads.com${href}`;
      }

      const id = (href.split("/post/")[1] || `${sourceHash(href)}-${i}`).split(/[/?#]/)[0];

      const authorText =
        (await article.locator("a[href^='/@']").first().textContent().catch(() => null)) ??
        "unknown";

      const authorHandle = authorText.replace("@", "").trim() || "unknown";

      const likesText = text.match(/(\d[\d.,]*\s*[kmb]?)\s+likes?/i)?.[1] ?? "";
      const repliesText = text.match(/(\d[\d.,]*\s*[kmb]?)\s+repl(?:y|ies)/i)?.[1] ?? "";
      const repostsText = text.match(/(\d[\d.,]*\s*[kmb]?)\s+reposts?/i)?.[1] ?? "";

      const timeLocator = article.locator("time").first();
      const hasTime = await timeLocator.count().catch(() => 0);
      const timestamp =
        hasTime > 0 ? (await timeLocator.getAttribute("datetime").catch(() => undefined)) ?? undefined : undefined;

      results.push({
        id,
        url: href,
        authorHandle,
        text,
        likesText,
        repliesText,
        repostsText,
        timestamp,
      });
    }

    logger.info("Locator extraction complete", {
      currentUrl: page.url(),
      extracted: results.length,
      totalArticles: total,
    });

    return results;
  }

  private async smoothScroll(page: Page): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(900);
    }
  }
}

function sourceHash(value: string): string {
  let hash = 0;

  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash).toString();
}