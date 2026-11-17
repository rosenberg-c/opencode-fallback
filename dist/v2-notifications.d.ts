import type { Plugin } from "@opencode/plugin";
import type { FallbackPluginConfig } from "./types";
import { type FallbackNotificationKind } from "./fallback-rpc";
export interface FallbackNotifyInput {
    sessionID: string;
    /** Model that failed, as "provider/id[#variant]". */
    from: string;
    /** Model that was admitted, as "provider/id[#variant]". */
    to: string;
    kind: FallbackNotificationKind;
}
export interface FallbackNotifications {
    /** Never rejects. Callers notify once per admitted fallback. */
    notify(input: FallbackNotifyInput): Promise<void>;
    /** Idempotent. Unregisters the RPC and drops later notifications. */
    dispose(): Promise<void>;
}
/**
 * Registers the fallback notification RPC on the server. Call notify() once
 * per admitted fallback, or once per chosen compaction fallback.
 */
export declare function registerFallbackNotifications(ctx: Plugin.Context, options?: Pick<FallbackPluginConfig, "notify_on_fallback">): Promise<FallbackNotifications>;
