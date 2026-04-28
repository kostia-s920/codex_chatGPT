import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ThreadsPost } from "../scraper/types";

export interface StoredInsight {
  postId: string;
  postUrl: string;
  summary: string;
  insight: string;
  action: string;
  replyIdea?: string;
  tags: string[];
  viralScore: number;
}

export class AgentDatabase {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_posts (
        post_id TEXT PRIMARY KEY,
        post_url TEXT NOT NULL,
        author_handle TEXT NOT NULL,
        text TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_value TEXT NOT NULL,
        likes INTEGER NOT NULL,
        replies INTEGER NOT NULL,
        reposts INTEGER NOT NULL,
        processed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS generated_insights (
        post_id TEXT PRIMARY KEY,
        post_url TEXT NOT NULL,
        summary TEXT NOT NULL,
        insight TEXT NOT NULL,
        action TEXT NOT NULL,
        reply_idea TEXT,
        tags_json TEXT NOT NULL,
        viral_score REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(post_id) REFERENCES processed_posts(post_id)
      );
    `);
  }

  isProcessed(postId: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM processed_posts WHERE post_id = ? LIMIT 1");
    return Boolean(stmt.get(postId));
  }

  markProcessed(post: ThreadsPost): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO processed_posts
      (post_id, post_url, author_handle, text, source_type, source_value, likes, replies, reposts, processed_at)
      VALUES (@id, @url, @authorHandle, @text, @sourceType, @sourceValue, @likes, @replies, @reposts, @processedAt)
    `);

    stmt.run({
      id: post.id,
      url: post.url,
      authorHandle: post.authorHandle,
      text: post.text,
      sourceType: post.source.type,
      sourceValue: post.source.value,
      likes: post.likes,
      replies: post.replies,
      reposts: post.reposts,
      processedAt: new Date().toISOString(),
    });
  }

  saveInsight(insight: StoredInsight): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO generated_insights
      (post_id, post_url, summary, insight, action, reply_idea, tags_json, viral_score, created_at)
      VALUES (@postId, @postUrl, @summary, @insight, @action, @replyIdea, @tagsJson, @viralScore, @createdAt)
    `);

    stmt.run({
      postId: insight.postId,
      postUrl: insight.postUrl,
      summary: insight.summary,
      insight: insight.insight,
      action: insight.action,
      replyIdea: insight.replyIdea ?? null,
      tagsJson: JSON.stringify(insight.tags),
      viralScore: insight.viralScore,
      createdAt: new Date().toISOString(),
    });
  }
}
