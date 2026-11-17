/**
 * Config reader for the standalone fallback plugin.
 *
 * Reads `fallback_models` from OpenCode's agent config section
 * (passed via the plugin config hook), NOT from oh-my-opencode.jsonc.
 */
type AgentRecord = Record<string, unknown>;
/**
 * OpenCode and plugins may expose agent definitions under either `agent` or
 * `agents`. Preserve both sources, with explicit singular entries overriding
 * fields for the same agent.
 */
export declare function mergeAgentConfigs(pluralAgents: unknown, singularAgent: unknown): AgentRecord | undefined;
export declare function normalizeFallbackModelsField(value: unknown): string[];
export declare function readFallbackModels(agentName: string, agents: AgentRecord | undefined): string[];
export declare function resolveAgentForSession(sessionID: string, eventAgent?: string): string | undefined;
export declare function getFallbackModelsForSession(sessionID: string, eventAgent: string | undefined, agents: AgentRecord | undefined, globalFallbackModels?: string[]): string[];
export {};
