export declare function withLogContext<T>(context: Record<string, unknown>, callback: () => T): T;
export declare function logInfo(message: string, context?: Record<string, unknown>): void;
export declare function logError(message: string, context?: Record<string, unknown>): void;
export declare function getLogFilePath(): string;
