// @bun
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// constants.ts
var PLUGIN_NAME = "opencode-fallback", DEFAULT_CONFIG, RETRYABLE_ERROR_PATTERNS;
var init_constants = __esm(() => {
  DEFAULT_CONFIG = {
    enabled: true,
    retry_on_errors: [401, 402, 429, 500, 502, 503, 504],
    retryable_error_patterns: [],
    max_fallback_attempts: 10,
    cooldown_seconds: 60,
    timeout_seconds: 30,
    notify_on_fallback: true,
    fallback_models: [],
    foreground_task_fallback: true,
    compaction_fallback: false
  };
  RETRYABLE_ERROR_PATTERNS = [
    /rate.?limit/i,
    /too.?many.?requests/i,
    /quota.?exceeded/i,
    /quota.?protection/i,
    /key.?limit.?exceeded/i,
    /usage\s+limit\s+has\s+been\s+reached/i,
    /service.?unavailable/i,
    /overloaded/i,
    /temporarily.?unavailable/i,
    /try.?again/i,
    /credit.*balance.*too.*low/i,
    /insufficient.?(?:credits?|funds?|balance)/i,
    /(?:^|\s)429(?:\s|$)/,
    /(?:^|\s)503(?:\s|$)/,
    /(?:^|\s)529(?:\s|$)/
  ];
});

// logger.ts
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { AsyncLocalStorage } from "async_hooks";
function withLogContext(context, callback) {
  return logContext.run(context, callback);
}
function writeToFile(level, message, context) {
  const timestamp = new Date().toISOString();
  const combinedContext = { ...logContext.getStore(), ...context };
  const contextStr = Object.keys(combinedContext).length ? ` ${JSON.stringify(combinedContext)}` : "";
  const logLine = `[${timestamp}] [${level}] [${PLUGIN_NAME}] [pid=${process.pid}] ${message}${contextStr}
`;
  try {
    appendFileSync(LOG_FILE, logLine);
  } catch {}
}
function logInfo(message, context) {
  if (DEBUG_MODE) {
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    console.log(`[${PLUGIN_NAME}] ${message}${contextStr}`);
  }
  writeToFile("INFO", message, context);
}
function logError(message, context) {
  if (DEBUG_MODE) {
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    console.error(`[${PLUGIN_NAME}] ${message}${contextStr}`);
  }
  writeToFile("ERROR", message, context);
}
var logContext, LOG_FILE, DEBUG_MODE = false;
var init_logger = __esm(() => {
  init_constants();
  logContext = new AsyncLocalStorage;
  LOG_FILE = join(homedir(), ".config", "opencode", "opencode-fallback.log");
  try {
    mkdirSync(join(homedir(), ".config", "opencode"), { recursive: true });
  } catch {}
});

// fallback-rpc.ts
var FALLBACK_RPC_ID = "opencode-fallback";
var fallbackRpc = {
  id: FALLBACK_RPC_ID,
  methods: {},
  events: {
    notification: {
      schema: {
        type: "object",
        required: ["id", "directory", "sessionID", "from", "to", "kind"],
        properties: {
          id: { type: "string" },
          directory: { type: "string" },
          workspaceID: { type: "string" },
          sessionID: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          kind: { type: "string", enum: ["primary", "compaction"] }
        }
      }
    }
  }
};
function isFallbackNotificationData(value) {
  if (!value || typeof value !== "object")
    return false;
  const data = value;
  const strings = ["id", "directory", "sessionID", "from", "to"];
  return strings.every((key) => typeof data[key] === "string" && data[key] !== "") && (data.workspaceID === undefined || typeof data.workspaceID === "string") && (data.kind === "primary" || data.kind === "compaction");
}
function describeFallback(data) {
  return {
    title: data.kind === "compaction" ? "Compaction fallback" : "Model fallback",
    message: `${data.from} -> ${data.to}`
  };
}

