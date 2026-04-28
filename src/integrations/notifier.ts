export interface Notifier {
  send(message: string): Promise<void>;
}

export class NoopSlackNotifier implements Notifier {
  async send(_message: string): Promise<void> {
    // Reserved extension point for future Slack support.
  }
}
