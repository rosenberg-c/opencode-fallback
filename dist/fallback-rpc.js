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
export {
  isFallbackNotificationData,
  fallbackRpc,
  describeFallback,
  FALLBACK_RPC_ID
};
