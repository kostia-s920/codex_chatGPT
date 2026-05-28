import { AppConfig } from "../config/env";

export class TelegramClient {
  private readonly apiBase: string;

  constructor(private readonly config: AppConfig) {
    this.apiBase = `https://api.telegram.org/bot${this.config.telegramBotToken}`;
  }

  async sendInsight(message: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.telegramChatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error: ${response.status} ${body}`);
    }
  }

  formatMessage(payload: {
    postText: string;
    summary: string;
    insight: string;
    action: string;
    link: string;
    replyIdea?: string;
    tags: string[];
    viralScore: number;
  }): string {
    return [
      `Post:\n${payload.postText}`,
      `Summary:\n${payload.summary}`,
      `Insight:\n${payload.insight}`,
      `Action:\n${payload.action}`,
      payload.replyIdea ? `Reply idea:\n${payload.replyIdea}` : undefined,
      `Tags: ${payload.tags.join(", ")}`,
      `Viral potential: ${payload.viralScore}/100`,
      `Link:\n${payload.link}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}
