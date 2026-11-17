import type { HookDeps } from "./types";
/** A delayed handler may release only the retry lock it acquired. */
export declare function acquireRetryLock(deps: HookDeps, sessionID: string): symbol;
export declare function releaseRetryLock(deps: HookDeps, sessionID: string, token: symbol | undefined): void;
