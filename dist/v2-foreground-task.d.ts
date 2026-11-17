import type { Plugin } from "@opencode/plugin";
import type { Registration } from "@opencode/plugin/promise/registration";
export { readV2ForegroundSubagentOutput } from "./v2-background-task";
/**
 * The V2 plugin owns retry/fallback state. This adapter only restores the
 * foreground tool's result after that owner has recovered the native child.
 */
export interface V2ForegroundTaskFallback {
    /** True for a tracked child eligible for or already running fallback. */
    ownsFallback(sessionID: string): boolean;
    /** True after an observed user interruption, rather than an owned TTFT interrupt. */
    isCancelled?(sessionID: string): boolean;
    /** Cancel the plugin-owned hand-off synchronously, even while the child is idle. */
    cancelFallback(sessionID: string): void;
    /** Resolves with the completed child output after the owned fallback ends. */
    waitForFallback(sessionID: string, signal: AbortSignal): Promise<string | undefined>;
}
/**
 * Wrap OpenCode's native V2 `subagent` tool without replacing its session,
 * permission, agent-selection, or cancellation behavior. The native tool
 * reports the child session ID through its supported progress callback before
 * starting the child prompt. When native execution fails, the V2 owner can
 * keep the foreground call pending through fallback and supply its result.
 *
 * Background calls detach through the final-outcome adapter; successful native
 * foreground calls and unowned child failures retain their native results.
 */
export declare function installV2ForegroundTaskFallback(ctx: Plugin.Context, coordination: V2ForegroundTaskFallback): Promise<Registration>;
