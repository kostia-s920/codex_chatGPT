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

  likes: number;
  replies: number;
  reposts: number;
  timestamp?: string;
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

      const extracted = await this.extractWithLocators(page);
      return extracted.map((post) => ({ ...normalizeRawPost(post), source }));
      await page.waitForTimeout(6000);
      await this.smoothScroll(page);

      const extracted = await page.evaluate((maxPosts) => {
        const parseMetric = (value: string | null | undefined): number => {
          if (!value) return 0;
          const normalized = value.trim().toLowerCase();
          if (!normalized) return 0;

          const match = normalized.match(/([\d.,]+)\s*([kmb])?/i);
          if (!match) return 0;

          const base = Number(match[1].replace(/,/g, ""));
          if (Number.isNaN(base)) return 0;
          const suffix = match[2];
          if (suffix === "k") return Math.round(base * 1_000);
          if (suffix === "m") return Math.round(base * 1_000_000);
          if (suffix === "b") return Math.round(base * 1_000_000_000);
          return Math.round(base);
        };

        const posts = new Map<string, RawExtraction>();
        const articles = Array.from(document.querySelectorAll("article"));

        for (const article of articles) {
          const link = article.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
          if (!link?.href) continue;

          const url = link.href;
          const id = url.split("/post/")[1]?.split(/[/?#]/)[0] ?? url;
          const text =
            article.querySelector("div[dir='auto'] span")?.textContent?.trim() ??
            article.textContent?.trim() ??
            "";
          if (!text) continue;

          const mentions = Array.from(article.querySelectorAll("a[href^='/@']"));
          const authorHandle = mentions[0]?.textContent?.replace("@", "").trim() ?? "unknown";

          const metricContainer = article.textContent ?? "";
          const likes = parseMetric(metricContainer.match(/(\d[\d.,]*\s*[kmb]?)\s+likes?/i)?.[1]);
          const replies = parseMetric(metricContainer.match(/(\d[\d.,]*\s*[kmb]?)\s+repl(?:y|ies)/i)?.[1]);
          const reposts = parseMetric(metricContainer.match(/(\d[\d.,]*\s*[kmb]?)\s+reposts?/i)?.[1]);

          const timeEl = article.querySelector("time");
          const timestamp = timeEl?.getAttribute("datetime") ?? undefined;

          posts.set(id, { id, url, authorHandle, text, likes, replies, reposts, timestamp });
          if (posts.size >= maxPosts) break;
        }

        return Array.from(posts.values());
      }, this.config.maxPostsPerSource);

      return extracted.map((post) => ({ ...post, source }));
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

  private async extractWithLocators(page: Page): Promise<RawExtraction[]> {
    const results: RawExtraction[] = [];
    const articles = page.locator("article");
    const total = await articles.count();
    const limit = Math.min(total, this.config.maxPostsPerSource);

    for (let i = 0; i < limit; i++) {
      const article = articles.nth(i);
      const link = article.locator('a[href*="/post/"]').first();

      let href = await link.getAttribute("href");
      if (!href) continue;
      if (!href.startsWith("http")) href = `https://www.threads.com${href}`;

      const id = (href.split("/post/")[1] || href).split(/[/?#]/)[0];
      const text = (await article.textContent())?.trim() ?? "";
      if (!text) continue;

      const authorText = (await article.locator("a[href^='/@']").first().textContent()) ?? "unknown";
      const authorHandle = authorText.replace("@", "").trim() || "unknown";

      const likesText = text.match(/(\d[\d.,]*\s*[kmb]?)\s+likes?/i)?.[1] ?? "";
      const repliesText = text.match(/(\d[\d.,]*\s*[kmb]?)\s+repl(?:y|ies)/i)?.[1] ?? "";
      const repostsText = text.match(/(\d[\d.,]*\s*[kmb]?)\s+reposts?/i)?.[1] ?? "";

      const timeLocator = article.locator("time").first();
      const hasTime = (await timeLocator.count()) > 0;
      const timestamp = hasTime ? (await timeLocator.getAttribute("datetime")) ?? undefined : undefined;

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
  private async smoothScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await delay(900);
      }
    });
  }
}
