import type { Plugin } from "@opencode/plugin";
import type { OpenCodeEvent } from "@opencode/client";
import type { FallbackPluginConfig } from "./types";
import type { FallbackNotifyInput } from "./v2-notifications";
export declare const SUMMARY_INSTRUCTION: string;
export interface V2CompactionFallbackOptions {
    config: Required<FallbackPluginConfig>;
    /** Resolved fallback chain for the parent compaction's agent. */
    chain: (agent: string) => Promise<string[]> | string[];
    notify?: (input: FallbackNotifyInput) => Promise<void> | void;
    /** Agent used by temporary children. Defaults to the parent compaction's agent. */
    childAgent?: (parentAgent: string) => string;
    /** Called when a compaction starts so the caller can clear its main first-token timer. */
    clearMainTimer?: (sessionID: string) => void;
    /** While this returns false, compactions are left to the host (no interception). */
    streamHealthy?: () => boolean;
}
export interface V2CompactionFallback {
    /** Soft-cancels runs, awaits their native cleanup, and unregisters hooks. */
    dispose(): Promise<void>;
    /** True for a live temporary child, or one removed within the TTL. Callers must skip it. */
    isInternal(sessionID: string): boolean;
    /** Feed host events. Only parent cancellation and child progress/failure matter here. */
    handleEvent(event: OpenCodeEvent): void;
    /** Hard-cancel the in-flight compaction run for a parent session. The run rejects. */
    cancel(sessionID: string): void;
    /** Soft-cancel all in-flight runs. They resolve without a result so native compaction continues. */
    cancelAll(): void;
}
/**
 * Compaction-time fallback. Each attempt runs the saved history (system, messages,
 * options) plus SUMMARY_INSTRUCTION in a host-native temporary child session, so the
 * parent's model, agent, attempt options, and request are never modified. The result is returned to the parent compaction
 * hook only when a child produces non-empty summary text.
 */
export declare function installV2CompactionFallback(ctx: Plugin.Context, options: V2CompactionFallbackOptions): Promise<V2CompactionFallback>;
