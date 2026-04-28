import fs from "node:fs";
import path from "node:path";

export interface AgentProfile {
  name: string;
  topics: string[];
  language: string;
  output: string[];
}

export function loadProfile(profileName?: string): AgentProfile | undefined {
  if (!profileName) return undefined;

  const profilePath = path.resolve(process.cwd(), "config", "profiles", `${profileName}.json`);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile '${profileName}' not found at ${profilePath}`);
  }

  const raw = fs.readFileSync(profilePath, "utf8");
  const parsed = JSON.parse(raw) as AgentProfile;

  if (!parsed.name || !Array.isArray(parsed.topics) || !Array.isArray(parsed.output)) {
    throw new Error(`Invalid profile schema in ${profilePath}`);
  }

  return parsed;
}
