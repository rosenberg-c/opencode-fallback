import type { FallbackPluginConfig } from "./types";
export declare function loadPluginConfig<T extends FallbackPluginConfig = FallbackPluginConfig>(directory: string): Partial<T>;
