import type { PluginContext, FallbackPluginConfig, ChatMessageInput, ChatMessageOutput } from "./types";
export default function OpenCodeFallbackPlugin(ctx: PluginContext, configOverrides?: Partial<FallbackPluginConfig>): Promise<{
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
    "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>;
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
export declare function hasConcreteAssistantActivity(type: string, properties: unknown): boolean;
