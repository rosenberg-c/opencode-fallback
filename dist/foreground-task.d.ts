import { type ToolContext } from "@opencode-ai/plugin";
import type { HookDeps } from "./types";
type TaskArgs = {
    description: string;
    prompt: string;
    subagent_type: string;
    task_id?: string;
    command?: string;
    background?: boolean;
};
/** Owns the task promise, rather than trying to repair a native task after it
 * has thrown. Aborting a child prompt cannot settle this promise; only this
 * execution loop can return a result to the parent. */
export declare function createForegroundTask(deps: HookDeps): {
    tool: {
        description: string;
        args: {
            description: import("zod").ZodString;
            prompt: import("zod").ZodString;
            subagent_type: import("zod").ZodString;
            task_id: import("zod").ZodOptional<import("zod").ZodString>;
            command: import("zod").ZodOptional<import("zod").ZodString>;
            background: import("zod").ZodOptional<import("zod").ZodBoolean>;
        };
        execute(args: TaskArgs, context: ToolContext): Promise<{
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
    owns: (id: string) => boolean;
    configure(config: Record<string, unknown>): void;
    handleEvent(event: {
        type: string;
        properties?: unknown;
    }): boolean;
};
export {};
