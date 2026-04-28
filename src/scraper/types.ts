export interface ThreadsPost {
  id: string;
  url: string;
  authorHandle: string;
  text: string;
  likes: number;
  replies: number;
  reposts: number;
  timestamp?: string;
  source: {
    type: "keyword" | "creator";
    value: string;
  };
}

export interface Scraper {
  fetchByKeywords(keywords: string[]): Promise<ThreadsPost[]>;
  fetchByCreators(creators: string[]): Promise<ThreadsPost[]>;
}
