import type { Plugin } from "@opencode/plugin";
import type { FallbackPluginConfig } from "./types";
export declare const V2_RUNTIME: Readonly<{
    revision: "streaming-ttft-v3";
    moduleID: `${string}-${string}-${string}-${string}-${string}`;
    buildID: string;
}>;
/** Explicit plugin options override legacy fallback settings in OpenCode's agents. */
export interface V2FallbackConfig extends FallbackPluginConfig {
    agents?: Record<string, {
        fallback_models?: string | string[];
    }>;
}
type ModelRef = Parameters<Plugin.Context["session"]["switchModel"]>[0]["model"];
export declare function parseModelRef(value: string): ModelRef;
export declare function setupV2(ctx: Plugin.Context): Promise<(() => Promise<void>) | undefined>;
declare const _default: {
    server(ctx: import("./types").PluginContext, configOverrides?: Partial<FallbackPluginConfig> | undefined): Promise<{
        config: (opencodeConfig: Record<string, unknown>) => void;
        event: ({ event, }: {
            event: {
                type: string;
                properties?: unknown;
            };
        }) => Promise<void>;
        "tool.execute.after": (input: {
            tool: string;
            sessionID: string;
            callID: string;
            args: any;
        }, output: {
            title: string;
            output: string;
            metadata: any;
        }) => Promise<void>;
        "chat.message": (input: import("./types").ChatMessageInput, output: import("./types").ChatMessageOutput) => Promise<void>;
        tool?: {
            task: {
                description: string;
                args: {
                    description: import("zod").ZodString;
                    prompt: import("zod").ZodString;
                    subagent_type: import("zod").ZodString;
                    task_id: import("zod").ZodOptional<import("zod").ZodString>;
                    command: import("zod").ZodOptional<import("zod").ZodString>;
                    background: import("zod").ZodOptional<import("zod").ZodBoolean>;
                };
                execute(args: {
                    description: string;
                    prompt: string;
                    subagent_type: string;
                    task_id?: string;
                    command?: string;
                    background?: boolean;
                }, context: import("@opencode-ai/plugin").ToolContext): Promise<{
                    title: string;
                    output: string;
                    metadata: {
                        parentSessionId: string;
                        sessionId: string;
                        model: {
                            providerID: string;
                            modelID: string;
                        };
                    };
                }>;
            };
        } | undefined;
        name: string;
    }>;
    id: string;
    setup: (context: Plugin.Context) => Promise<Plugin.Cleanup | void> | Plugin.Cleanup | void;
};
export default _default;
