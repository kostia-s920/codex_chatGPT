import { AppConfig } from "../config/env";
import { ThreadsPost } from "../scraper/types";

export function isSupportedLanguage(text: string): boolean {
  const hasLatin = /[A-Za-z]/.test(text);
  const hasUkrainianChars = /[ІіЇїЄєҐґ]/.test(text);
  const hasCyrillic = /[А-Яа-я]/.test(text);

  const isEnglishLike = hasLatin;
  const isUkrainianLike = hasUkrainianChars || hasCyrillic;

  return isEnglishLike || isUkrainianLike;
}

export function passesEngagement(post: ThreadsPost, config: AppConfig): boolean {
  const replyRatio = post.likes > 0 ? post.replies / post.likes : 0;
  return post.likes >= config.likesThreshold || replyRatio >= config.minReplyRatio;
}
