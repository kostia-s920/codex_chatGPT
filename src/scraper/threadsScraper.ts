import { chromium, Page } from "playwright";
import { AppConfig } from "../config/env";
import { logger } from "../config/logger";
import { Scraper, ThreadsPost } from "./types";

interface RawExtraction {
  id: string;
  url: string;
  authorHandle: string;
  text: string;
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
