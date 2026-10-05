// AI consultant: Anthropic client, tools, PII scrubber, guards (ARCHITECTURE 8). Owner — WP-24.
// Without ANTHROPIC_API_KEY or with AI_ENABLED=false the platform works in "no AI" mode.

export type AiMode = "off" | "full" | "economy";

/** "off" unless a key is present and the flag is on; budget modes are decided later by WP-24. */
export function aiModeFromEnv(env: { ANTHROPIC_API_KEY?: string | undefined; AI_ENABLED: boolean }): AiMode {
  return env.ANTHROPIC_API_KEY && env.AI_ENABLED ? "full" : "off";
}
