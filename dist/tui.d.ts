import type { Plugin } from "@opencode/plugin/tui";
export interface FallbackTuiOptions {
    /** Show an in-app toast. Default: true. */
    notify_toast: boolean;
    /** Desktop notification, only while the terminal is blurred. Default: false. */
    notify_desktop: boolean;
    /** Sound alert, only while the terminal is blurred. Default: false. */
    notify_sound: boolean;
}
export declare function readTuiOptions(options: Readonly<Record<string, unknown>>): FallbackTuiOptions;
declare const plugin: Plugin.Definition;
export default plugin;
