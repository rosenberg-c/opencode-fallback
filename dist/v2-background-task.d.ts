import type { Plugin } from "@opencode/plugin";
import type { V2ForegroundTaskFallback } from "./v2-foreground-task";
/** Captured by this imported module, rather than inferred from files on disk. */
export declare const BACKGROUND_RUNTIME: Readonly<{
    revision: "final-outcome-v2";
    moduleID: `${string}-${string}-${string}-${string}-${string}`;
}>;
export type NativeSubagentOutput = {
    sessionID: string;
    status: "completed" | "running";
    output: string;
};
export type NativeToolResult = {
    output: NativeSubagentOutput;
    content: string;
    metadata: {
        sessionID: string;
        status: "completed" | "running";
    };
};
export type NativeToolContext = {
    sessionID: string;
    signal: AbortSignal;
    progress: (update: Record<string, unknown>) => Promise<void>;
};
export type NativeTool = {
    execute: (input: unknown, context: NativeToolContext) => Promise<unknown>;
};
/**
 * Recovery timing. `pollMs` is the interval between session-history checks for a
 * reloaded child. `graceMs` is how long an unchanged `interrupted` or `failed`
 * outcome must persist before it is treated as terminal; an admitted continuation
 * changes the session timestamps and restarts the window.
 */
export declare const RECOVERY_TIMING: {
    pollMs: number;
    graceMs: number;
};
/**
 * Bind this plugin generation as the latest context for its location. Returns a
 * release function for registration disposal. Release never cancels any child;
 * it only lets pending jobs wait for the next binding.
 */
export declare function createBackgroundLease(ctx: Plugin.Context, coordination: V2ForegroundTaskFallback): () => void;
/**
 * Start a native `subagent` call as a background job while the foreground
 * native run keeps owning permissions, nesting, agent selection, and child
 * creation. The parent receives a running result as soon as the child session
 * is reported. The final outcome (after any owned fallback) is delivered as one
 * synthetic message to the parent, using the latest binding for the location.
 */
export declare function startBackgroundSubagent(ctx: Plugin.Context, coordination: V2ForegroundTaskFallback, native: NativeTool, input: unknown, context: NativeToolContext): Promise<unknown>;
/**
 * Escape a value for a double-quoted XML attribute in the subagent envelope.
 */
export declare function escapeXMLAttribute(value: string): string;
/**
 * Read the latest non-error assistant text from the supported V2 session
 * context API. Used after an owned child has reached success.
 */
export declare function readV2ForegroundSubagentOutput(ctx: Plugin.Context, sessionID: string): Promise<string | undefined>;
