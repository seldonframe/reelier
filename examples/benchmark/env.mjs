// Parses ANTHROPIC_API_KEY out of the Seldon Frame CRM's .env.local without
// ever printing it. Zero deps — hand-rolled .env line parser (KEY="value" /
// KEY=value, one per line, # comments, no multiline values).
import { readFile } from "node:fs/promises";

const ENV_PATH =
  "C:\\Users\\maxim\\CascadeProjects\\Seldon Frame\\packages\\crm\\.env.local";

export async function getAnthropicApiKey() {
  const text = await readFile(ENV_PATH, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key !== "ANTHROPIC_API_KEY") continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) throw new Error("ANTHROPIC_API_KEY found but empty in .env.local");
    return value;
  }
  throw new Error(`ANTHROPIC_API_KEY not found in ${ENV_PATH}`);
}
