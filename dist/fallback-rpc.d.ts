/**
 * Shared by the server plugin (ctx.rpc.register) and the TUI companion
 * (client.rpc(...).events.on). Keep this module free of server-only or
 * UI-only imports so both bundles can load it.
 *
 * Type-only import: the definition is a plain literal, so no runtime
 * dependency on the RPC schema package is pulled in.
 */
export declare const FALLBACK_RPC_ID = "opencode-fallback";
export type FallbackNotificationKind = "primary" | "compaction";
/** Event data. The server stamps `location` on RPC events; `directory` is a fallback. */
export type FallbackNotificationData = {
    /** Unique per emitted notification; used by the TUI to show each event once. */
    id: string;
    /** Project directory of the emitting plugin. */
    directory: string;
    workspaceID?: string;
    sessionID: string;
    from: string;
    to: string;
    kind: FallbackNotificationKind;
};
export declare const fallbackRpc: {
    readonly id: "opencode-fallback";
    readonly methods: {};
    readonly events: {
        readonly notification: {
            readonly schema: {
                readonly type: "object";
                readonly required: readonly ["id", "directory", "sessionID", "from", "to", "kind"];
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                    };
                    readonly directory: {
                        readonly type: "string";
                    };
                    readonly workspaceID: {
                        readonly type: "string";
                    };
                    readonly sessionID: {
                        readonly type: "string";
                    };
                    readonly from: {
                        readonly type: "string";
                    };
                    readonly to: {
                        readonly type: "string";
                    };
                    readonly kind: {
                        readonly type: "string";
                        readonly enum: readonly ["primary", "compaction"];
                    };
                };
            };
        };
    };
};
export declare function isFallbackNotificationData(value: unknown): value is FallbackNotificationData;
export declare function describeFallback(data: Pick<FallbackNotificationData, "from" | "to" | "kind">): {
    title: string;
    message: string;
};
