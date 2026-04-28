export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const payload = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${ts}] [${level}] ${message}${payload}`;
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(format("INFO", message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(format("WARN", message, meta));
  },
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(format("ERROR", message, meta));
  },
  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.LOG_LEVEL === "debug") {
      console.debug(format("DEBUG", message, meta));
    }
  },
};