// tui.ts
init_logger();
var TUI_DEFAULTS = { notify_toast: true, notify_desktop: false, notify_sound: false };
var STATE_KEY = "opencode-fallback:notifications";
var SEEN_LIMIT = 100;
function readTuiOptions(options) {
  const read = (key) => {
    const value = options[key];
    return typeof value === "boolean" ? value : TUI_DEFAULTS[key];
  };
  return { notify_toast: read("notify_toast"), notify_desktop: read("notify_desktop"), notify_sound: read("notify_sound") };
}
function present(context, options, data) {
  const { title, message } = describeFallback(data);
  if (options.notify_toast) {
    try {
      context.ui.toast.show({ title, message, variant: "warning", sessionID: data.sessionID });
      logInfo("V2 fallback TUI toast submitted", { sessionID: data.sessionID, title });
    } catch (error) {
      logError("V2 fallback TUI toast failed", { sessionID: data.sessionID, error: String(error) });
    }
  }
  if (options.notify_desktop || options.notify_sound) {
    const alert = async () => {
      await context.attention.notify({
        title,
        message,
        notification: options.notify_desktop ? { when: "blurred" } : false,
        sound: options.notify_sound ? { name: "default", when: "blurred" } : false
      });
    };
    alert().catch(() => {});
  }
}
var plugin = {
  id: "opencode-fallback",
  setup(context) {
    const options = readTuiOptions(context.options);
    logInfo("V2 fallback TUI initialized", { directory: (context.location ?? context.data.location.default()).directory, ...options });
    const [state, mutate] = context.storage.memory(STATE_KEY, { initial: { seen: [] } });
    const recent = new Map;
    const forget = (sessionID) => {
      const item = recent.get(sessionID);
      if (!item)
        return;
      clearTimeout(item.expiry);
      clearTimeout(item.restore);
      recent.delete(sessionID);
    };
    const stopFailures = context.data.on("session.execution.failed", (event) => {
      const item = recent.get(event.data.sessionID);
      if (!item)
        return;
      if (!Number.isFinite(event.created) || event.created > item.created) {
        forget(event.data.sessionID);
        return;
      }
      clearTimeout(item.restore);
      item.restore = setTimeout(() => {
        if (recent.get(event.data.sessionID) !== item)
          return;
        present(context, { ...options, notify_desktop: false, notify_sound: false }, item.data);
        logInfo("V2 fallback TUI toast restored after older failure", { sessionID: event.data.sessionID, failureCreated: event.created, notificationCreated: item.created });
      }, 0);
    });
    const unsubscribe = context.client.rpc(fallbackRpc).events.on("notification", async (event) => {
      try {
        const data = event.data;
        if (!isFallbackNotificationData(data))
          return;
        const here = context.location ?? context.data.location.default();
        const directory = event.location?.directory ?? data.directory;
        if (directory !== here.directory) {
          logInfo("V2 fallback TUI notification ignored for another directory", { sessionID: data.sessionID, directory, currentDirectory: here.directory });
          return;
        }
        const workspaceID = event.location?.workspaceID ?? data.workspaceID;
        if (typeof workspaceID === "string" && here.workspaceID && workspaceID !== here.workspaceID) {
          logInfo("V2 fallback TUI notification ignored for another workspace", { sessionID: data.sessionID, workspaceID, currentWorkspaceID: here.workspaceID });
          return;
        }
        if (state.seen.includes(data.id))
          return;
        mutate((draft) => {
          draft.seen.push(data.id);
          if (draft.seen.length > SEEN_LIMIT)
            draft.seen.splice(0, draft.seen.length - SEEN_LIMIT);
        });
        present(context, options, data);
        if (options.notify_toast && Number.isFinite(event.created)) {
          forget(data.sessionID);
          const item = { data, created: event.created, expiry: setTimeout(() => forget(data.sessionID), 5000) };
          recent.set(data.sessionID, item);
        }
        logInfo("V2 fallback TUI notification handled", { sessionID: data.sessionID, from: data.from, to: data.to, ...options });
      } catch (error) {
        logError("V2 fallback TUI notification failed", { error: String(error) });
      }
    });
    return () => {
      unsubscribe();
      stopFailures();
      for (const sessionID of recent.keys())
        forget(sessionID);
    };
  }
};
var tui_default = plugin;
export {
  readTuiOptions,
  tui_default as default
};
