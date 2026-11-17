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

// config-reader.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mergeAgentConfigs(pluralAgents, singularAgent) {
  const plural = isRecord(pluralAgents) ? pluralAgents : {};
  const singular = isRecord(singularAgent) ? singularAgent : {};
  const names = new Set([...Object.keys(plural), ...Object.keys(singular)]);
  if (names.size === 0)
    return;
  const merged = {};
  for (const name of names) {
    const pluralConfig = isRecord(plural[name]) ? plural[name] : undefined;
    const singularConfig = isRecord(singular[name]) ? singular[name] : undefined;
    if (pluralConfig && singularConfig) {
      merged[name] = { ...pluralConfig, ...singularConfig };
    } else {
      merged[name] = singularConfig ?? pluralConfig ?? singular[name] ?? plural[name];
    }
  }
  return merged;
}
function normalizeFallbackModelsField(value) {
  if (!value)
    return [];
  if (typeof value === "string")
    return [value];
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }
  return [];
}
function readFallbackModels(agentName, agents) {
  if (!agents)
    return [];
  const agentConfig = agents[agentName];
  if (!isRecord(agentConfig))
    return [];
  return normalizeFallbackModelsField(agentConfig.fallback_models);
}
function resolveAgentForSession(sessionID, eventAgent) {
  if (eventAgent && eventAgent.trim().length > 0) {
    return eventAgent.trim().toLowerCase();
  }
  const segments = sessionID.split(/[\s_\-/]+/).filter(Boolean);
  for (const segment of segments) {
    const candidate = segment.toLowerCase();
    const isAlphaOnly = /^[a-z][a-z-]*$/.test(candidate);
    if (candidate.length > 2 && isAlphaOnly && !SESSION_ID_NOISE_WORDS.has(candidate)) {
      return candidate;
    }
  }
  return;
}
function getFallbackModelsForSession(sessionID, eventAgent, agents, globalFallbackModels) {
  const resolvedAgent = resolveAgentForSession(sessionID, eventAgent);
  const agentConfig = resolvedAgent && agents ? agents[resolvedAgent] : undefined;
  logInfo("Resolving session fallback configuration", {
    sessionID,
    eventAgent,
    resolvedAgent,
    agentFound: isRecord(agentConfig),
    configuredModel: isRecord(agentConfig) ? agentConfig.model : undefined,
    configuredFallbackModels: isRecord(agentConfig) ? agentConfig.fallback_models : undefined,
    globalFallbackModels
  });
  if (resolvedAgent && agents) {
    const models = readFallbackModels(resolvedAgent, agents);
    if (models.length > 0) {
      const agentConfig2 = agents[resolvedAgent];
      if (isRecord(agentConfig2) && typeof agentConfig2.model === "string") {
        const primaryModel = agentConfig2.model;
        if (!models.includes(primaryModel)) {
          models.unshift(primaryModel);
        }
      }
      return models;
    }
  }
  if (globalFallbackModels && globalFallbackModels.length > 0) {
    return globalFallbackModels;
  }
  return [];
}
var SESSION_ID_NOISE_WORDS;
var init_config_reader = __esm(() => {
  init_logger();
  SESSION_ID_NOISE_WORDS = new Set(["ses", "work", "task", "session"]);
});

// fallback-state.ts
function createFallbackState(originalModel) {
  return {
    originalModel,
    currentModel: originalModel,
    fallbackIndex: -1,
    failedModels: new Map,
    attemptCount: 0,
    pendingFallbackModel: undefined
  };
}
function isModelInCooldown(model, state, cooldownSeconds) {
  const failedAt = state.failedModels.get(model);
  if (failedAt === undefined)
    return false;
  const cooldownMs = cooldownSeconds * 1000;
  return Date.now() - failedAt < cooldownMs;
}
function findNextAvailableFallback(state, fallbackModels, cooldownSeconds, blockedProvider) {
  for (let i = state.fallbackIndex + 1;i < fallbackModels.length; i++) {
    const candidate = fallbackModels[i];
    if (candidate === state.currentModel) {
      logInfo(`Skipping fallback model identical to current: ${candidate} (index ${i})`);
      continue;
    }
    if (blockedProvider && candidate.split("/")[0] === blockedProvider) {
      logInfo(`Skipping fallback model on rate-limited provider: ${candidate}`);
      continue;
    }
    if (!isModelInCooldown(candidate, state, cooldownSeconds)) {
      return candidate;
    }
    logInfo(`Skipping fallback model in cooldown: ${candidate} (index ${i})`);
  }
  return;
}
function applyFallbackPlan(state, plan, pendingFallbackModel) {
  state.fallbackIndex = plan.newFallbackIndex;
  state.failedModels.set(plan.failedModel, Date.now());
  state.attemptCount++;
  state.currentModel = plan.newModel;
  state.pendingFallbackModel = pendingFallbackModel;
}
function planFallback(sessionID, state, fallbackModels, config, blockedProvider) {
  if (state.attemptCount >= config.max_fallback_attempts) {
    logInfo(`Max fallback attempts reached for session ${sessionID} (${state.attemptCount})`);
    return {
      success: false,
      error: "Max fallback attempts reached",
      maxAttemptsReached: true
    };
  }
  const nextModel = findNextAvailableFallback(state, fallbackModels, config.cooldown_seconds, blockedProvider);
  if (!nextModel) {
    logInfo(`No available fallback models for session ${sessionID}`);
    return {
      success: false,
      error: "No available fallback models (all in cooldown or exhausted)"
    };
  }
  logInfo(`Planned fallback for session ${sessionID}: ${state.currentModel} -> ${nextModel} (will be attempt ${state.attemptCount + 1})`);
  return {
    success: true,
    newModel: nextModel,
    failedModel: state.currentModel,
    newFallbackIndex: fallbackModels.indexOf(nextModel)
  };
}
function commitFallback(state, plan) {
  if (state.currentModel !== plan.failedModel) {
    return false;
  }
  applyFallbackPlan(state, plan);
  return true;
}
function recoverToOriginal(state, cooldownSeconds) {
  if (state.currentModel === state.originalModel)
    return false;
  if (isModelInCooldown(state.originalModel, state, cooldownSeconds))
    return false;
  state.currentModel = state.originalModel;
  state.fallbackIndex = -1;
  state.attemptCount = 0;
  state.pendingFallbackModel = undefined;
  return true;
}
var init_fallback_state = __esm(() => {
  init_logger();
});

// retry-lock.ts
function acquireRetryLock(deps, sessionID) {
  const token = Symbol(sessionID);
  const owners = deps.sessionRetryLockTokens ??= new Map;
  owners.set(sessionID, token);
  deps.sessionRetryInFlight.add(sessionID);
  return token;
}
function releaseRetryLock(deps, sessionID, token) {
  if (deps.sessionRetryLockTokens?.get(sessionID) !== token)
    return;
  deps.sessionRetryLockTokens?.delete(sessionID);
  deps.sessionRetryInFlight.delete(sessionID);
}

// message-replay.ts
function filterPartsByTier(parts, tier) {
  switch (tier) {
    case 1:
      return parts;
    case 2:
      return parts.filter((p) => TIER_2_TYPES.has(p.type));
    case 3:
      return parts.filter((p) => p.type === "text");
  }
}
async function replayWithDegradation(allParts, sendFn) {
  if (allParts.length === 0) {
    return { success: false, error: "No parts to replay" };
  }
  const tiers = [1, 2, 3];
  let lastError;
  let previousLength = -1;
  for (const tier of tiers) {
    const filtered = filterPartsByTier(allParts, tier);
    if (filtered.length === 0)
      continue;
    if (filtered.length === previousLength)
      continue;
    previousLength = filtered.length;
    try {
      await sendFn(filtered);
      const sentTypes = new Set(filtered.map((p) => p.type));
      const allTypes = new Set(allParts.map((p) => p.type));
      const droppedTypes = [...allTypes].filter((t) => !sentTypes.has(t));
      return {
        success: true,
        tier,
        sentParts: filtered,
        droppedTypes
      };
    } catch (err) {
      lastError = err;
    }
  }
  return {
    success: false,
    error: lastError instanceof Error ? lastError.message : String(lastError)
  };
}
var TIER_2_TYPES;
var init_message_replay = __esm(() => {
  TIER_2_TYPES = new Set(["text", "image"]);
});

// continuation-prompt.ts
var FALLBACK_CONTINUATION_PROMPT = "Continue the existing task from where it stopped. Follow the original instructions and constraints, use completed tool results, and do not repeat completed work.";

// auto-retry.ts
function summarizeParts(parts) {
  if (!parts || parts.length === 0) {
    return { count: 0, types: [], textChars: 0, hasToolCall: false };
  }
  const typeSet = new Set;
  let textChars = 0;
  let hasToolCall = false;
  for (const part of parts) {
    typeSet.add(part.type);
    const textValue = part.text;
    if (part.type === "text" && typeof textValue === "string") {
      textChars += textValue.length;
    }
    if (part.type === "tool_call") {
      hasToolCall = true;
    }
  }
  return {
    count: parts.length,
    types: Array.from(typeSet),
    textChars,
    hasToolCall
  };
}
function createAutoRetryHelpers(deps) {
  const {
    ctx,
    config,
    sessionStates,
    sessionLastAccess,
    sessionRetryInFlight,
    sessionAwaitingFallbackResult,
    sessionFallbackTimeouts
  } = deps;
  const childFallbackBridges = new Map;
  const compactionDispatchOwners = new Map;
  let nextCompactionDispatchGeneration = 0;
  const sessionDispatchModels = deps.sessionDispatchModels ??= new Map;
  const ownsCompactionDispatch = (sessionID, owner) => Boolean(owner && compactionDispatchOwners.get(sessionID) === owner);
  const clearCompactionDispatch = (sessionID, owner) => {
    if (!ownsCompactionDispatch(sessionID, owner))
      return false;
    compactionDispatchOwners.delete(sessionID);
    deps.sessionCompactionInFlight.delete(sessionID);
    return true;
  };
  const registerChildFallbackBridge = (childID, parentID) => {
    if (childFallbackBridges.has(childID))
      return;
    childFallbackBridges.set(childID, {
      parentID,
      startedAt: Date.now(),
      claimedByToolHook: false
    });
    logInfo("Registered child fallback bridge", { childSession: childID, parentSession: parentID });
  };
  const clearChildFallbackBridge = (childID) => {
    const bridge = childFallbackBridges.get(childID);
    if (!bridge)
      return;
    childFallbackBridges.delete(childID);
    logInfo("Cleared child fallback bridge", { childSession: childID, parentSession: bridge.parentID });
  };
  const claimChildFallbackBridge = (childID, parentID) => {
    const bridge = childFallbackBridges.get(childID);
    if (!bridge || bridge.parentID !== parentID)
      return;
    bridge.claimedByToolHook = true;
    return bridge.startedAt;
  };
  const getParentSessionID = async (sessionID) => {
    const cached = deps.sessionParentID.get(sessionID);
    if (cached !== undefined)
      return cached;
    try {
      const sessionInfo = await ctx.client.session.get({ path: { id: sessionID } });
      const sessionData = sessionInfo?.data ?? sessionInfo;
      const parentID = typeof sessionData?.parentID === "string" && sessionData.parentID.length > 0 ? sessionData.parentID : null;
      deps.sessionParentID.set(sessionID, parentID);
      if (parentID) {
        logInfo("Detected child session", { sessionID, parentID });
      }
      return parentID;
    } catch {
      logError("Failed to look up parentID", { sessionID });
      return null;
    }
  };
  const abortSessionRequest = async (sessionID, source) => {
    try {
      await ctx.client.session.abort({ path: { id: sessionID } });
      deps.sessionSelfAbortTimestamp.set(sessionID, Date.now());
      logInfo(`Aborted in-flight session request (${source})`, { sessionID });
    } catch (error) {
      logError(`Failed to abort in-flight session request (${source})`, {
        sessionID,
        error: String(error)
      });
    }
  };
  const clearSessionFallbackTimeout = (sessionID) => {
    const timer = sessionFallbackTimeouts.get(sessionID);
    if (timer) {
      clearTimeout(timer);
      sessionFallbackTimeouts.delete(sessionID);
    }
  };
  const scheduleSessionFallbackTimeout = (sessionID, resolvedAgent, compactionOwner) => {
    clearSessionFallbackTimeout(sessionID);
    const timeoutMs = config.timeout_seconds * 1000;
    if (timeoutMs <= 0)
      return;
    const timer = setTimeout(async () => {
      if (sessionFallbackTimeouts.get(sessionID) !== timer)
        return;
      if (compactionOwner && !ownsCompactionDispatch(sessionID, compactionOwner))
        return;
      sessionFallbackTimeouts.delete(sessionID);
      if (compactionOwner && !deps.sessionCompactionInFlight.has(sessionID))
        return;
      if (deps.sessionFirstTokenReceived.get(sessionID)) {
        logInfo("Timeout fired but first token already received, skipping abort", {
          sessionID
        });
        return;
      }
      const state = sessionStates.get(sessionID);
      if (!state)
        return;
      if (sessionRetryInFlight.has(sessionID)) {
        logInfo("Timeout fired but retry already in flight, deferring", { sessionID });
        return;
      }
      if (compactionOwner) {
        clearCompactionDispatch(sessionID, compactionOwner);
        sessionAwaitingFallbackResult.delete(sessionID);
      } else {
        deps.sessionCompactionInFlight.delete(sessionID);
      }
      await abortSessionRequest(sessionID, "session.timeout");
      if (state.pendingFallbackModel) {
        state.pendingFallbackModel = undefined;
      }
      const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, deps.agentConfigs, deps.globalFallbackModels);
      if (fallbackModels.length === 0)
        return;
      if (sessionRetryInFlight.has(sessionID)) {
        logInfo("Timeout recovery yielded to a retry started during abort", { sessionID });
        return;
      }
      logInfo("Session fallback timeout reached", {
        sessionID,
        timeoutSeconds: config.timeout_seconds,
        currentModel: state.currentModel
      });
      const retryLockToken = acquireRetryLock(deps, sessionID);
      try {
        const plan = planFallback(sessionID, state, fallbackModels, config);
        if (plan.success) {
          await autoRetryWithFallback(sessionID, plan.newModel, resolvedAgent, "session.timeout", plan);
        }
      } finally {
        releaseRetryLock(deps, sessionID, retryLockToken);
      }
    }, timeoutMs);
    sessionFallbackTimeouts.set(sessionID, timer);
  };
  const autoRetryWithFallback = async (sessionID, newModel, resolvedAgent, source, plan) => {
    let deferredToOtherHandler = false;
    let compactionOwner;
    let normalDispatchModel;
    const retryLockToken = deps.sessionRetryLockTokens?.get(sessionID);
    const preCheckState = sessionStates.get(sessionID);
    if (plan) {
      if (preCheckState && preCheckState.currentModel !== plan.failedModel) {
        logInfo(`Skipping stale autoRetryWithFallback (${source}): state already at ${preCheckState.currentModel}, expected failed model ${plan.failedModel}`, {
          sessionID,
          staleModel: newModel,
          currentModel: preCheckState.currentModel
        });
        deferredToOtherHandler = true;
        return false;
      }
    } else if (preCheckState && preCheckState.currentModel !== newModel) {
      logInfo(`Skipping stale autoRetryWithFallback (${source}): state already at ${preCheckState.currentModel}, wanted ${newModel}`, {
        sessionID,
        staleModel: newModel,
        currentModel: preCheckState.currentModel
      });
      deferredToOtherHandler = true;
      return false;
    }
    const modelParts = newModel.split("/");
    if (modelParts.length < 2) {
      logInfo(`Invalid model format (missing provider prefix): ${newModel}`);
      const state = sessionStates.get(sessionID);
      if (state?.pendingFallbackModel) {
        state.pendingFallbackModel = undefined;
      }
      return false;
    }
    const fallbackModelObj = {
      providerID: modelParts[0],
      modelID: modelParts.slice(1).join("/")
    };
    if (resolvedAgent === "compaction") {
      if (deps.sessionCompactionInFlight.has(sessionID)) {
        logInfo(`Skipping duplicate compaction fallback (${source})`, { sessionID });
        deferredToOtherHandler = true;
        return false;
      }
      deps.sessionCompactionInFlight.add(sessionID);
      compactionOwner = { generation: ++nextCompactionDispatchGeneration, model: newModel };
      compactionDispatchOwners.set(sessionID, compactionOwner);
    }
    if (resolvedAgent === "compaction") {
      const compactionConfig = deps.agentConfigs?.compaction;
      const pinnedModel = typeof compactionConfig === "object" && compactionConfig !== null && typeof compactionConfig.model === "string" ? compactionConfig.model : undefined;
      const pinnedModelInCooldown = Boolean(pinnedModel && pinnedModel === newModel && preCheckState && isModelInCooldown(pinnedModel, preCheckState, config.cooldown_seconds));
      if (pinnedModel && (pinnedModel !== newModel || pinnedModelInCooldown)) {
        clearCompactionDispatch(sessionID, compactionOwner);
        if (sessionAwaitingFallbackResult.has(sessionID)) {
          logInfo(`Skipping pinned compaction fallback (${source}); another handler owns the result`, {
            sessionID,
            pinnedModel,
            requestedModel: newModel
          });
          deferredToOtherHandler = true;
          return false;
        }
        const reason = pinnedModelInCooldown ? `Pinned compaction model ${pinnedModel} is still in fallback cooldown.` : `Compaction is pinned to ${pinnedModel}, so it cannot switch to ${newModel}.`;
        const action = pinnedModelInCooldown ? "Wait for the fallback cooldown or unset agent.compaction.model." : "Unset agent.compaction.model to allow switching compaction models.";
        logError(reason, {
          sessionID,
          pinnedModel,
          requestedModel: newModel,
          action
        });
        if (preCheckState)
          preCheckState.pendingFallbackModel = undefined;
        sessionAwaitingFallbackResult.delete(sessionID);
        clearSessionFallbackTimeout(sessionID);
        if (config.notify_on_fallback) {
          await ctx.client.tui.showToast({
            body: {
              title: "Compaction Fallback Blocked",
              message: `${reason} ${action}`,
              variant: "warning",
              duration: 1e4
            }
          }).catch(() => {});
        }
        return false;
      }
    }
    const modelAlreadyStopped = source === "session.error" || source === "message.updated" || source === "task.empty-result";
    const callerAlreadyAborted = source === "session.timeout";
    const mayHaveRecentAbort = source === "session.idle.silent-failure";
    const childParentID = await getParentSessionID(sessionID);
    if (childParentID)
      registerChildFallbackBridge(sessionID, childParentID);
    if (modelAlreadyStopped) {
      logInfo(`Skipping abort \u2014 model already stopped (${source}), waiting for session to settle`, {
        sessionID,
        newModel
      });
      await new Promise((resolve) => setTimeout(() => resolve(), POST_ABORT_DELAY_MS));
    } else if (callerAlreadyAborted || mayHaveRecentAbort) {
      const selfAbortTs = deps.sessionSelfAbortTimestamp.get(sessionID);
      const msSinceAbort = selfAbortTs ? Date.now() - selfAbortTs : undefined;
      if (selfAbortTs && msSinceAbort !== undefined && msSinceAbort < POST_ABORT_DELAY_MS * 2) {
        logInfo(`Waiting for recent abort propagation (${source})`, {
          sessionID,
          msSinceAbort
        });
        const remainingMs = Math.max(0, POST_ABORT_DELAY_MS - msSinceAbort);
        if (remainingMs > 0) {
          await new Promise((resolve) => setTimeout(() => resolve(), remainingMs));
        }
      } else if (callerAlreadyAborted) {
        logInfo(`Caller already aborted (${source}), waiting for propagation`, {
          sessionID
        });
        await new Promise((resolve) => setTimeout(() => resolve(), POST_ABORT_DELAY_MS));
      }
    } else {
      await abortSessionRequest(sessionID, `pre-fallback.${source}`);
      await new Promise((resolve) => setTimeout(() => resolve(), POST_ABORT_DELAY_MS));
    }
    deps.sessionFirstTokenReceived.set(sessionID, false);
    let retryDispatched = false;
    try {
      if (resolvedAgent === "compaction") {
        const failedModel = plan?.failedModel;
        logInfo(`Compaction fallback: abort + summarize on fallback (${source})`, {
          sessionID,
          failedModel,
          newModel
        });
        if (failedModel && plan) {
          const currentState = sessionStates.get(sessionID);
          if (currentState) {
            if (!currentState.failedModels.has(failedModel)) {
              currentState.failedModels.set(failedModel, Date.now());
            }
          }
        }
        try {
          await abortSessionRequest(sessionID, "compaction-fallback");
        } catch {
          logError(`Failed to abort session for compaction fallback (${source})`, { sessionID });
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          const messagesResp2 = await ctx.client.session.messages({
            path: { id: sessionID },
            query: { directory: ctx.directory }
          });
          const msgs2 = messagesResp2.data ?? [];
          const deleteIDs = [];
          for (let i = msgs2.length - 1;i >= 0; i--) {
            const msg = msgs2[i];
            const msgRole = msg.info?.role;
            const msgError = msg.info?.error;
            const msgID = msg.info?.id;
            const parts = msg.parts ?? [];
            const isCompactionMsg = parts.length > 0 && parts.every((p) => p.type === "compaction");
            if (!msgID)
              continue;
            if (msgRole === "assistant" && msgError) {
              deleteIDs.push(msgID);
              continue;
            }
            if (isCompactionMsg) {
              deleteIDs.push(msgID);
              break;
            }
          }
          const rawClient = ctx.client.session?._client;
          if (rawClient && deleteIDs.length > 0) {
            for (const msgID of deleteIDs) {
              logInfo(`Deleting compaction message (${source})`, {
                sessionID,
                messageID: msgID
              });
              try {
                await rawClient.delete({
                  url: "/session/{id}/message/{messageID}",
                  path: { id: sessionID, messageID: msgID }
                });
                logInfo(`Deleted compaction message (${source})`, {
                  sessionID,
                  messageID: msgID
                });
              } catch (delErr) {
                logError(`Failed to delete compaction message (${source})`, {
                  sessionID,
                  messageID: msgID,
                  error: String(delErr)
                });
              }
            }
          } else if (deleteIDs.length > 0) {
            logError(`Cannot access raw SDK client for message deletion (${source})`, {
              sessionID,
              messageCount: deleteIDs.length
            });
          }
        } catch (msgErr) {
          logError(`Failed during compaction message cleanup (${source})`, {
            sessionID,
            error: String(msgErr)
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (!deps.sessionCompactionInFlight.has(sessionID)) {
          logInfo(`Compaction already completed while preparing fallback (${source})`, {
            sessionID,
            failedModel,
            newModel
          });
          return false;
        }
        const handleSummarizeFailure = async (summarizeErr) => {
          if (!ownsCompactionDispatch(sessionID, compactionOwner))
            return;
          logError(`session.summarize failed (${source})`, {
            sessionID,
            model: newModel,
            error: String(summarizeErr)
          });
          sessionAwaitingFallbackResult.delete(sessionID);
          if (plan) {
            const currentState = sessionStates.get(sessionID);
            if (currentState && commitFallback(currentState, plan)) {
              logInfo(`Committed compaction fallback state as last resort (${source})`, {
                sessionID,
                from: plan.failedModel,
                to: plan.newModel
              });
            }
          }
          clearCompactionDispatch(sessionID, compactionOwner);
          clearSessionFallbackTimeout(sessionID);
          sessionAwaitingFallbackResult.delete(sessionID);
          if (config.notify_on_fallback) {
            const fromName = (failedModel || "primary").split("/").pop();
            const toName = newModel.split("/").pop() || newModel;
            await ctx.client.tui.showToast({
              body: {
                title: "Compaction Failed",
                message: `${fromName} can't compact \u2014 try /compact after switching to ${toName}`,
                variant: "warning",
                duration: 1e4
              }
            }).catch(() => {});
          }
        };
        try {
          if (sessionAwaitingFallbackResult.has(sessionID)) {
            logInfo(`Skipping duplicate compaction summarize (${source})`, { sessionID });
            clearCompactionDispatch(sessionID, compactionOwner);
            deferredToOtherHandler = true;
            return false;
          }
          sessionAwaitingFallbackResult.add(sessionID);
          logInfo(`Dispatching session.summarize on fallback model (${source})`, {
            sessionID,
            providerID: fallbackModelObj.providerID,
            modelID: fallbackModelObj.modelID
          });
          if (plan) {
            const stateToCommit = sessionStates.get(sessionID);
            if (stateToCommit && !commitFallback(stateToCommit, plan)) {
              logInfo(`Compaction fallback state advanced before dispatch (${source})`, {
                sessionID,
                from: plan.failedModel,
                to: plan.newModel,
                currentModel: stateToCommit.currentModel
              });
              deferredToOtherHandler = true;
              await abortSessionRequest(sessionID, `stale-compaction.${source}`);
              return false;
            }
            if (stateToCommit) {
              logInfo(`Committed fallback at compaction dispatch (${source})`, {
                sessionID,
                from: plan.failedModel,
                to: plan.newModel,
                attemptCount: stateToCommit.attemptCount
              });
            }
          }
          const summarizePromise = ctx.client.session.summarize({
            path: { id: sessionID },
            body: {
              providerID: fallbackModelObj.providerID,
              modelID: fallbackModelObj.modelID
            },
            query: { directory: ctx.directory }
          });
          retryDispatched = true;
          if (ownsCompactionDispatch(sessionID, compactionOwner) && deps.sessionCompactionInFlight.has(sessionID) && sessionAwaitingFallbackResult.has(sessionID) && !deps.sessionFirstTokenReceived.get(sessionID)) {
            scheduleSessionFallbackTimeout(sessionID, resolvedAgent, compactionOwner);
          }
          releaseRetryLock(deps, sessionID, retryLockToken);
          const summarizeResult = await summarizePromise;
          if (!ownsCompactionDispatch(sessionID, compactionOwner)) {
            deferredToOtherHandler = true;
            return true;
          }
          if (!deps.sessionCompactionInFlight.has(sessionID) || !sessionAwaitingFallbackResult.has(sessionID)) {
            clearCompactionDispatch(sessionID, compactionOwner);
            deferredToOtherHandler = true;
            return true;
          }
          logInfo(`session.summarize response (${source})`, {
            sessionID,
            model: newModel,
            response: (JSON.stringify(summarizeResult) ?? "undefined").slice(0, 500)
          });
          const summarizeError = summarizeResult?.error;
          if (summarizeError) {
            throw new Error(`session.summarize returned an error: ${JSON.stringify(summarizeError).slice(0, 300)}`);
          }
          if (config.notify_on_fallback) {
            const fromName = (failedModel || "primary").split("/").pop();
            const toName = newModel.split("/").pop() || newModel;
            await ctx.client.tui.showToast({
              body: {
                title: "Compaction Fallback",
                message: `${fromName} failed \u2014 retrying compaction on ${toName}`,
                variant: "warning",
                duration: 5000
              }
            }).catch(() => {});
          }
          logInfo(`Compaction re-dispatched via summarize (${source})`, {
            sessionID,
            model: newModel
          });
          return true;
        } catch (summarizeErr) {
          await handleSummarizeFailure(summarizeErr);
          deferredToOtherHandler = true;
          return false;
        }
      }
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory }
      });
      const msgs = messagesResp.data;
      if (!msgs || msgs.length === 0) {
        logError(`No messages found in session for auto-retry (${source})`, { sessionID });
      }
      let lastUserPartsRaw;
      let lastNonAssistantPartsRaw;
      for (let i = (msgs?.length ?? 0) - 1;i >= 0; i--) {
        const m = msgs?.[i];
        const role = (m?.info?.role ?? m?.role ?? "").toLowerCase();
        const parts = m?.parts ?? m?.info?.parts;
        if (!parts || parts.length === 0)
          continue;
        const hasOnlyCompactionParts = parts.every((p) => p.type === "compaction");
        if (hasOnlyCompactionParts)
          continue;
        if (!lastNonAssistantPartsRaw && role !== "assistant") {
          lastNonAssistantPartsRaw = parts;
        }
        if (role === "user") {
          lastUserPartsRaw = parts;
          break;
        }
      }
      const replayPartsRaw = lastUserPartsRaw ?? lastNonAssistantPartsRaw;
      const replaySource = lastUserPartsRaw ? "last-user" : lastNonAssistantPartsRaw ? "last-non-assistant" : "none";
      if (replayPartsRaw && replayPartsRaw.length > 0) {
        const postCheckState = sessionStates.get(sessionID);
        const expectedCurrentModel = plan ? plan.failedModel : newModel;
        if (postCheckState && postCheckState.currentModel !== expectedCurrentModel) {
          logInfo(`Skipping stale autoRetryWithFallback (${source}): state already at ${postCheckState.currentModel}, expected failed model ${expectedCurrentModel}`, {
            sessionID,
            staleModel: newModel,
            currentModel: postCheckState.currentModel
          });
          deferredToOtherHandler = true;
          return false;
        }
        if (sessionAwaitingFallbackResult.has(sessionID)) {
          logInfo(`Skipping duplicate fallback dispatch \u2014 another handler already dispatched (${source})`, {
            sessionID,
            model: newModel
          });
          deferredToOtherHandler = true;
          return false;
        }
        sessionAwaitingFallbackResult.add(sessionID);
        logInfo(`Auto-retrying with fallback model (${source})`, {
          sessionID,
          model: newModel,
          agent: resolvedAgent,
          replaySource
        });
        const allParts = replayPartsRaw.filter((p) => typeof p.type === "string" && p.type !== "compaction");
        const continuationParts = [
          { type: "text", text: FALLBACK_CONTINUATION_PROMPT }
        ];
        logInfo(`Prepared replay payload (${source})`, {
          sessionID,
          model: newModel,
          agent: resolvedAgent,
          replaySource,
          payload: summarizeParts(continuationParts)
        });
        if (allParts.length > 0) {
          const sendFn = async (parts) => {
            logInfo(`Dispatching fallback replay (${source})`, {
              sessionID,
              model: newModel,
              agent: resolvedAgent,
              payload: summarizeParts(parts)
            });
            const prompt = childParentID ? ctx.client.session.prompt ?? ctx.client.session.promptAsync : ctx.client.session.promptAsync;
            normalDispatchModel = newModel;
            sessionDispatchModels?.set(sessionID, newModel);
            await prompt.call(ctx.client.session, {
              path: { id: sessionID },
              body: {
                ...resolvedAgent ? { agent: resolvedAgent } : {},
                model: fallbackModelObj,
                parts
              },
              query: { directory: ctx.directory }
            });
            logInfo(`Fallback replay accepted by host (${source})`, {
              sessionID,
              model: newModel,
              agent: resolvedAgent
            });
          };
          const replayResult = await replayWithDegradation(continuationParts, sendFn);
          if (replayResult.success) {
            let commitSucceeded = true;
            if (plan) {
              const stateToCommit = sessionStates.get(sessionID);
              if (stateToCommit) {
                const committed = commitFallback(stateToCommit, plan);
                if (committed) {
                  logInfo(`Committed fallback state after successful dispatch (${source})`, {
                    sessionID,
                    newModel: plan.newModel,
                    failedModel: plan.failedModel,
                    attemptCount: stateToCommit.attemptCount
                  });
                } else {
                  logInfo(`Fallback state already committed by another handler \u2014 aborting duplicate replay (${source})`, {
                    sessionID,
                    newModel: plan.newModel
                  });
                  commitSucceeded = false;
                  await abortSessionRequest(sessionID, `duplicate-replay.${source}`);
                }
              }
            }
            if (!commitSucceeded) {
              deferredToOtherHandler = true;
              return false;
            }
            if (sessionDispatchModels?.get(sessionID) === newModel) {
              sessionDispatchModels.delete(sessionID);
            }
            normalDispatchModel = undefined;
            if (deps.sessionFirstTokenReceived.get(sessionID)) {
              const state = sessionStates.get(sessionID);
              if (state?.pendingFallbackModel === newModel)
                state.pendingFallbackModel = undefined;
              sessionAwaitingFallbackResult.delete(sessionID);
              clearSessionFallbackTimeout(sessionID);
            } else if (sessionAwaitingFallbackResult.has(sessionID)) {
              scheduleSessionFallbackTimeout(sessionID, resolvedAgent);
            }
            retryDispatched = true;
            logInfo(`Fallback replay succeeded (${source})`, {
              sessionID,
              tier: replayResult.tier,
              sentPartsCount: replayResult.sentParts?.length,
              droppedTypes: replayResult.droppedTypes,
              replaySource
            });
            if (replayResult.droppedTypes && replayResult.droppedTypes.length > 0) {
              const droppedStr = replayResult.droppedTypes.join(", ");
              await ctx.client.tui.showToast({
                body: {
                  title: "Message Replay",
                  message: `Some message parts were dropped for compatibility: ${droppedStr}`,
                  variant: "warning",
                  duration: 5000
                }
              }).catch(() => {});
            }
          } else {
            logError(`All replay tiers failed (${source})`, {
              sessionID,
              error: replayResult.error
            });
          }
        }
      } else {
        logInfo(`No replayable non-assistant message found for auto-retry (${source})`, {
          sessionID,
          model: newModel,
          agent: resolvedAgent
        });
      }
    } catch (retryError) {
      const ownsCurrentDispatch = compactionOwner ? ownsCompactionDispatch(sessionID, compactionOwner) : !sessionDispatchModels?.has(sessionID) || sessionDispatchModels.get(sessionID) === normalDispatchModel;
      if (!ownsCurrentDispatch) {
        deferredToOtherHandler = true;
        return false;
      }
      logError(`Auto-retry failed (${source})`, {
        sessionID,
        error: String(retryError)
      });
      sessionAwaitingFallbackResult.delete(sessionID);
      if (compactionOwner)
        clearCompactionDispatch(sessionID, compactionOwner);
      clearSessionFallbackTimeout(sessionID);
    } finally {
      if (normalDispatchModel && sessionDispatchModels?.get(sessionID) === normalDispatchModel) {
        sessionDispatchModels.delete(sessionID);
      }
      const ownsCurrentDispatch = compactionOwner ? ownsCompactionDispatch(sessionID, compactionOwner) : !sessionDispatchModels?.has(sessionID) || sessionDispatchModels.get(sessionID) === normalDispatchModel;
      if (!retryDispatched && !deferredToOtherHandler && ownsCurrentDispatch) {
        sessionAwaitingFallbackResult.delete(sessionID);
        if (compactionOwner)
          clearCompactionDispatch(sessionID, compactionOwner);
        deps.sessionProviderRetrying?.delete(sessionID);
        clearSessionFallbackTimeout(sessionID);
        const state = sessionStates.get(sessionID);
        if (state?.pendingFallbackModel) {
          state.pendingFallbackModel = undefined;
        }
      }
      if (childParentID && !retryDispatched) {
        clearChildFallbackBridge(sessionID);
      }
    }
    return retryDispatched;
  };
  const retryEmptyChildTask = async (sessionID, eventAgent) => {
    const state = sessionStates.get(sessionID);
    if (!state || sessionRetryInFlight.has(sessionID) || sessionAwaitingFallbackResult.has(sessionID)) {
      return false;
    }
    const resolvedAgent = resolveAgentForSession(sessionID, eventAgent);
    const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, deps.agentConfigs, deps.globalFallbackModels);
    const plan = planFallback(sessionID, state, fallbackModels, config);
    if (!plan.success)
      return false;
    const retryLockToken = acquireRetryLock(deps, sessionID);
    try {
      return await autoRetryWithFallback(sessionID, plan.newModel, resolvedAgent, "task.empty-result", plan);
    } finally {
      releaseRetryLock(deps, sessionID, retryLockToken);
    }
  };
  const resolveAgentForSessionFromContext = async (sessionID, eventAgent) => {
    const resolved = resolveAgentForSession(sessionID, eventAgent);
    if (resolved)
      return resolved;
    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory }
      });
      const msgs = messagesResp.data;
      if (!msgs || msgs.length === 0)
        return;
      for (let i = msgs.length - 1;i >= 0; i--) {
        const info = msgs[i]?.info;
        const infoAgent = typeof info?.agent === "string" ? info.agent : undefined;
        if (infoAgent && infoAgent.trim().length > 0) {
          return infoAgent.trim().toLowerCase();
        }
      }
    } catch {
      logError("Failed to resolve agent from messages", { sessionID });
    }
    try {
      const sessionInfo = await ctx.client.session.get({ path: { id: sessionID } });
      const sessionData = sessionInfo?.data ?? sessionInfo;
      const sdkAgent = typeof sessionData?.agent === "string" ? sessionData.agent : undefined;
      if (sdkAgent && sdkAgent.trim().length > 0) {
        const normalized = sdkAgent.trim().toLowerCase();
        logInfo("Resolved agent from session.get", { sessionID, agent: normalized });
        return normalized;
      }
    } catch {
      logError("Failed to resolve agent from session.get", { sessionID });
    }
    return;
  };
  const cleanupStaleSessions = () => {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [sessionID, lastAccess] of sessionLastAccess.entries()) {
      if (now - lastAccess > SESSION_TTL_MS) {
        clearChildFallbackBridge(sessionID);
        sessionStates.delete(sessionID);
        sessionLastAccess.delete(sessionID);
        sessionRetryInFlight.delete(sessionID);
        deps.sessionRetryLockTokens?.delete(sessionID);
        sessionAwaitingFallbackResult.delete(sessionID);
        deps.sessionFirstTokenReceived.delete(sessionID);
        deps.sessionRequestMessages?.delete(sessionID);
        deps.sessionActiveRequests?.delete(sessionID);
        sessionDispatchModels.delete(sessionID);
        compactionDispatchOwners.delete(sessionID);
        deps.sessionSelfAbortTimestamp.delete(sessionID);
        deps.sessionParentID.delete(sessionID);
        deps.sessionIdleResolvers.delete(sessionID);
        deps.sessionLastMessageTime.delete(sessionID);
        deps.sessionCompactionInFlight.delete(sessionID);
        clearSessionFallbackTimeout(sessionID);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      logInfo(`Cleaned up ${cleanedCount} stale session states`);
    }
  };
  return {
    getParentSessionID,
    abortSessionRequest,
    clearSessionFallbackTimeout,
    scheduleSessionFallbackTimeout,
    autoRetryWithFallback,
    retryEmptyChildTask,
    claimChildFallbackBridge,
    clearChildFallbackBridge,
    resolveAgentForSessionFromContext,
    cleanupStaleSessions
  };
}
var SESSION_TTL_MS, POST_ABORT_DELAY_MS = 150;
var init_auto_retry = __esm(() => {
  init_logger();
  init_config_reader();
  init_fallback_state();
  init_message_replay();
  SESSION_TTL_MS = 30 * 60 * 1000;
});

// error-classifier.ts
function getObjectRecord(value) {
  return value && typeof value === "object" ? value : undefined;
}
function normalizeMessage(value) {
  return value.trim().length === 0 ? "" : value.toLowerCase();
}
function getErrorMessage(error) {
  if (!error)
    return "";
  if (typeof error === "string")
    return normalizeMessage(error);
  const errorObj = error;
  const paths = [
    errorObj.data?.error,
    errorObj.data,
    errorObj.error,
    errorObj
  ];
  for (const obj of paths) {
    const record = getObjectRecord(obj);
    if (!record || !("message" in record))
      continue;
    const rawMessage = record.message;
    if (typeof rawMessage === "string") {
      return normalizeMessage(rawMessage);
    }
  }
  try {
    return normalizeMessage(JSON.stringify(error));
  } catch {
    return "";
  }
}
function extractStatusCode(error, retryOnErrors) {
  if (!error)
    return;
  const errorObj = error;
  const statusCode = errorObj.statusCode ?? errorObj.status ?? errorObj.data?.statusCode;
  if (typeof statusCode === "number") {
    return statusCode;
  }
  if (typeof statusCode === "string") {
    const parsed = Number.parseInt(statusCode, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  const codes = retryOnErrors ?? DEFAULT_CONFIG.retry_on_errors;
  const message = getErrorMessage(error);
  const contextualPattern = new RegExp(`(?:status(?:\\s+code)?|code|http)D*(${codes.join("|")})\\b|\\b(${codes.join("|")})\\b(?=\x00|[^0-9])`, "i");
  const statusMatch = message.match(contextualPattern);
  const extracted = statusMatch?.[1] ?? statusMatch?.[2];
  if (extracted) {
    return parseInt(extracted, 10);
  }
  return;
}
function extractErrorName(error) {
  if (!error || typeof error !== "object")
    return;
  const errorObj = error;
  const directName = errorObj.name;
  if (typeof directName === "string" && directName.length > 0) {
    return directName;
  }
  const nestedError = errorObj.error;
  const nestedName = nestedError?.name;
  if (typeof nestedName === "string" && nestedName.length > 0) {
    return nestedName;
  }
  const dataError = errorObj.data?.error;
  const dataErrorName = dataError?.name;
  if (typeof dataErrorName === "string" && dataErrorName.length > 0) {
    return dataErrorName;
  }
  return;
}
function classifyErrorType(error) {
  const message = getErrorMessage(error);
  const errorName = extractErrorName(error)?.toLowerCase();
  if (errorName?.includes("loadapi") || /api.?key.?is.?missing/i.test(message) && /environment variable/i.test(message) || /(?:x-api-key|api key).*(?:is required|missing|required)/i.test(message) || /(?:missing|required).*(?:x-api-key|api key)/i.test(message)) {
    return "missing_api_key";
  }
  if (/api.?key/i.test(message) && /must be a string/i.test(message) || /incorrect api key provided/i.test(message) || /api key not valid/i.test(message) || /invalid api key/i.test(message)) {
    return "invalid_api_key";
  }
  if (errorName?.includes("unknownerror") && /model\s+not\s+found/i.test(message)) {
    return "model_not_found";
  }
  if (/model\s+(?:is\s+)?not\s+(?:found|supported|available)/i.test(message) || /the model .+ does not exist/i.test(message)) {
    return "model_not_found";
  }
  return;
}
function extractAutoRetrySignal(info) {
  if (!info)
    return;
  const candidates = [];
  const directStatus = info.status;
  if (typeof directStatus === "string")
    candidates.push(directStatus);
  const summary = info.summary;
  if (typeof summary === "string")
    candidates.push(summary);
  const message = info.message;
  if (typeof message === "string")
    candidates.push(message);
  const details = info.details;
  if (typeof details === "string")
    candidates.push(details);
  const combined = candidates.join(`
`);
  if (!combined)
    return;
  const isAutoRetry = AUTO_RETRY_PATTERNS.every((test) => test(combined));
  if (isAutoRetry) {
    return { signal: combined };
  }
  return;
}
function containsErrorContent(parts) {
  if (!parts || parts.length === 0)
    return { hasError: false };
  const errorParts = parts.filter((p) => p.type === "error");
  if (errorParts.length > 0) {
    const errorMessages = errorParts.map((p) => p.text).filter((text) => typeof text === "string");
    const errorMessage = errorMessages.length > 0 ? errorMessages.join(`
`) : undefined;
    return { hasError: true, errorMessage };
  }
  return { hasError: false };
}
function detectErrorInTextParts(parts) {
  if (!parts || parts.length === 0)
    return { hasError: false };
  const textContent = parts.filter((p) => p.type === "text" && typeof p.text === "string" && p.text.length > 0).map((p) => p.text).join(`
`);
  if (!textContent)
    return { hasError: false };
  const errorType = classifyErrorType({ message: textContent, name: "TextContent" });
  if (errorType) {
    return { hasError: true, errorType, errorMessage: textContent };
  }
  return { hasError: false };
}
function extractErrorContentFromParts(parts) {
  if (!parts || parts.length === 0)
    return { hasError: false };
  const errorParts = parts.filter((p) => p.type === "error" && typeof p.text === "string" && p.text.length > 0);
  if (errorParts.length > 0) {
    const errorMessage = errorParts.map((p) => p.text).join(`
`);
    return { hasError: true, errorMessage };
  }
  return { hasError: false };
}
function isRetryableError(error, retryOnErrors, userPatterns) {
  const statusCode = extractStatusCode(error, retryOnErrors);
  const message = getErrorMessage(error);
  const errorType = classifyErrorType(error);
  if (errorType === "missing_api_key") {
    return true;
  }
  if (errorType === "model_not_found") {
    return true;
  }
  if (statusCode && retryOnErrors.includes(statusCode)) {
    return true;
  }
  if (RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }
  if (userPatterns && userPatterns.length > 0) {
    for (const patternStr of userPatterns) {
      try {
        const re = new RegExp(patternStr, "i");
        if (re.test(message))
          return true;
      } catch {}
    }
  }
  return false;
}
function isProviderWideRateLimitError(error) {
  const message = getErrorMessage(error);
  if (/rate\s+limit\s+for\s+\S+/i.test(message))
    return false;
  return /workspace\s+input\s+tokens?\s+per\s+minute/i.test(message);
}
var AUTO_RETRY_PATTERNS;
var init_error_classifier = __esm(() => {
  init_constants();
  AUTO_RETRY_PATTERNS = [
    (combined) => /retrying\s+in/i.test(combined),
    (combined) => /(?:too\s+many\s+requests|quota\s*exceeded|usage\s+limit|rate\s+limit|limit\s+reached)/i.test(combined)
  ];
});

// message-update-handler.ts
function hasVisibleAssistantResponse(extractAutoRetrySignalFn) {
  return async (ctx, sessionID, _info) => {
    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory }
      });
      const msgs = messagesResp.data;
      if (!msgs || msgs.length === 0)
        return false;
      const lastAssistant = [...msgs].reverse().find((m) => m.info?.role === "assistant");
      if (!lastAssistant)
        return false;
      if (lastAssistant.info?.error)
        return false;
      const parts = lastAssistant.parts ?? lastAssistant.info?.parts;
      const hasToolCall = (parts ?? []).some((p) => p.type === "tool_call");
      const textFromParts = (parts ?? []).filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text.trim()).filter((text) => text.length > 0).join(`
`);
      if (hasToolCall)
        return true;
      if (!textFromParts)
        return false;
      if (extractAutoRetrySignalFn({ message: textFromParts }))
        return false;
      return true;
    } catch {
      return false;
    }
  };
}
async function checkLastAssistantForErrorContent(ctx, sessionID) {
  try {
    const messagesResp = await ctx.client.session.messages({
      path: { id: sessionID },
      query: { directory: ctx.directory }
    });
    const msgs = messagesResp.data;
    if (!msgs || msgs.length === 0)
      return;
    const lastAssistant = [...msgs].reverse().find((m) => m.info?.role === "assistant");
    if (!lastAssistant)
      return;
    const parts = lastAssistant.parts ?? lastAssistant.info?.parts;
    const result = extractErrorContentFromParts(parts);
    if (result.hasError)
      return result.errorMessage;
    const textResult = detectErrorInTextParts(parts);
    if (textResult.hasError)
      return textResult.errorMessage;
    return;
  } catch {
    return;
  }
}
function createMessageUpdateHandler(deps, helpers) {
  const {
    ctx,
    config,
    sessionStates,
    sessionLastAccess,
    sessionRetryInFlight,
    sessionAwaitingFallbackResult
  } = deps;
  const checkVisibleResponse = hasVisibleAssistantResponse(extractAutoRetrySignal);
  const requestMessages = deps.sessionRequestMessages ??= new Map;
  const activeRequests = deps.sessionActiveRequests ??= new Map;
  return async (props) => {
    const info = props?.info;
    const sessionID = info?.sessionID;
    const retrySignalResult = extractAutoRetrySignal(info);
    const retrySignal = retrySignalResult?.signal;
    const timeoutEnabled = config.timeout_seconds > 0;
    const parts = props?.parts;
    const errorContentResult = containsErrorContent(parts);
    let error = info?.error ?? (retrySignal && timeoutEnabled ? { name: "ProviderRateLimitError", message: retrySignal } : undefined) ?? (errorContentResult.hasError ? {
      name: "MessageContentError",
      message: errorContentResult.errorMessage || "Message contains error content"
    } : undefined);
    const role = info?.role;
    const messageID = typeof info?.id === "string" ? info.id : undefined;
    const completed = !!info?.finish || !!info?.time?.completed;
    const hasConcreteContent = parts?.some((p) => p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0 || p.type === "tool_call" || p.type === "tool");
    const model = info?.model ?? (typeof info?.providerID === "string" && typeof info?.modelID === "string" ? `${info.providerID}/${info.modelID}` : undefined);
    if (sessionID && role === "assistant") {
      if (messageID && !error && !completed && requestMessages.get(sessionID) !== messageID) {
        const state = sessionStates.get(sessionID);
        const expectedModel = state?.pendingFallbackModel ?? state?.currentModel;
        if (state && sessionAwaitingFallbackResult.has(sessionID) && !deps.sessionDispatchModels?.has(sessionID) && !deps.sessionCompactionInFlight.has(sessionID) && (deps.sessionFirstTokenReceived.get(sessionID) || model && model !== expectedModel && !state.failedModels.has(model))) {
          sessionAwaitingFallbackResult.delete(sessionID);
        }
        requestMessages.set(sessionID, messageID);
        activeRequests.set(sessionID, messageID);
        deps.sessionFirstTokenReceived.delete(sessionID);
        if (!sessionAwaitingFallbackResult.has(sessionID) && !deps.sessionDispatchModels?.has(sessionID)) {
          helpers.clearSessionFallbackTimeout(sessionID);
          const state2 = sessionStates.get(sessionID);
          if (state2 && model && !state2.pendingFallbackModel)
            state2.currentModel = model;
        }
      }
      if (completed && (!messageID || activeRequests.get(sessionID) === messageID)) {
        activeRequests.delete(sessionID);
        if (!sessionAwaitingFallbackResult.has(sessionID))
          helpers.clearSessionFallbackTimeout(sessionID);
      }
      deps.sessionLastMessageTime.set(sessionID, Date.now());
      logInfo("message.updated received", {
        sessionID,
        model,
        hasInfoError: !!info?.error,
        errorType: info?.error ? classifyErrorType(info.error) : undefined
      });
      if (deps.sessionProviderRetrying?.has(sessionID)) {
        if (hasConcreteContent) {
          deps.sessionProviderRetrying.delete(sessionID);
        } else if (retrySignal || !info?.error) {
          return;
        } else {
          deps.sessionProviderRetrying.delete(sessionID);
        }
      }
    }
    const requestAtStart = sessionID ? requestMessages.get(sessionID) : undefined;
    const isCurrentRequest = () => !sessionID || requestMessages.get(sessionID) === requestAtStart;
    if (sessionID && role === "assistant" && !error) {
      const errorContent = await checkLastAssistantForErrorContent(ctx, sessionID);
      if (!isCurrentRequest())
        return;
      if (errorContent) {
        logInfo("Detected error content in message parts", {
          sessionID,
          errorContent: errorContent.slice(0, 200)
        });
        error = { name: "ContentError", message: errorContent };
      }
    }
    if (sessionID && role === "assistant" && !error) {
      if (hasConcreteContent) {
        deps.sessionProviderRetrying?.delete(sessionID);
      }
      if (!sessionAwaitingFallbackResult.has(sessionID)) {
        const eventHasContent = hasConcreteContent;
        if (model && !sessionStates.has(sessionID)) {
          const state2 = createFallbackState(model);
          sessionStates.set(sessionID, state2);
          sessionLastAccess.set(sessionID, Date.now());
        }
        if (eventHasContent) {
          deps.sessionFirstTokenReceived.set(sessionID, true);
        }
        const needsTimeout = model && !completed && config.timeout_seconds > 0 && !deps.sessionFirstTokenReceived.get(sessionID) && !deps.sessionFallbackTimeouts.has(sessionID) && !deps.sessionProviderRetrying?.has(sessionID) && !eventHasContent;
        if (needsTimeout) {
          const agent = info?.agent;
          helpers.resolveAgentForSessionFromContext(sessionID, agent).then((resolvedAgent) => {
            if (deps.sessionFirstTokenReceived.get(sessionID) || deps.sessionFallbackTimeouts.has(sessionID) || messageID && activeRequests.get(sessionID) !== messageID)
              return;
            const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, deps.agentConfigs, deps.globalFallbackModels);
            if (fallbackModels.length > 0) {
              helpers.scheduleSessionFallbackTimeout(sessionID, resolvedAgent);
              logInfo("Scheduled primary model TTFT timeout", {
                sessionID,
                model,
                timeoutSeconds: config.timeout_seconds
              });
            }
          }).catch(() => {});
        }
        return;
      }
      const hasVisible = await checkVisibleResponse(ctx, sessionID, info);
      if (!isCurrentRequest())
        return;
      if (!hasVisible) {
        const eventHasActivity = parts?.some((p) => p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0 || p.type === "tool_call");
        if (eventHasActivity) {
          deps.sessionFirstTokenReceived.set(sessionID, true);
        }
        logError("Assistant update observed without visible final response; keeping fallback timeout", { sessionID, model, firstTokenReceived: deps.sessionFirstTokenReceived.get(sessionID) ?? false });
        return;
      }
      deps.sessionFirstTokenReceived.set(sessionID, true);
      sessionAwaitingFallbackResult.delete(sessionID);
      helpers.clearSessionFallbackTimeout(sessionID);
      const state = sessionStates.get(sessionID);
      if (state?.pendingFallbackModel) {
        state.pendingFallbackModel = undefined;
      }
      logInfo("Assistant response observed; cleared fallback timeout", {
        sessionID,
        model
      });
      return;
    }
    if (sessionID && role === "assistant" && error) {
      if (deps.sessionCompactionInFlight.has(sessionID)) {
        logInfo("Ignoring message.updated error during compaction in-flight", {
          sessionID,
          model,
          errorName: extractErrorName(error)
        });
        return;
      }
      const currentState = sessionStates.get(sessionID);
      const eventAgent = info?.agent?.trim().toLowerCase();
      const isCompactionError = eventAgent === "compaction";
      if (currentState && model && model !== currentState.currentModel) {
        if (isCompactionError) {
          logInfo("Compaction error on failed model \u2014 will retry on current fallback", {
            sessionID,
            failedModel: model,
            currentModel: currentState.currentModel,
            errorName: extractErrorName(error)
          });
        } else {
          const isAlreadyFailed = currentState.failedModels.has(model);
          const retryableStaleError = isRetryableError(error, config.retry_on_errors, config.retryable_error_patterns);
          const canResyncToErrorModel = retryableStaleError && !isAlreadyFailed && !currentState.pendingFallbackModel && !sessionAwaitingFallbackResult.has(sessionID);
          if (canResyncToErrorModel) {
            logInfo("Resyncing state to error model before fallback planning", {
              sessionID,
              previousModel: currentState.currentModel,
              errorModel: model,
              errorName: extractErrorName(error)
            });
            currentState.currentModel = model;
            sessionLastAccess.set(sessionID, Date.now());
          } else {
            logInfo("Ignoring stale error from previous model", {
              sessionID,
              staleModel: model,
              currentModel: currentState.currentModel,
              errorName: extractErrorName(error),
              isAlreadyFailed
            });
            return;
          }
        }
      }
      const SELF_ABORT_WINDOW_MS = 2000;
      const errorName = extractErrorName(error);
      const selfAbortTs = deps.sessionSelfAbortTimestamp.get(sessionID);
      if (errorName === "MessageAbortedError" && selfAbortTs && Date.now() - selfAbortTs < SELF_ABORT_WINDOW_MS) {
        logInfo("Ignoring self-inflicted MessageAbortedError (abort initiated by plugin)", {
          sessionID,
          model,
          msSinceAbort: Date.now() - selfAbortTs,
          awaitingFallback: sessionAwaitingFallbackResult.has(sessionID),
          retryInFlight: sessionRetryInFlight.has(sessionID)
        });
        return;
      }
      if (sessionRetryInFlight.has(sessionID) && !retrySignal) {
        logInfo("message.updated fallback skipped (retry in flight)", {
          sessionID
        });
        return;
      }
      if (retrySignal && sessionRetryInFlight.has(sessionID) && timeoutEnabled) {
        logError("Overriding in-flight retry due to provider auto-retry signal", { sessionID, model });
        await helpers.abortSessionRequest(sessionID, "message.updated.retry-signal");
        sessionRetryInFlight.delete(sessionID);
      }
      const retryLock = acquireRetryLock(deps, sessionID);
      sessionAwaitingFallbackResult.delete(sessionID);
      try {
        if (retrySignal && timeoutEnabled) {
          logInfo("Detected provider auto-retry signal", { sessionID, model });
        }
        if (!retrySignal) {
          helpers.clearSessionFallbackTimeout(sessionID);
        }
        logInfo("message.updated with assistant error", {
          sessionID,
          model,
          statusCode: extractStatusCode(error, config.retry_on_errors),
          errorName: extractErrorName(error),
          errorType: classifyErrorType(error)
        });
        let state = sessionStates.get(sessionID);
        const agent = info?.agent;
        const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent);
        if (isCompactionError && state && state.currentModel !== model && state.currentModel !== state.originalModel) {
          logInfo("Compaction failed on stale model \u2014 re-dispatching on current fallback", {
            sessionID,
            failedModel: model,
            currentFallbackModel: state.currentModel
          });
          if (config.notify_on_fallback) {
            const fromName = (model || "primary").split("/").pop();
            const toName = state.currentModel.split("/").pop() || state.currentModel;
            deps.ctx.client.tui.showToast({
              body: {
                title: "Compaction Fallback",
                message: `${fromName} failed \u2014 retrying compaction on ${toName}`,
                variant: "warning",
                duration: 5000
              }
            }).catch(() => {});
          }
          await helpers.autoRetryWithFallback(sessionID, state.currentModel, "compaction", "message.updated.compaction-stale", undefined);
          return;
        }
        const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, deps.agentConfigs, deps.globalFallbackModels);
        if (fallbackModels.length === 0) {
          return;
        }
        if (state && state.pendingFallbackModel && model !== state.pendingFallbackModel) {
          logInfo("Skipping duplicate fallback trigger (already in progress for different model)", {
            sessionID,
            pendingFallbackModel: state.pendingFallbackModel,
            errorModel: model
          });
          return;
        }
        const isRetryable = isRetryableError(error, config.retry_on_errors, config.retryable_error_patterns);
        const inFallbackChain = state && state.currentModel !== state.originalModel;
        if (!isRetryable && !inFallbackChain) {
          logError("message.updated error not retryable and not in fallback chain, skipping", {
            sessionID,
            statusCode: extractStatusCode(error, config.retry_on_errors),
            errorName: extractErrorName(error),
            errorType: classifyErrorType(error)
          });
          return;
        }
        if (!isRetryable && inFallbackChain) {
          logInfo("message.updated non-retryable error but in fallback chain, continuing", {
            sessionID,
            currentModel: state?.currentModel,
            originalModel: state?.originalModel,
            errorName: extractErrorName(error)
          });
        }
        if (!state) {
          let initialModel = model;
          if (!initialModel) {
            const agentConfig = resolvedAgent && deps.agentConfigs ? deps.agentConfigs[resolvedAgent] : undefined;
            const agentModel = agentConfig?.model;
            if (agentModel) {
              logError("Derived model from agent config for message.updated", {
                sessionID,
                agent: resolvedAgent,
                model: agentModel
              });
              initialModel = agentModel;
            }
          }
          if (!initialModel) {
            logError("message.updated missing model info, cannot fallback", {
              sessionID,
              errorName: extractErrorName(error),
              errorType: classifyErrorType(error)
            });
            return;
          }
          state = createFallbackState(initialModel);
          sessionStates.set(sessionID, state);
          sessionLastAccess.set(sessionID, Date.now());
        } else {
          sessionLastAccess.set(sessionID, Date.now());
          if (state.pendingFallbackModel && retrySignal && timeoutEnabled) {
            logError("Clearing pending fallback due to provider auto-retry signal", {
              sessionID,
              pendingFallbackModel: state.pendingFallbackModel
            });
            state.pendingFallbackModel = undefined;
          }
        }
        const blockedProvider = isProviderWideRateLimitError(error) ? state.currentModel.split("/")[0] : undefined;
        const plan = planFallback(sessionID, state, fallbackModels, config, blockedProvider);
        if (plan.success) {
          if (config.notify_on_fallback) {
            deps.ctx.client.tui.showToast({
              body: {
                title: "Model Fallback",
                message: `Switching to ${plan.newModel?.split("/").pop() || plan.newModel} for next request`,
                variant: "warning",
                duration: 5000
              }
            }).catch(() => {});
          }
          await helpers.autoRetryWithFallback(sessionID, plan.newModel, resolvedAgent, "message.updated", plan);
        }
      } finally {
        releaseRetryLock(deps, sessionID, retryLock);
      }
    }
  };
}
var init_message_update_handler = __esm(() => {
  init_error_classifier();
  init_fallback_state();
  init_config_reader();
  init_logger();
});

// event-handler.ts
function createEventHandler(deps, helpers) {
  const {
    config,
    sessionStates,
    sessionLastAccess,
    sessionRetryInFlight,
    sessionAwaitingFallbackResult,
    sessionFallbackTimeouts
  } = deps;
  const checkVisibleResponse = hasVisibleAssistantResponse(extractAutoRetrySignal);
  const handleActivity = async (sessionID, activityModel) => {
    if (sessionAwaitingFallbackResult.has(sessionID)) {
      const state = sessionStates.get(sessionID);
      if (activityModel && state && state.failedModels.has(activityModel)) {
        logInfo("Ignoring activity from already-failed model", {
          sessionID,
          activityModel,
          currentModel: state.currentModel
        });
        return;
      }
      if (!activityModel) {
        const fallbackCommitted = state && state.currentModel !== state.originalModel && state.failedModels.size > 0;
        if (!fallbackCommitted) {
          logInfo("Ignoring unattributed activity during fallback (pre-commit, no model on event)", {
            sessionID,
            currentModel: state?.currentModel
          });
        } else {
          logInfo("Unattributed activity after fallback commit \u2014 resetting timeout only, NOT marking first token (no model on event)", {
            sessionID,
            currentModel: state?.currentModel
          });
        }
        const resolvedAgent2 = resolveAgentForSession(sessionID, undefined);
        helpers.scheduleSessionFallbackTimeout(sessionID, resolvedAgent2);
        return;
      }
      if (!deps.sessionFirstTokenReceived.get(sessionID)) {
        deps.sessionFirstTokenReceived.set(sessionID, true);
      }
      const resolvedAgent = resolveAgentForSession(sessionID, undefined);
      helpers.scheduleSessionFallbackTimeout(sessionID, resolvedAgent);
      logInfo("Resetting fallback timeout due to activity", { sessionID, activityModel });
      return;
    }
    if (!deps.sessionFirstTokenReceived.get(sessionID)) {
      deps.sessionFirstTokenReceived.set(sessionID, true);
    }
    if (sessionAwaitingFallbackResult.size === 0) {
      return;
    }
    const cachedParentID = deps.sessionParentID.get(sessionID);
    const parentID = cachedParentID !== undefined ? cachedParentID : await helpers.getParentSessionID(sessionID);
    if (parentID && sessionAwaitingFallbackResult.has(parentID)) {
      const resolvedAgent = resolveAgentForSession(parentID, undefined);
      helpers.scheduleSessionFallbackTimeout(parentID, resolvedAgent);
      logInfo("Resetting parent fallback timeout due to child activity", {
        sessionID,
        parentID
      });
    }
  };
  const handleSessionCreated = (props) => {
    const sessionInfo = props?.info;
    const sessionID = sessionInfo?.id;
    if (!sessionID)
      return;
    const parentID = sessionInfo?.parentID;
    if (typeof parentID === "string" && parentID.length > 0) {
      deps.sessionParentID.set(sessionID, parentID);
    }
    logInfo("Session created, state will be created on-demand", { sessionID });
  };
  const handleSessionDeleted = (props) => {
    const sessionInfo = props?.info;
    const sessionID = sessionInfo?.id;
    if (sessionID) {
      logInfo("Cleaning up session state", { sessionID });
      helpers.clearChildFallbackBridge?.(sessionID);
      sessionStates.delete(sessionID);
      sessionLastAccess.delete(sessionID);
      sessionRetryInFlight.delete(sessionID);
      sessionAwaitingFallbackResult.delete(sessionID);
      deps.sessionFirstTokenReceived.delete(sessionID);
      deps.sessionRequestMessages?.delete(sessionID);
      deps.sessionActiveRequests?.delete(sessionID);
      deps.sessionDispatchModels?.delete(sessionID);
      deps.sessionRetryLockTokens?.delete(sessionID);
      deps.sessionSelfAbortTimestamp.delete(sessionID);
      deps.sessionParentID.delete(sessionID);
      deps.sessionCompactionInFlight.delete(sessionID);
      deps.sessionProviderRetrying?.delete(sessionID);
      deps.sessionIdleResolvers.delete(sessionID);
      deps.sessionLastMessageTime.delete(sessionID);
      helpers.clearSessionFallbackTimeout(sessionID);
    }
  };
  const handleSessionStop = async (props) => {
    const sessionID = props?.sessionID;
    if (!sessionID)
      return;
    deps.sessionActiveRequests?.delete(sessionID);
    deps.sessionDispatchModels?.delete(sessionID);
    deps.sessionRetryLockTokens?.delete(sessionID);
    helpers.clearSessionFallbackTimeout(sessionID);
    if (sessionRetryInFlight.has(sessionID) || sessionAwaitingFallbackResult.has(sessionID)) {
      await helpers.abortSessionRequest(sessionID, "session.stop");
    }
    sessionRetryInFlight.delete(sessionID);
    sessionAwaitingFallbackResult.delete(sessionID);
    deps.sessionCompactionInFlight.delete(sessionID);
    deps.sessionSelfAbortTimestamp.delete(sessionID);
    deps.sessionProviderRetrying?.delete(sessionID);
    const state = sessionStates.get(sessionID);
    if (state?.pendingFallbackModel) {
      state.pendingFallbackModel = undefined;
    }
    logInfo("Cleared fallback retry state on session.stop", { sessionID });
  };
  const handleSessionIdle = async (props) => {
    const sessionID = props?.sessionID;
    if (!sessionID)
      return;
    deps.sessionProviderRetrying?.delete(sessionID);
    deps.sessionActiveRequests?.delete(sessionID);
    const idleResolvers = deps.sessionIdleResolvers.get(sessionID);
    if (idleResolvers && idleResolvers.length > 0) {
      logInfo("session.idle resolving waiters", {
        sessionID,
        waiterCount: idleResolvers.length
      });
      for (const resolve of idleResolvers)
        resolve();
      deps.sessionIdleResolvers.delete(sessionID);
    }
    if (deps.sessionRetryLockTokens?.has(sessionID) && !sessionAwaitingFallbackResult.has(sessionID))
      return;
    if (sessionAwaitingFallbackResult.has(sessionID)) {
      if (deps.sessionCompactionInFlight.has(sessionID)) {
        logInfo("session.idle during compaction in-flight \u2014 not a silent failure, waiting for session.compacted", {
          sessionID
        });
        return;
      }
      const firstTokenReceived = deps.sessionFirstTokenReceived.get(sessionID);
      if (!firstTokenReceived) {
        const state2 = sessionStates.get(sessionID);
        if (state2) {
          logInfo("session.idle detected silent model failure (no first token received)", {
            sessionID,
            currentModel: state2.currentModel,
            attemptCount: state2.attemptCount
          });
          if (sessionRetryInFlight.has(sessionID)) {
            logInfo("session.idle silent failure \u2014 retry already in flight, skipping", {
              sessionID
            });
            return;
          }
          const retryLock = acquireRetryLock(deps, sessionID);
          sessionAwaitingFallbackResult.delete(sessionID);
          helpers.clearSessionFallbackTimeout(sessionID);
          try {
            const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, undefined);
            const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, deps.agentConfigs, deps.globalFallbackModels);
            if (fallbackModels.length === 0) {
              logInfo("session.idle silent failure \u2014 no fallback models configured", {
                sessionID
              });
              return;
            }
            const plan = planFallback(sessionID, state2, fallbackModels, config);
            if (plan.success) {
              await helpers.autoRetryWithFallback(sessionID, plan.newModel, resolvedAgent, "session.idle.silent-failure", plan);
            } else {
              logInfo("session.idle silent failure \u2014 no more fallback models available", {
                sessionID,
                error: plan.error
              });
            }
          } finally {
            releaseRetryLock(deps, sessionID, retryLock);
          }
          return;
        }
      }
      logInfo("session.idle with first token received \u2014 fallback model completed", {
        sessionID
      });
      sessionAwaitingFallbackResult.delete(sessionID);
      helpers.clearSessionFallbackTimeout(sessionID);
      if (!deps.sessionRetryLockTokens?.has(sessionID))
        sessionRetryInFlight.delete(sessionID);
      return;
    }
    const hadTimeout = sessionFallbackTimeouts.has(sessionID);
    helpers.clearSessionFallbackTimeout(sessionID);
    sessionRetryInFlight.delete(sessionID);
    const state = sessionStates.get(sessionID);
    if (state?.pendingFallbackModel) {
      state.pendingFallbackModel = undefined;
    }
    if (hadTimeout) {
      logInfo("Cleared fallback timeout after session completion", { sessionID });
    }
  };
  const handleSessionStatus = async (props) => {
    const sessionID = props?.sessionID;
    const status = props?.status;
    if (!sessionID || !status)
      return;
    if (status.type === "idle") {
      await handleSessionIdle(props);
      return;
    }
    if (status.type !== "retry")
      return;
    if (deps.sessionCompactionInFlight.has(sessionID))
      return;
    if (deps.sessionFirstTokenReceived.get(sessionID) && !sessionAwaitingFallbackResult.has(sessionID) && await checkVisibleResponse(deps.ctx, sessionID, undefined)) {
      logInfo("Ignoring stale provider retry after response activity", { sessionID });
      return;
    }
    const parentID = await helpers.getParentSessionID(sessionID);
    if (parentID) {
      deps.sessionProviderRetrying?.add(sessionID);
      helpers.clearSessionFallbackTimeout(sessionID);
      logInfo("Leaving foreground child retry attached to parent task", {
        sessionID,
        parentID,
        nextRetryMs: status.next
      });
      if (config.notify_on_fallback) {
        await deps.ctx.client.tui.showToast({
          body: {
            title: "Subagent Provider Retrying",
            variant: "warning",
            duration: 8000,
            message: "Keeping the subagent attached; automatic fallback would cancel its parent task."
          }
        }).catch(() => {});
      }
      return;
    }
    if (sessionRetryInFlight.has(sessionID)) {
      logInfo("session.status skipped -- retry lock already held", { sessionID });
      return;
    }
    if (deps.sessionCompactionInFlight.has(sessionID))
      return;
    const retryLock = acquireRetryLock(deps, sessionID);
    try {
      const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, undefined);
      if (deps.sessionCompactionInFlight.has(sessionID))
        return;
      if (deps.sessionFirstTokenReceived.get(sessionID) && !sessionAwaitingFallbackResult.has(sessionID) && await checkVisibleResponse(deps.ctx, sessionID, undefined)) {
        logInfo("Ignoring stale provider retry after response activity", { sessionID });
        return;
      }
      const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, deps.agentConfigs, deps.globalFallbackModels);
      logInfo("Provider retry detected", {
        sessionID,
        attempt: status.attempt,
        message: status.message,
        nextRetryMs: status.next,
        resolvedAgent,
        totalFallbackModels: fallbackModels.length,
        fallbackModels
      });
      if (fallbackModels.length === 0) {
        if (config.notify_on_fallback) {
          await deps.ctx.client.tui.showToast({
            body: {
              title: "Provider Retrying",
              variant: "info",
              duration: 3000,
              message: `${status.message || "retrying..."} (no fallback models configured)`
            }
          }).catch(() => {});
        }
        return;
      }
      const nextRetryMs = status.next;
      if (typeof nextRetryMs === "number" && nextRetryMs > 0) {
        const now = Date.now();
        const timeoutMs = config.timeout_seconds * 1000;
        if (nextRetryMs > now + timeoutMs) {
          logInfo("Provider retry is beyond timeout, triggering immediate fallback", {
            sessionID,
            nextRetryMs,
            now,
            timeoutMs,
            diffSeconds: Math.round((nextRetryMs - now) / 1000)
          });
          await triggerImmediateFallback(sessionID, resolvedAgent, fallbackModels, status);
          return;
        }
      }
      let state = sessionStates.get(sessionID);
      if (!state) {
        const agentConfig = resolvedAgent && deps.agentConfigs ? deps.agentConfigs[resolvedAgent] : undefined;
        const initialModel = agentConfig?.model ?? findFirstAgentModel();
        if (!initialModel) {
          logInfo("No model info for session.status fallback", { sessionID });
          return;
        }
        logInfo("Creating on-demand state for session.status", {
          sessionID,
          model: initialModel,
          agent: resolvedAgent
        });
        state = createFallbackState(initialModel);
        sessionStates.set(sessionID, state);
        sessionLastAccess.set(sessionID, Date.now());
      } else {
        sessionLastAccess.set(sessionID, Date.now());
      }
      sessionAwaitingFallbackResult.delete(sessionID);
      helpers.clearSessionFallbackTimeout(sessionID);
      const blockedProvider = isProviderWideRateLimitError(status.message) ? state.currentModel.split("/")[0] : undefined;
      const plan = planFallback(sessionID, state, fallbackModels, config, blockedProvider);
      if (plan.success) {
        if (config.notify_on_fallback) {
          const modelName = plan.newModel?.split("/").pop() || plan.newModel;
          deps.ctx.client.tui.showToast({
            body: {
              title: "Retry Detected -- Switching Model",
              variant: "warning",
              duration: 5000,
              message: `${status.message || "Provider retrying"} -> ${modelName} (attempt ${state.attemptCount + 1} of ${fallbackModels.length})`
            }
          }).catch(() => {});
        }
        await helpers.autoRetryWithFallback(sessionID, plan.newModel, resolvedAgent, "session.status", plan);
      } else if (!plan.success) {
        logError("session.status fallback failed", {
          sessionID,
          error: plan.error
        });
        if (plan.maxAttemptsReached && config.notify_on_fallback) {
          await deps.ctx.client.tui.showToast({
            body: {
              title: "All Fallbacks Exhausted",
              variant: "error",
              duration: 8000,
              message: `All ${fallbackModels.length} fallback models exhausted after ${state.attemptCount} attempts`
            }
          }).catch(() => {});
        }
      }
    } finally {
      releaseRetryLock(deps, sessionID, retryLock);
    }
  };
  const handleSessionError = async (props) => {
    const sessionID = props?.sessionID;
    const error = props?.error;
    const agent = props?.agent;
    const errorModel = props?.model;
    if (!sessionID) {
      logInfo("session.error without sessionID, skipping");
      return;
    }
    deps.sessionProviderRetrying?.delete(sessionID);
    if (deps.sessionCompactionInFlight.has(sessionID)) {
      logInfo("Ignoring session.error during compaction in-flight", {
        sessionID,
        errorName: extractErrorName(error)
      });
      return;
    }
    const SELF_ABORT_WINDOW_MS = 2000;
    const selfAbortTs = deps.sessionSelfAbortTimestamp.get(sessionID);
    const errorName = extractErrorName(error);
    if (errorName === "MessageAbortedError" && selfAbortTs && Date.now() - selfAbortTs < SELF_ABORT_WINDOW_MS) {
      logInfo("Ignoring self-inflicted MessageAbortedError in session.error", {
        sessionID,
        msSinceAbort: Date.now() - selfAbortTs,
        awaitingFallback: sessionAwaitingFallbackResult.has(sessionID),
        retryInFlight: sessionRetryInFlight.has(sessionID)
      });
      return;
    }
    const currentState = sessionStates.get(sessionID);
    if (currentState?.pendingFallbackModel) {
      logInfo("Ignoring session.error while fallback replay is pending", {
        sessionID,
        pendingFallbackModel: currentState.pendingFallbackModel,
        currentModel: currentState.currentModel,
        errorName: extractErrorName(error)
      });
      return;
    }
    if (currentState && errorModel && errorModel !== currentState.currentModel) {
      logInfo("Ignoring stale session.error from previous model", {
        sessionID,
        staleModel: errorModel,
        currentModel: currentState.currentModel,
        errorName: extractErrorName(error)
      });
      return;
    }
    if (currentState && errorModel && currentState.failedModels.has(errorModel)) {
      logInfo("Ignoring session.error from already-failed model", {
        sessionID,
        errorModel,
        currentModel: currentState.currentModel,
        errorName: extractErrorName(error)
      });
      return;
    }
    if (sessionAwaitingFallbackResult.has(sessionID)) {
      logInfo("Ignoring session.error while awaiting fallback result (likely stale abort)", {
        sessionID,
        currentModel: currentState?.currentModel,
        errorName: extractErrorName(error)
      });
      return;
    }
    if (sessionRetryInFlight.has(sessionID)) {
      logInfo("session.error skipped -- retry in flight (early lock)", {
        sessionID,
        retryInFlight: true
      });
      return;
    }
    const retryLock = acquireRetryLock(deps, sessionID);
    try {
      const resolvedAgent = await helpers.resolveAgentForSessionFromContext(sessionID, agent);
      if (deps.sessionCompactionInFlight.has(sessionID)) {
        logInfo("session.error skipping \u2014 compaction already being handled by message.updated", {
          sessionID,
          resolvedAgent,
          errorName: extractErrorName(error)
        });
        return;
      }
      helpers.clearSessionFallbackTimeout(sessionID);
      const stateAfterAwait = sessionStates.get(sessionID);
      if (stateAfterAwait?.pendingFallbackModel) {
        logInfo("Ignoring session.error \u2014 fallback replay became pending during agent resolution", {
          sessionID,
          pendingFallbackModel: stateAfterAwait.pendingFallbackModel,
          currentModel: stateAfterAwait.currentModel,
          errorName: extractErrorName(error)
        });
        return;
      }
      logInfo("session.error received", {
        sessionID,
        agent,
        resolvedAgent,
        statusCode: extractStatusCode(error, config.retry_on_errors),
        errorName: extractErrorName(error),
        errorType: classifyErrorType(error)
      });
      const isRetryable = isRetryableError(error, config.retry_on_errors, config.retryable_error_patterns);
      let state = sessionStates.get(sessionID);
      const fallbackModels = getFallbackModelsForSession(sessionID, resolvedAgent, deps.agentConfigs, deps.globalFallbackModels);
      if (fallbackModels.length === 0) {
        logInfo("No fallback models configured", { sessionID, agent });
        return;
      }
      const inFallbackChain = state && state.currentModel !== state.originalModel;
      if (!isRetryable && !inFallbackChain) {
        logInfo("Error not retryable and not in fallback chain, skipping", {
          sessionID,
          retryable: false,
          inFallbackChain: false,
          statusCode: extractStatusCode(error, config.retry_on_errors),
          errorName: extractErrorName(error),
          errorType: classifyErrorType(error)
        });
        return;
      }
      if (!isRetryable && inFallbackChain) {
        logInfo("Non-retryable error but in fallback chain, continuing to next fallback", {
          sessionID,
          retryable: false,
          inFallbackChain: true,
          currentModel: state?.currentModel,
          originalModel: state?.originalModel,
          errorName: extractErrorName(error)
        });
      }
      if (!state) {
        const currentModel = props?.model;
        if (currentModel) {
          state = createFallbackState(currentModel);
          sessionStates.set(sessionID, state);
          sessionLastAccess.set(sessionID, Date.now());
        } else if (!errorModel && sessionRetryInFlight.has(sessionID)) {
          logInfo("Deferring to message.updated handler (no state, no errorModel, retry in flight)", {
            sessionID,
            errorName: extractErrorName(error)
          });
          return;
        } else {
          const agentConfig = resolvedAgent && deps.agentConfigs ? deps.agentConfigs[resolvedAgent] : undefined;
          const agentModel = agentConfig?.model;
          if (agentModel) {
            logInfo("Derived model from agent config", {
              sessionID,
              agent: resolvedAgent,
              model: agentModel
            });
            state = createFallbackState(agentModel);
            sessionStates.set(sessionID, state);
            sessionLastAccess.set(sessionID, Date.now());
          } else {
            const firstModel = findFirstAgentModel();
            if (firstModel) {
              logInfo("Using first available agent model for state creation", {
                sessionID,
                model: firstModel
              });
              state = createFallbackState(firstModel);
              sessionStates.set(sessionID, state);
              sessionLastAccess.set(sessionID, Date.now());
            } else {
              logInfo("No model info available, cannot fallback", { sessionID });
              return;
            }
          }
        }
      } else {
        sessionLastAccess.set(sessionID, Date.now());
      }
      const blockedProvider = isProviderWideRateLimitError(error) ? state.currentModel.split("/")[0] : undefined;
      const plan = planFallback(sessionID, state, fallbackModels, config, blockedProvider);
      if (plan.success) {
        if (config.notify_on_fallback) {
          const modelName = plan.newModel?.split("/").pop() || plan.newModel;
          const attemptInfo = `attempt ${state.attemptCount + 1} of ${fallbackModels.length}`;
          deps.ctx.client.tui.showToast({
            body: {
              title: "Model Fallback",
              message: `Switching to ${modelName} (${attemptInfo})`,
              variant: "warning",
              duration: 5000
            }
          }).catch(() => {});
        }
        await helpers.autoRetryWithFallback(sessionID, plan.newModel, resolvedAgent, "session.error", plan);
      } else {
        logError("Fallback preparation failed", {
          sessionID,
          error: plan.error
        });
      }
    } finally {
      releaseRetryLock(deps, sessionID, retryLock);
    }
  };
  const handleSessionCompacted = (props) => {
    const sessionID = props?.sessionID;
    if (!sessionID)
      return;
    const hadAwaiting = sessionAwaitingFallbackResult.has(sessionID);
    const hadCompaction = deps.sessionCompactionInFlight.has(sessionID);
    sessionAwaitingFallbackResult.delete(sessionID);
    sessionRetryInFlight.delete(sessionID);
    deps.sessionFirstTokenReceived.delete(sessionID);
    deps.sessionCompactionInFlight.delete(sessionID);
    helpers.clearSessionFallbackTimeout(sessionID);
    if (hadAwaiting || hadCompaction) {
      logInfo("Compaction completed, clearing fallback state", { sessionID });
    }
  };
  function findFirstAgentModel() {
    if (!deps.agentConfigs)
      return;
    for (const agentName of Object.keys(deps.agentConfigs)) {
      const agentConfig = deps.agentConfigs[agentName];
      const model = agentConfig?.model;
      if (model)
        return model;
    }
    return;
  }
  async function triggerImmediateFallback(sessionID, resolvedAgent, fallbackModels, status) {
    let state = sessionStates.get(sessionID);
    if (!state) {
      const agentConfig = resolvedAgent && deps.agentConfigs ? deps.agentConfigs[resolvedAgent] : undefined;
      const initialModel = agentConfig?.model ?? findFirstAgentModel();
      if (!initialModel) {
        logError("Cannot trigger immediate fallback - no model info", { sessionID });
        return;
      }
      state = createFallbackState(initialModel);
      sessionStates.set(sessionID, state);
      sessionLastAccess.set(sessionID, Date.now());
    } else {
      sessionLastAccess.set(sessionID, Date.now());
    }
    sessionAwaitingFallbackResult.delete(sessionID);
    helpers.clearSessionFallbackTimeout(sessionID);
    const plan = planFallback(sessionID, state, fallbackModels, config);
    if (plan.success) {
      if (config.notify_on_fallback) {
        const modelName = plan.newModel?.split("/").pop() || plan.newModel;
        deps.ctx.client.tui.showToast({
          body: {
            title: "Provider Retry Too Slow - Switching Model",
            variant: "warning",
            duration: 5000,
            message: `${status.message || "Provider retrying"} -> ${modelName} (immediate fallback)`
          }
        }).catch(() => {});
      }
      await helpers.autoRetryWithFallback(sessionID, plan.newModel, resolvedAgent, "session.status.immediate", plan);
    } else if (!plan.success) {
      logError("Immediate fallback preparation failed", {
        sessionID,
        error: plan.error
      });
      if (plan.maxAttemptsReached && config.notify_on_fallback) {
        await deps.ctx.client.tui.showToast({
          body: {
            title: "All Fallbacks Exhausted",
            variant: "error",
            duration: 8000,
            message: `All ${fallbackModels.length} fallback models exhausted`
          }
        }).catch(() => {});
      }
    }
  }
  return {
    handleEvent: async ({ event }) => {
      if (!config.enabled)
        return;
      const props = event.properties;
      if (event.type === "session.created") {
        handleSessionCreated(props);
        return;
      }
      if (event.type === "session.deleted") {
        handleSessionDeleted(props);
        return;
      }
      if (event.type === "session.stop") {
        await handleSessionStop(props);
        return;
      }
      if (event.type === "session.idle") {
        await handleSessionIdle(props);
        return;
      }
      if (event.type === "session.error") {
        await handleSessionError(props);
        return;
      }
      if (event.type === "session.status") {
        await handleSessionStatus(props);
        return;
      }
      if (event.type === "session.compacted") {
        handleSessionCompacted(props);
        return;
      }
    },
    handleActivity
  };
}
var init_event_handler = __esm(() => {
  init_logger();
  init_error_classifier();
  init_message_update_handler();
  init_fallback_state();
  init_config_reader();
});

// chat-message-handler.ts
function createChatMessageHandler(deps, helpers) {
  const {
    ctx,
    config,
    sessionStates,
    sessionLastAccess,
    sessionRetryInFlight,
    sessionAwaitingFallbackResult
  } = deps;
  return async (input, output) => {
    if (!config.enabled)
      return;
    const { sessionID } = input;
    let state = sessionStates.get(sessionID);
    if (!state) {
      return;
    }
    sessionLastAccess.set(sessionID, Date.now());
    const requestedModel = input.model ? `${input.model.providerID}/${input.model.modelID}` : undefined;
    if (requestedModel && requestedModel === state.currentModel && state.currentModel !== state.originalModel && !deps.sessionCompactionInFlight.has(sessionID) && !sessionRetryInFlight.has(sessionID) && !sessionAwaitingFallbackResult.has(sessionID)) {
      logInfo("Adopting current model as new primary (user confirmed manual selection)", {
        sessionID,
        model: requestedModel,
        previousOriginal: state.originalModel
      });
      state.originalModel = requestedModel;
      state.failedModels.clear();
      state.fallbackIndex = -1;
      state.attemptCount = 0;
      return;
    }
    if (state.currentModel !== state.originalModel) {
      if (!sessionRetryInFlight.has(sessionID) && !sessionAwaitingFallbackResult.has(sessionID)) {
        const recovered = recoverToOriginal(state, config.cooldown_seconds);
        if (recovered) {
          logInfo("Recovered to primary model", {
            sessionID,
            model: state.originalModel
          });
          if (config.notify_on_fallback) {
            const modelName = state.originalModel.split("/").pop() || state.originalModel;
            ctx.client.tui.showToast({
              body: {
                title: "Model Recovered",
                message: `Recovered to ${modelName}`,
                variant: "info",
                duration: 3000
              }
            }).catch(() => {});
          }
        }
      }
    }
    if (requestedModel && requestedModel !== state.currentModel) {
      if (state.pendingFallbackModel && state.pendingFallbackModel === requestedModel) {
        state.pendingFallbackModel = undefined;
        return;
      }
      if (sessionRetryInFlight.has(sessionID) || sessionAwaitingFallbackResult.has(sessionID)) {
        logInfo("Ignoring model mismatch during active fallback management", {
          sessionID,
          requestedModel,
          currentModel: state.currentModel,
          retryInFlight: sessionRetryInFlight.has(sessionID),
          awaitingResult: sessionAwaitingFallbackResult.has(sessionID)
        });
        return;
      }
      logError("Detected manual model change, resetting fallback state", {
        sessionID,
        from: state.currentModel,
        to: requestedModel
      });
      helpers.clearSessionFallbackTimeout(sessionID);
      sessionAwaitingFallbackResult.delete(sessionID);
      deps.sessionFirstTokenReceived.delete(sessionID);
      if (sessionRetryInFlight.has(sessionID)) {
        await helpers.abortSessionRequest(sessionID, "manual-model-change");
        sessionRetryInFlight.delete(sessionID);
      }
      state = createFallbackState(requestedModel);
      sessionStates.set(sessionID, state);
      return;
    }
    if (state.currentModel === state.originalModel)
      return;
    const activeModel = state.currentModel;
    logInfo("Applying fallback model override", {
      sessionID,
      from: input.model,
      to: activeModel
    });
    if (output.message && activeModel) {
      const parts = activeModel.split("/");
      if (parts.length >= 2) {
        output.message.model = {
          providerID: parts[0],
          modelID: parts.slice(1).join("/")
        };
      }
    }
    deps.sessionCompactionInFlight.delete(sessionID);
  };
}
var init_chat_message_handler = __esm(() => {
  init_fallback_state();
  init_logger();
});

// subagent-result-sync.ts
function isEmptyTaskResult(output) {
  return /<task_result>\s*<\/task_result>/.test(output);
}
function isCancelledTaskResult(output, metadata) {
  let metadataText = "";
  if (typeof metadata === "string") {
    metadataText = metadata;
  } else {
    try {
      metadataText = JSON.stringify(metadata ?? "") ?? "";
    } catch {}
  }
  return /task\s+cancelled/i.test(output) || /task\s+cancelled/i.test(metadataText);
}
function extractChildSessionID(output) {
  if (!output)
    return null;
  const match = output.match(TASK_ID_REGEX);
  return match ? match[1] : null;
}
function getSessionStatusType(sessionData) {
  const status = sessionData?.status;
  if (!status)
    return;
  if (typeof status === "string")
    return status;
  if (typeof status === "object" && status !== null && "type" in status) {
    return status.type;
  }
  return;
}
function waitForSessionIdle(deps, sessionID, inactivityMs, pollIntervalMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    let pollTimer;
    let timeoutTimer;
    let lastSeenMessageTime = deps.sessionLastMessageTime.get(sessionID) ?? Date.now();
    const settle = (result) => {
      if (settled)
        return;
      settled = true;
      if (pollTimer)
        clearInterval(pollTimer);
      if (timeoutTimer)
        clearTimeout(timeoutTimer);
      const resolvers2 = deps.sessionIdleResolvers.get(sessionID);
      if (resolvers2) {
        const idx = resolvers2.indexOf(onIdleRef);
        if (idx >= 0)
          resolvers2.splice(idx, 1);
        if (resolvers2.length === 0)
          deps.sessionIdleResolvers.delete(sessionID);
      }
      resolve(result);
    };
    const onIdleRef = () => settle(true);
    let resolvers = deps.sessionIdleResolvers.get(sessionID);
    if (!resolvers) {
      resolvers = [];
      deps.sessionIdleResolvers.set(sessionID, resolvers);
    }
    resolvers.push(onIdleRef);
    const resetTimeout = () => {
      if (timeoutTimer)
        clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => settle(false), inactivityMs);
    };
    resetTimeout();
    const pollStatus = () => {
      if (settled)
        return;
      const currentMessageTime = deps.sessionLastMessageTime.get(sessionID);
      if (currentMessageTime && currentMessageTime > lastSeenMessageTime) {
        lastSeenMessageTime = currentMessageTime;
        resetTimeout();
      }
      deps.ctx.client.session.get({ path: { id: sessionID } }).then((sessionInfo) => {
        if (settled)
          return;
        const statusType = getSessionStatusType(sessionInfo?.data ?? sessionInfo);
        if (statusType === "idle") {
          logInfo(`[subagent-sync] Polling detected child ${sessionID} idle`);
          settle(true);
        }
      }).catch(() => {});
    };
    pollStatus();
    pollTimer = setInterval(pollStatus, pollIntervalMs);
  });
}
async function waitForChildFallbackResult(deps, childSessionID, options) {
  const maxWaitMs = options?.maxWaitMs ?? Math.min((deps.config.timeout_seconds || 120) * 1000, 120000);
  const pollIntervalMs = options?.pollIntervalMs ?? 500;
  const startTime = Date.now();
  logInfo(`[subagent-sync] Waiting for child ${childSessionID} fallback result (max ${maxWaitMs}ms idle timeout)`);
  while (deps.sessionRetryInFlight.has(childSessionID)) {
    if (Date.now() - startTime >= maxWaitMs) {
      logInfo(`[subagent-sync] Timed out waiting for child ${childSessionID} dispatch after ${maxWaitMs}ms`);
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  const remainingMs = Math.max(1000, maxWaitMs - (Date.now() - startTime));
  const wentIdle = await waitForSessionIdle(deps, childSessionID, remainingMs, pollIntervalMs);
  if (!wentIdle) {
    logInfo(`[subagent-sync] Timed out waiting for child ${childSessionID} after ${Date.now() - startTime}ms`);
    return null;
  }
  const result = await extractAssistantResponse(deps, childSessionID, options?.notBeforeMs);
  if (result) {
    logInfo(`[subagent-sync] Got fallback result for ${childSessionID} (${Date.now() - startTime}ms)`);
    return result;
  }
  logInfo(`[subagent-sync] Child ${childSessionID} idle but no assistant response found`);
  return null;
}
async function extractAssistantResponse(deps, childSessionID, notBeforeMs) {
  try {
    const msgs = await deps.ctx.client.session.messages({
      path: { id: childSessionID },
      query: { directory: deps.ctx.directory }
    });
    if (!msgs.data || msgs.data.length === 0)
      return null;
    const lastAssistant = [...msgs.data].reverse().find((m) => {
      if (m.info?.role !== "assistant")
        return false;
      if (notBeforeMs === undefined)
        return true;
      const time = m.info.time;
      const createdAt = typeof time?.created === "number" ? time.created : typeof time?.created === "string" ? Date.parse(time.created) : NaN;
      return Number.isFinite(createdAt) && createdAt >= notBeforeMs;
    });
    if (!lastAssistant?.parts)
      return null;
    const textParts = lastAssistant.parts.filter((p) => p.type === "text" && p.text).map((p) => p.text);
    if (textParts.length === 0)
      return null;
    return textParts.join("");
  } catch (err) {
    logInfo(`[subagent-sync] Error reading child messages: ${err}`);
    return null;
  }
}
var TASK_ID_REGEX;
var init_subagent_result_sync = __esm(() => {
  init_logger();
  TASK_ID_REGEX = /["']?(?:task_id|sessionID|sessionId)["']?\s*:\s*["']?(ses_[a-zA-Z0-9]+)/;
});

// node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += `
`;
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "\t";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += `
`;
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
var init_scanner = __esm(() => {
  (function(CharacterCodes2) {
    CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
    CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
    CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
    CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
    CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
    CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
    CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
    CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
    CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
    CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
    CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
    CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
    CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
    CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
    CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
    CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
    CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
    CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
    CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
    CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
    CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
    CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
    CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
    CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
    CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
    CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
    CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
    CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
    CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
    CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
    CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
    CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
    CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
    CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
    CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
    CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
    CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
    CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
    CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
    CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
    CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
    CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
    CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
    CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
    CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
    CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
    CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
    CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
    CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
    CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
    CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
    CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
    CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
    CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
    CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
    CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
    CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
    CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
    CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
    CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
    CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
    CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
    CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
    CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
    CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
    CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
    CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
    CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
    CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
    CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
    CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
    CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
    CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
    CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
    CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
    CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
    CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
    CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
    CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
    CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
  })(CharacterCodes || (CharacterCodes = {}));
});

// node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces, maxCachedValues = 200, cachedBreakLinesWithSpaces;
var init_string_intern = __esm(() => {
  cachedSpaces = new Array(20).fill(0).map((_, index) => {
    return " ".repeat(index);
  });
  cachedBreakLinesWithSpaces = {
    " ": {
      "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
        return `
` + " ".repeat(index);
      }),
      "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
        return "\r" + " ".repeat(index);
      }),
      "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
        return `\r
` + " ".repeat(index);
      })
    },
    "\t": {
      "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
        return `
` + "\t".repeat(index);
      }),
      "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
        return "\r" + "\t".repeat(index);
      }),
      "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
        return `\r
` + "\t".repeat(index);
      })
    }
  };
});

// node_modules/jsonc-parser/lib/esm/impl/format.js
var init_format = __esm(() => {
  init_scanner();
  init_string_intern();
});

// node_modules/jsonc-parser/lib/esm/impl/parser.js
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(14);
          break;
        case 5:
          handleError(15);
          break;
        case 3:
          handleError(13);
          break;
        case 1:
          if (!disallowComments) {
            handleError(11);
          }
          break;
        case 2:
          handleError(12);
          break;
        case 6:
          handleError(16);
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(10);
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(1);
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(2);
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [2, 5]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [2, 5]);
      }
    } else {
      handleError(5, [], [2, 5]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [2, 5]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [2], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [4, 5]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [4], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
var ParseOptions;
var init_parser = __esm(() => {
  init_scanner();
  (function(ParseOptions2) {
    ParseOptions2.DEFAULT = {
      allowTrailingComma: false
    };
  })(ParseOptions || (ParseOptions = {}));
});

// node_modules/jsonc-parser/lib/esm/impl/edit.js
var init_edit = __esm(() => {
  init_format();
  init_parser();
});

// node_modules/jsonc-parser/lib/esm/main.js
var ScanError, SyntaxKind, parse2, ParseErrorCode;
var init_main = __esm(() => {
  init_format();
  init_edit();
  init_scanner();
  init_parser();
  (function(ScanError2) {
    ScanError2[ScanError2["None"] = 0] = "None";
    ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
    ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
    ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
    ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
    ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
    ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
  })(ScanError || (ScanError = {}));
  (function(SyntaxKind2) {
    SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
    SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
    SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
    SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
    SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
    SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
    SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
    SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
    SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
    SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
    SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
    SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
    SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
    SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
    SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
    SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
    SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
  })(SyntaxKind || (SyntaxKind = {}));
  parse2 = parse;
  (function(ParseErrorCode2) {
    ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
    ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
    ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
    ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
    ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
    ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
    ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
    ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
    ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
    ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
    ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
    ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
    ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
    ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
    ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
    ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
  })(ParseErrorCode || (ParseErrorCode = {}));
});

// plugin-config.ts
import { readFileSync, existsSync } from "fs";
import { join as join2 } from "path";
function loadPluginConfig(directory) {
  const paths = [
    join2(directory, ".opencode", "opencode-fallback.jsonc"),
    join2(directory, ".opencode", "opencode-fallback.json"),
    join2(process.env.HOME || "", ".config", "opencode", "opencode-fallback.jsonc"),
    join2(process.env.HOME || "", ".config", "opencode", "opencode-fallback.json")
  ];
  for (const path of paths) {
    if (!existsSync(path))
      continue;
    try {
      return parse2(readFileSync(path, "utf-8"));
    } catch (error) {
      logInfo(`[${PLUGIN_NAME}] Failed to parse config: ${path}`, { error: String(error) });
    }
  }
  return {};
}
var init_plugin_config = __esm(() => {
  init_main();
  init_logger();
  init_constants();
});

// foreground-task.ts
import { tool } from "@opencode-ai/plugin";
function createForegroundTask(deps) {
  const owners = new Map;
  const client = deps.ctx.client;
  const query = { directory: deps.ctx.directory };
  const definition = {
    description: "Launch a foreground subagent and wait for its result, transparently switching to configured fallback models on retryable failures. Background execution is not supported by this task replacement.",
    args: {
      description: tool.schema.string().describe("A short (3-5 words) description of the task"),
      prompt: tool.schema.string().describe("The task for the agent to perform"),
      subagent_type: tool.schema.string().describe("The type of specialized agent to use"),
      task_id: tool.schema.string().optional().describe("Existing child session to resume"),
      command: tool.schema.string().optional(),
      background: tool.schema.boolean().optional()
    },
    async execute(args, context) {
      if (args.background)
        throw new Error("foreground_task_fallback supports foreground tasks only");
      context.abort.throwIfAborted();
      await context.ask({
        permission: "task",
        patterns: [args.subagent_type],
        always: ["*"],
        metadata: { description: args.description, subagent_type: args.subagent_type }
      });
      const agents = await client.app.agents({ query, throwOnError: true });
      const agent = agents.data?.find((item) => item.name === args.subagent_type);
      if (!agent || agent.mode === "primary")
        throw new Error(`Unknown subagent: ${args.subagent_type}`);
      if (!Array.isArray(agent.permission))
        throw new Error("foreground_task_fallback requires a modern OpenCode permission ruleset");
      const parent = (await client.session.get({ path: { id: context.sessionID }, query, throwOnError: true })).data;
      let ancestor = parent;
      let depth = 0;
      while (ancestor.parentID) {
        depth++;
        ancestor = (await client.session.get({ path: { id: ancestor.parentID }, query, throwOnError: true })).data;
      }
      if (depth >= maxDepth)
        throw new Error(`Subagent depth limit reached (${maxDepth})`);
      const messages = (await client.session.messages({ path: { id: context.sessionID }, query, throwOnError: true })).data ?? [];
      const parentMessage = messages.find((message) => message.info.id === context.messageID)?.info;
      const inheritedModel = parentMessage?.role === "assistant" ? { providerID: parentMessage.providerID, modelID: parentMessage.modelID } : undefined;
      const initial = agent.model ?? inheritedModel;
      if (!initial)
        throw new Error("Cannot resolve subagent model");
      const permission = [
        ...(parent.permission ?? []).filter((rule) => rule.action === "deny" || rule.permission === "external_directory"),
        ...["task", "todowrite"].filter((name) => !agent.permission.some((rule) => rule.permission === name)).map((name) => ({ permission: name, pattern: "*", action: "deny" })),
        ...primaryTools.map((name) => ({ permission: name, pattern: "*", action: "deny" }))
      ];
      const child = args.task_id ? (await client.session.get({ path: { id: args.task_id }, query, throwOnError: true })).data : (await client.session.create({ query, body: { parentID: context.sessionID, title: `${args.description} (@${agent.name} subagent)`, permission }, throwOnError: true })).data;
      if (child.parentID !== context.sessionID)
        throw new Error("Cannot resume a task belonging to another parent");
      const previousMessageIDs = args.task_id ? new Set(((await client.session.messages({ path: { id: child.id }, query, throwOnError: true })).data ?? []).map((message) => message.info.id)) : new Set;
      if (owners.has(child.id))
        throw new Error("Task is already running");
      context.abort.throwIfAborted();
      const state = createFallbackState(`${initial.providerID}/${initial.modelID}`);
      const models = getFallbackModelsForSession(child.id, agent.name, deps.agentConfigs, deps.globalFallbackModels);
      logInfo("Foreground task fallback candidates captured", {
        childSession: child.id,
        parentSession: context.sessionID,
        agent: agent.name,
        currentModel: state.currentModel,
        fallbackModels: models
      });
      const blockedProviders = new Set;
      let taskPromptSaved = false;
      let lastError;
      try {
        while (true) {
          context.abort.throwIfAborted();
          const [providerID, ...modelParts] = state.currentModel.split("/");
          const model = { providerID, modelID: modelParts.join("/") };
          const metadata = { parentSessionId: context.sessionID, sessionId: child.id, model };
          context.metadata({ title: args.description, metadata });
          let wake;
          const signal = new Promise((resolve) => {
            wake = resolve;
          });
          let timer;
          const activity = () => {
            clearTimeout(timer);
            timer = undefined;
          };
          owners.set(child.id, {
            activity,
            signal(value) {
              if (value.type === "cancel" || nextPlan(value.error).success)
                wake(value);
              else
                activity();
            }
          });
          const onAbort = () => wake({ type: "cancel" });
          context.abort.addEventListener("abort", onAbort, { once: true });
          if (context.abort.aborted)
            onAbort();
          if (deps.config.timeout_seconds > 0) {
            timer = setTimeout(() => wake({ type: "retry", error: new Error("Subagent time-to-first-token timeout") }), deps.config.timeout_seconds * 1000);
          }
          const request = client.session.prompt({
            path: { id: child.id },
            query,
            throwOnError: true,
            body: { agent: agent.name, model, parts: [{ type: "text", text: taskPromptSaved ? FALLBACK_CONTINUATION_PROMPT : args.prompt }] }
          }).then((result) => ({ type: "result", result }), (error) => ({ type: "error", error }));
          try {
            const outcome = await Promise.race([request, signal]);
            if (outcome.type === "retry" || outcome.type === "cancel") {
              await client.session.abort({ path: { id: child.id }, query, throwOnError: true });
              await request;
              context.abort.throwIfAborted();
              if (outcome.type === "cancel")
                throw new Error("Task cancelled");
              lastError = outcome.error;
            } else if (outcome.type === "error") {
              lastError = outcome.error;
              if (!isRetryableError(lastError, deps.config.retry_on_errors, deps.config.retryable_error_patterns))
                throw lastError;
            } else {
              context.abort.throwIfAborted();
              const result = outcome.result.data;
              if (!result)
                throw new Error("Subagent prompt returned no result");
              lastError = result.info.error;
              if (!lastError) {
                const text = result.parts.filter((part) => part.type === "text").map((part) => part.text).join(`
`);
                if (!text.trim())
                  throw new Error("Subagent returned no text result");
                return {
                  title: args.description,
                  output: `task_id: ${child.id}

<task_result>
${text}
</task_result>`,
                  metadata
                };
              }
              if (!isRetryableError(lastError, deps.config.retry_on_errors, deps.config.retryable_error_patterns))
                throw new Error(JSON.stringify(lastError));
            }
          } finally {
            activity();
            context.abort.removeEventListener("abort", onAbort);
          }
          const plan = nextPlan(lastError);
          if (!plan.success)
            throw new Error(`Subagent failed (task_id: ${child.id}): ${plan.error}; ${JSON.stringify(lastError)}`);
          if (!taskPromptSaved) {
            const history = await client.session.messages({ path: { id: child.id }, query, throwOnError: true });
            taskPromptSaved = history.data?.some((message) => !previousMessageIDs.has(message.info.id) && message.info.role === "user" && message.parts?.some((part) => part.type === "text" && part.text === args.prompt)) ?? false;
          }
          commitFallback(state, plan);
          logInfo("Foreground task switching model while retaining parent promise", { childSession: child.id, model: state.currentModel });
          if (deps.config.notify_on_fallback) {
            await deps.ctx.client.tui.showToast({ body: { title: "Subagent Fallback", message: `${plan.failedModel} \u2192 ${plan.newModel}`, variant: "warning", duration: 5000 } }).catch(() => {});
          }
        }
      } finally {
        owners.delete(child.id);
      }
      function nextPlan(error) {
        const providerWide = isProviderWideRateLimitError(error);
        if (providerWide)
          blockedProviders.add(state.currentModel.split("/")[0]);
        logInfo("Foreground task rate-limit scope and candidate filtering", {
          childSession: child.id,
          agent: args.subagent_type,
          currentModel: state.currentModel,
          errorMessage: getErrorMessage(error),
          providerWide,
          blockedProviders: [...blockedProviders],
          fallbackModels: models
        });
        return planFallback(child.id, state, models.map((model) => blockedProviders.has(model.split("/")[0]) ? state.currentModel : model), deps.config);
      }
    }
  };
  let maxDepth = 1;
  let primaryTools = [];
  return {
    tool: definition,
    owns: (id) => owners.has(id),
    configure(config) {
      if (typeof config.subagent_depth === "number")
        maxDepth = config.subagent_depth;
      const experimental = config.experimental;
      primaryTools = experimental?.primary_tools ?? [];
    },
    handleEvent(event) {
      const props = event.properties;
      const id = props?.sessionID ?? props?.info?.sessionID ?? props?.part?.sessionID ?? (event.type.startsWith("session.") ? props?.info?.id : undefined);
      const owner = owners.get(id);
      if (!owner)
        return false;
      if (event.type === "session.status" && props?.status?.type === "retry")
        owner.signal({ type: "retry", error: { message: props.status.message } });
      if (event.type === "session.stop" || event.type === "session.deleted")
        owner.signal({ type: "cancel" });
      if (event.type === "message.part.delta" && props?.delta?.length)
        owner.activity();
      if (event.type === "message.part.updated" && (props?.part?.type === "tool" || props?.part?.text?.length))
        owner.activity();
      return true;
    }
  };
}
var init_foreground_task = __esm(() => {
  init_config_reader();
  init_fallback_state();
  init_error_classifier();
  init_logger();
});

// v1.ts
var exports_v1 = {};
__export(exports_v1, {
  hasConcreteAssistantActivity: () => hasConcreteAssistantActivity,
  default: () => OpenCodeFallbackPlugin
});
import { randomUUID } from "crypto";
function summarizeAgentFallbackConfig(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return Object.fromEntries(Object.entries(value).flatMap(([name, config]) => {
    if (typeof config !== "object" || config === null || Array.isArray(config))
      return [];
    const agent = config;
    if (agent.model === undefined && agent.fallback_models === undefined)
      return [];
    return [[name, { model: agent.model, fallback_models: agent.fallback_models }]];
  }));
}
async function OpenCodeFallbackPlugin(ctx, configOverrides) {
  const instanceContext = {
    instanceID: randomUUID(),
    buildID,
    moduleURL: import.meta.url,
    directory: ctx.directory,
    processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()
  };
  let configRevision = 0;
  let agentConfigs;
  let fileConfig = loadPluginConfig(ctx.directory);
  let mergedConfig;
  const globalFallbackModels = normalizeFallbackModelsField(configOverrides?.fallback_models ?? fileConfig.fallback_models);
  const getConfig = () => {
    mergedConfig ??= {
      enabled: configOverrides?.enabled ?? fileConfig?.enabled ?? DEFAULT_CONFIG.enabled,
      retry_on_errors: configOverrides?.retry_on_errors ?? fileConfig?.retry_on_errors ?? DEFAULT_CONFIG.retry_on_errors,
      retryable_error_patterns: configOverrides?.retryable_error_patterns ?? fileConfig?.retryable_error_patterns ?? DEFAULT_CONFIG.retryable_error_patterns,
      max_fallback_attempts: configOverrides?.max_fallback_attempts ?? fileConfig?.max_fallback_attempts ?? DEFAULT_CONFIG.max_fallback_attempts,
      cooldown_seconds: configOverrides?.cooldown_seconds ?? fileConfig?.cooldown_seconds ?? DEFAULT_CONFIG.cooldown_seconds,
      timeout_seconds: configOverrides?.timeout_seconds ?? fileConfig?.timeout_seconds ?? DEFAULT_CONFIG.timeout_seconds,
      notify_on_fallback: configOverrides?.notify_on_fallback ?? fileConfig?.notify_on_fallback ?? DEFAULT_CONFIG.notify_on_fallback,
      fallback_models: configOverrides?.fallback_models ?? fileConfig?.fallback_models ?? DEFAULT_CONFIG.fallback_models,
      foreground_task_fallback: configOverrides?.foreground_task_fallback ?? fileConfig?.foreground_task_fallback ?? DEFAULT_CONFIG.foreground_task_fallback,
      compaction_fallback: configOverrides?.compaction_fallback ?? fileConfig?.compaction_fallback ?? DEFAULT_CONFIG.compaction_fallback
    };
    return mergedConfig;
  };
  const deps = {
    ctx,
    get config() {
      return getConfig();
    },
    get agentConfigs() {
      return agentConfigs;
    },
    globalFallbackModels,
    sessionStates: new Map,
    sessionLastAccess: new Map,
    sessionRetryInFlight: new Set,
    sessionAwaitingFallbackResult: new Set,
    sessionFallbackTimeouts: new Map,
    sessionFirstTokenReceived: new Map,
    sessionSelfAbortTimestamp: new Map,
    sessionParentID: new Map,
    sessionIdleResolvers: new Map,
    sessionLastMessageTime: new Map,
    sessionCompactionInFlight: new Set,
    sessionProviderRetrying: new Set
  };
  const helpers = createAutoRetryHelpers(deps);
  const { handleEvent: baseEventHandler, handleActivity } = createEventHandler(deps, helpers);
  const messageUpdateHandler = createMessageUpdateHandler(deps, helpers);
  const chatMessageHandler = createChatMessageHandler(deps, helpers);
  const foregroundTask = createForegroundTask(deps);
  const cleanupInterval = setInterval(helpers.cleanupStaleSessions, 5 * 60 * 1000);
  cleanupInterval.unref();
  withLogContext(instanceContext, () => logInfo(`Plugin initialized (${globalFallbackModels.length} global fallback model(s) configured)`, {
    foregroundTaskFallback: deps.config.foreground_task_fallback
  }));
  const hooks = {
    name: PLUGIN_NAME,
    ...deps.config.enabled && deps.config.foreground_task_fallback ? { tool: { task: foregroundTask.tool } } : {},
    config: (opencodeConfig) => {
      configRevision++;
      foregroundTask.configure(opencodeConfig);
      const agentsValue = opencodeConfig.agents;
      const agentValue = opencodeConfig.agent;
      agentConfigs = mergeAgentConfigs(agentsValue, agentValue);
      logInfo(`Plugin initialized with ${agentConfigs ? Object.keys(agentConfigs).length : 0} agents`, {
        configRevision,
        pluralFallbackConfig: summarizeAgentFallbackConfig(agentsValue),
        singularFallbackConfig: summarizeAgentFallbackConfig(agentValue),
        mergedFallbackConfig: summarizeAgentFallbackConfig(agentConfigs)
      });
    },
    event: async ({
      event
    }) => {
      const props = event.properties;
      if (event.type === "session.created" || event.type === "session.error" || event.type === "session.status" && props?.status?.type === "retry") {
        logInfo("Fallback event routed to plugin instance", {
          eventType: event.type,
          sessionID: props?.sessionID ?? props?.info?.id,
          configRevision,
          ownedForegroundTask: foregroundTask.owns(props?.sessionID ?? props?.info?.id),
          agentFallbackConfig: summarizeAgentFallbackConfig(agentConfigs)
        });
      }
      if (foregroundTask.handleEvent(event))
        return;
      if (event.type === "message.updated") {
        if (!deps.config.enabled)
          return;
        const props2 = event.properties;
        await messageUpdateHandler(props2);
        return;
      }
      if (hasConcreteAssistantActivity(event.type, event.properties)) {
        const props2 = event.properties;
        const info = props2?.info;
        const sessionID = props2?.sessionID ?? info?.sessionID ?? info?.id;
        const activityModel = info?.model ?? (typeof info?.providerID === "string" && typeof info?.modelID === "string" ? `${info.providerID}/${info.modelID}` : undefined) ?? props2?.model;
        if (sessionID) {
          await handleActivity(sessionID, activityModel);
        }
      }
      await baseEventHandler({ event });
    },
    "tool.execute.after": async (input, output) => {
      if (!output)
        return;
      const isEmptyResult = isEmptyTaskResult(output.output);
      const isCancelledResult = isCancelledTaskResult(output.output, output.metadata);
      if (input.tool !== "task" || !isEmptyResult && !isCancelledResult) {
        return;
      }
      const childSessionID = extractChildSessionID(output.output) ?? extractChildSessionID(serializeMetadata(output.metadata));
      if (!childSessionID) {
        logInfo("Task result needs fallback sync but no child session ID found", {
          sessionID: input.sessionID,
          outputPreview: output.output?.substring(0, 200)
        });
        return;
      }
      const bridgeStartedAt = helpers.claimChildFallbackBridge(childSessionID, input.sessionID);
      if (isCancelledResult && bridgeStartedAt === undefined && !deps.sessionAwaitingFallbackResult.has(childSessionID) && !deps.sessionRetryInFlight.has(childSessionID) && !deps.sessionStates.get(childSessionID)?.pendingFallbackModel) {
        logInfo("Ignoring cancelled task without active fallback", {
          parentSession: input.sessionID,
          childSession: childSessionID
        });
        return;
      }
      if (isEmptyResult && !deps.sessionRetryInFlight.has(childSessionID)) {
        logInfo("Empty task result has no active fallback; dispatching child fallback", {
          parentSession: input.sessionID,
          childSession: childSessionID
        });
        const taskAgent = typeof input.args?.subagent_type === "string" ? input.args.subagent_type : undefined;
        await helpers.retryEmptyChildTask(childSessionID, taskAgent);
      }
      logInfo("Detected task result requiring fallback sync, waiting for child fallback", {
        parentSession: input.sessionID,
        childSession: childSessionID
      });
      const maxWaitMs = Math.min((deps.config.timeout_seconds || 120) * 1000, 120000);
      try {
        const replacementText = await waitForChildFallbackResult(deps, childSessionID, {
          maxWaitMs,
          pollIntervalMs: 500,
          notBeforeMs: bridgeStartedAt
        });
        if (replacementText) {
          output.output = replacementText;
          logInfo("Replaced task result with fallback response", {
            parentSession: input.sessionID,
            childSession: childSessionID,
            responseLength: replacementText.length
          });
        } else {
          logInfo("No fallback response available, preserving original output", {
            parentSession: input.sessionID,
            childSession: childSessionID
          });
        }
      } finally {
        helpers.clearChildFallbackBridge(childSessionID);
      }
    },
    "chat.message": async (input, output) => {
      if (foregroundTask.owns(input.sessionID))
        return;
      await chatMessageHandler(input, output);
    }
  };
  const tracedHooks = Object.fromEntries(Object.entries(hooks).map(([name, hook]) => [
    name,
    typeof hook === "function" ? (...args) => withLogContext(instanceContext, () => hook(...args)) : hook
  ]));
  if (tracedHooks.tool) {
    const execute = foregroundTask.tool.execute;
    tracedHooks.tool = { task: {
      ...foregroundTask.tool,
      execute: (...args) => withLogContext(instanceContext, () => execute(...args))
    } };
  }
  return tracedHooks;
}
function hasConcreteAssistantActivity(type, properties) {
  const props = properties;
  if (type === "message.part.delta") {
    const field = props?.field;
    return (field === "text" || field === "reasoning") && typeof props?.delta === "string" && props.delta.length > 0;
  }
  if (type !== "message.part.updated")
    return false;
  const part = props?.part;
  if (!part)
    return false;
  if (part.type === "tool")
    return true;
  return (part.type === "text" || part.type === "reasoning") && typeof part.text === "string" && part.text.length > 0;
}
function serializeMetadata(metadata) {
  if (typeof metadata === "string")
    return metadata;
  try {
    return JSON.stringify(metadata) ?? "";
  } catch {
    return "";
  }
}
var buildID = "2026-11-17T20:31:43.868Z";
var init_v1 = __esm(() => {
  init_constants();
  init_auto_retry();
  init_event_handler();
  init_message_update_handler();
  init_chat_message_handler();
  init_config_reader();
  init_subagent_result_sync();
  init_plugin_config();
  init_logger();
  init_foreground_task();
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

// v2.ts
init_constants();
init_plugin_config();
init_config_reader();
init_fallback_state();
init_error_classifier();
init_logger();
import { setTimeout as sleep } from "timers/promises";

// v2-background-task.ts
init_logger();
var BACKGROUND_RUNTIME = Object.freeze({ revision: "final-outcome-v2", moduleID: crypto.randomUUID() });
var RECOVERY_TIMING = { pollMs: 1000, graceMs: 30000 };
var MAX_DELIVERY_FAILURES = 5;
var REGISTRY = Symbol.for("opencode-fallback.v2.background-jobs");
function managerFor(ctx) {
  const registry = globalThis;
  const managers = registry[REGISTRY] ??= new Map;
  const key = JSON.stringify([ctx.location.directory, ctx.location.workspaceID ?? null]);
  let manager = managers.get(key);
  if (!manager) {
    manager = { waiters: new Set };
    managers.set(key, manager);
  }
  return manager;
}
function wake(manager) {
  const waiters = [...manager.waiters];
  manager.waiters.clear();
  for (const resolve of waiters)
    resolve();
}
async function currentLease(manager) {
  for (;; ) {
    const lease = manager.lease;
    if (lease?.active)
      return lease;
    await new Promise((resolve) => manager.waiters.add(resolve));
  }
}
function createBackgroundLease(ctx, coordination) {
  const manager = managerFor(ctx);
  manager.lease?.end();
  let endLease;
  const ended = new Promise((resolve) => {
    endLease = resolve;
  });
  const lease = {
    ctx,
    coordination,
    active: true,
    ended,
    end() {
      lease.active = false;
      endLease();
    }
  };
  manager.lease = lease;
  wake(manager);
  return () => {
    if (manager.lease === lease)
      manager.lease = undefined;
    lease.end();
  };
}
async function startBackgroundSubagent(ctx, coordination, native, input, context) {
  const manager = managerFor(ctx);
  const origin = manager.lease;
  const detached = new AbortController;
  let childSessionID;
  let handedOff = false;
  let resolveStarted;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  const nativeRun = native.execute({ ...input, background: false }, {
    ...context,
    signal: detached.signal,
    async progress(update) {
      if (typeof update.sessionID === "string" && !childSessionID) {
        childSessionID = update.sessionID;
        resolveStarted(update.sessionID);
      }
      if (!handedOff && !context.signal.aborted)
        await context.progress(update);
    }
  });
  nativeRun.catch(() => {});
  const settled = nativeRun.then(() => {
    return;
  }, () => {
    return;
  });
  let onParentAbort = () => {};
  const parentAborted = new Promise((resolve) => {
    onParentAbort = () => resolve("aborted");
  });
  if (context.signal.aborted)
    onParentAbort();
  else
    context.signal.addEventListener("abort", onParentAbort, { once: true });
  const handoff = await Promise.race([
    started.then((sessionID) => ({ kind: "started", sessionID })),
    settled.then(() => ({ kind: "settled" })),
    parentAborted.then(() => ({ kind: "aborted" }))
  ]);
  context.signal.removeEventListener("abort", onParentAbort);
  if (handoff.kind === "settled")
    return nativeRun;
  if (handoff.kind === "aborted" || context.signal.aborted) {
    detached.abort();
    await settled;
    if (childSessionID)
      cancelChild(ctx, coordination, childSessionID);
    const failure = await nativeRun.then(() => {
      return;
    }, (error) => ({ error }));
    if (failure)
      throw failure.error;
    throw new DOMException("Subagent cancelled", "AbortError");
  }
  handedOff = true;
  const child = handoff.sessionID;
  const description = stringField(input, "description");
  const agent = stringField(input, "agent") ?? null;
  const notificationID = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
  deliverOutcome(manager, { parentID: context.sessionID, nativeRun, child, detached, description, agent, notificationID, origin });
  const attrs = `sessionID="${child}" state="running" description="${escapeXMLAttribute(description ?? "")}"`;
  return {
    output: { sessionID: child, status: "running", output: "" },
    content: `<subagent ${attrs}>
Running in background.
</subagent>`,
    metadata: { sessionID: child, status: "running" }
  };
}
function escapeXMLAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
async function readV2ForegroundSubagentOutput(ctx, sessionID) {
  const messages = await ctx.session.context({ sessionID });
  for (const message of [...messages].reverse()) {
    if (message.type !== "assistant")
      continue;
    if (message.error)
      return;
    const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join(`
`);
    return text.trim() ? text : undefined;
  }
  return;
}
function stringField(input, key) {
  const value = input?.[key];
  return typeof value === "string" ? value : undefined;
}
function cancelChild(ctx, coordination, child) {
  coordination.cancelFallback(child);
  ctx.session.interrupt({ sessionID: child, resume: false }).catch(() => {});
}
function isNativeCancellation(error) {
  if (error instanceof DOMException && error.name === "AbortError")
    return true;
  return error instanceof Error && /^Subagent cancelled\b/.test(error.message);
}
async function deliverOutcome(manager, options) {
  const { parentID, nativeRun, child, detached, description, agent, notificationID } = options;
  try {
    const finished = await finalOutcome(manager, nativeRun, child, detached.signal, options.origin);
    if (!finished)
      return;
    const state = finished.state;
    const body = finished.state === "completed" ? finished.output : finished.state === "error" ? finished.message : "Subagent cancelled.";
    const attrs = `sessionID="${child}" state="${state}" description="${escapeXMLAttribute(description ?? "")}"`;
    await deliver(manager, {
      sessionID: parentID,
      id: notificationID,
      text: `<subagent ${attrs}>
${body}
</subagent>`,
      ...description !== undefined ? { description } : {},
      metadata: { source: "subagent", childID: child, agent, state, "opencode-fallback": true },
      resume: true
    });
  } catch (error) {
    logError("V2 background subagent notification failed", { sessionID: child, error: String(error) });
  }
}
async function deliver(manager, input) {
  let liveFailures = 0;
  for (;; ) {
    const lease = await currentLease(manager);
    try {
      await lease.ctx.session.synthetic(input);
      return;
    } catch (error) {
      if (error?._tag === "ConflictError")
        return;
      if (!lease.active)
        continue;
      liveFailures++;
      if (liveFailures >= MAX_DELIVERY_FAILURES)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, RECOVERY_TIMING.pollMs));
    }
  }
}
async function finalOutcome(manager, nativeRun, child, signal, origin) {
  let nativeError;
  try {
    const native = await nativeRun;
    if (native?.output?.status === "running")
      return;
    return { state: "completed", output: native?.output?.output ?? "" };
  } catch (error) {
    nativeError = error;
  }
  const message = nativeError instanceof Error ? nativeError.message : String(nativeError);
  const active = manager.lease?.active ? manager.lease : undefined;
  if (active?.coordination.isCancelled?.(child))
    return { state: "cancelled" };
  if (active && active === origin && !active.coordination.ownsFallback(child)) {
    return isNativeCancellation(nativeError) ? { state: "cancelled" } : { state: "error", message };
  }
  return recoverChild(manager, child, signal, message);
}
async function recoverChild(manager, child, signal, message) {
  let lease = await currentLease(manager);
  let observed;
  let observedAt = 0;
  for (;; ) {
    if (signal.aborted)
      return { state: "cancelled" };
    if (lease.coordination.ownsFallback(child)) {
      let output;
      try {
        output = await Promise.race([
          lease.coordination.waitForFallback(child, signal),
          lease.ended.then(() => {
            return;
          })
        ]);
      } catch (error) {
        if (!lease.active) {
          lease = await currentLease(manager);
          continue;
        }
        return lease.coordination.isCancelled?.(child) ? { state: "cancelled" } : { state: "error", message };
      }
      if (signal.aborted)
        return { state: "cancelled" };
      if (!lease.active) {
        lease = await currentLease(manager);
        continue;
      }
      if (!output?.trim())
        return lease.coordination.isCancelled?.(child) ? { state: "cancelled" } : { state: "error", message };
      return { state: "completed", output };
    }
    try {
      const info = await lease.ctx.session.get({ sessionID: child });
      if (info.time.idle === undefined) {
        observed = undefined;
      } else if (info.outcome === "succeeded") {
        const output = await readV2ForegroundSubagentOutput(lease.ctx, child);
        return output?.trim() ? { state: "completed", output } : { state: "error", message: "Subagent completed without output." };
      } else if (info.outcome === "failed" || info.outcome === "interrupted") {
        const mark = `${info.outcome}:${info.time.updated}:${info.time.idle}`;
        const now = Date.now();
        if (mark !== observed) {
          observed = mark;
          observedAt = now;
        } else if (now - observedAt >= RECOVERY_TIMING.graceMs) {
          return info.outcome === "failed" ? { state: "error", message } : { state: "cancelled" };
        }
      }
    } catch (error) {
      if (!lease.active) {
        lease = await currentLease(manager);
        observed = undefined;
        continue;
      }
      logError("V2 background recovery poll failed", { sessionID: child, error: String(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, RECOVERY_TIMING.pollMs));
    if (!lease.active) {
      lease = await currentLease(manager);
      observed = undefined;
    }
  }
}

// v2-foreground-task.ts
async function installV2ForegroundTaskFallback(ctx, coordination) {
  let disposed = false;
  const releaseLease = createBackgroundLease(ctx, coordination);
  const registration = await ctx.tool.transform((editor) => {
    const nativeSubagent = editor.list().find((tool2) => tool2.name === "subagent" || tool2.id === "subagent");
    if (!nativeSubagent)
      return;
    editor.update(nativeSubagent.id, (tool2) => {
      const native = tool2;
      const execute = native.execute;
      native.execute = async (input, context) => {
        if (input?.background === true) {
          return startBackgroundSubagent(ctx, coordination, { execute }, input, context);
        }
        let childSessionID;
        const wrappedContext = {
          ...context,
          async progress(update) {
            if (typeof update.sessionID === "string")
              childSessionID = update.sessionID;
            await context.progress(update);
          }
        };
        try {
          return await execute(input, wrappedContext);
        } catch (error) {
          if (!childSessionID || !coordination.ownsFallback(childSessionID))
            throw error;
          const child = childSessionID;
          const cancelChild2 = () => {
            coordination.cancelFallback(child);
            ctx.session.interrupt({ sessionID: child, resume: false }).catch(() => {});
          };
          if (context.signal.aborted) {
            cancelChild2();
            throw error;
          }
          let output;
          context.signal.addEventListener("abort", cancelChild2, { once: true });
          try {
            output = await coordination.waitForFallback(childSessionID, context.signal);
          } catch {
            throw error;
          } finally {
            context.signal.removeEventListener("abort", cancelChild2);
          }
          if (context.signal.aborted || !output?.trim())
            throw error;
          const result = { sessionID: childSessionID, status: "completed", output };
          return {
            output: result,
            content: `<subagent sessionID="${childSessionID}" state="completed">
${output}
</subagent>`,
            metadata: { sessionID: childSessionID, status: "completed" }
          };
        }
      };
    });
  });
  return {
    dispose: async () => {
      if (disposed)
        return;
      disposed = true;
      releaseLease();
      await registration.dispose();
    }
  };
}

// v2-notifications.ts
init_constants();
init_logger();
async function registerFallbackNotifications(ctx, options = ctx.options) {
  const noop = { notify: async () => {}, dispose: async () => {} };
  const enabled = options.notify_on_fallback ?? DEFAULT_CONFIG.notify_on_fallback;
  if (!enabled)
    return noop;
  let registration;
  try {
    registration = await ctx.rpc.register(fallbackRpc, {});
  } catch (error) {
    logError("V2 fallback notifications unavailable", { directory: ctx.location.directory, error: String(error) });
    return noop;
  }
  let disposed = false;
  const notify = async (input) => {
    if (disposed)
      return;
    try {
      await registration.events.emit("notification", {
        id: crypto.randomUUID(),
        directory: ctx.location.directory,
        ...ctx.location.workspaceID ? { workspaceID: ctx.location.workspaceID } : {},
        sessionID: input.sessionID,
        from: input.from,
        to: input.to,
        kind: input.kind
      });
      logInfo("V2 fallback notification emitted", { sessionID: input.sessionID, from: input.from, to: input.to, kind: input.kind });
    } catch (error) {
      logError("V2 fallback notification failed", { sessionID: input.sessionID, error: String(error) });
    }
  };
  const dispose = async () => {
    if (disposed)
      return;
    disposed = true;
    try {
      await registration.dispose();
    } catch (error) {
      logError("V2 fallback notification dispose failed", { error: String(error) });
    }
  };
  return { notify, dispose };
}

// v2-compaction.ts
init_constants();
init_fallback_state();
init_error_classifier();
init_logger();
var CHILD_PROMPT = "Produce the compaction summary.";
var SUMMARY_TEMPLATE = [
  "You MUST use this format for your response (you may omit sections that aren't applicable). Do not include the <template> tags in your response.",
  "<template>",
  "## Objective",
  "- [one or two brief sentences describing what the user is trying to accomplish]",
  "## Requirements",
  '- [constraints, preferences, requirements, and scope boundaries stated by the user, or "(none)"]',
  "## Decisions",
  '- [decisions already made and why, or "(none)"]',
  "## Work State",
  "Break the objective into smaller goals and report which are completed, which are being worked on, and which are blocked.",
  "### Completed",
  '- [goals that have been completed; otherwise "(none)"]',
  "### Active",
  '- [goals currently being worked on; otherwise "(none)"]',
  "### Blocked",
  '- [anything blocking progress, and why; otherwise "(none)"]',
  "## Next Move",
  '1. [ordered list of next actions, or "(none)"]',
  "## Relevant Files",
  'List the files and directories, other than the current working directory, that another agent would need to open to continue this work. Include at most 15, most important first. Do not list every file that was read or changed. Include paths outside the current working directory when relevant. If none, write "(none)".',
  "- `[file or directory path]`: [brief reason it matters]",
  "## Important Context",
  '- [facts the next agent cannot continue without and cannot easily find on its own; or "(none)"]',
  "</template>"
].join(`
`);
var SUMMARY_INSTRUCTION = [
  "You MUST summarize the conversation above into a structured summary that will be given to another agent to resume the work.",
  "If the conversation above contains an existing <conversation-checkpoint>, update that checkpoint into one consolidated summary instead of treating it as ordinary history. Newer history always takes precedence over the existing checkpoint. Preserve its information unless newer history clearly contradicts, supersedes, resolves, or makes it stale, and keep its requirements, decisions, and open questions. Incorporate newer requirements, decisions, progress, and context, and reconcile Work State and Next Move: move completed work out of Active, remove resolved blockers and answered questions, and preserve unresolved or pending work. Do not reproduce the <conversation-checkpoint>, <summary>, or <recent-context> wrapper tags.",
  "Summarize only what the user and the assistant said and did. Leave out instructions and setup the assistant was given rather than told by the user: repository conventions, instruction files such as AGENTS.md, and environment details like the session ID. The next agent receives current versions of all of these separately.",
  SUMMARY_TEMPLATE,
  "Rules:",
  "- Keep each section concise. Use terse, single-line bullets, not prose paragraphs or nested lists.",
  "- Prefer short references over detailed restatement. It is fine to leave out information the next agent can recover from the code or the files listed above.",
  "- Preserve concrete facts, goals, constraints, completed progress, pending work, critical context, file paths, and next steps.",
  "- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers.",
  "- Carry forward only user questions or requests that remain unanswered or require further action. Do not repeat ones that newer history has answered or resolved. Preserve exact wording when carrying one forward.",
  "- Preserve consequential workflow state, including whether changes are uncommitted, committed, pushed, under review, or merged.",
  "- Do not mention the summary process or that context was compacted.",
  "Do not continue the task or call tools.",
  "Return only the structured summary in the requested format. Do not include a preamble, explanation, or other commentary."
].join(`
`);
var REMOVED_CHILD_TTL_MS = 30000;
var DENY_ALL = [{ action: "*", resource: "*", effect: "deny" }];
var noop = () => {};
function modelName(model) {
  return `${model.providerID}/${model.id}${model.variant && model.variant !== "default" ? `#${model.variant}` : ""}`;
}
function parseModel(value) {
  const slash = value.indexOf("/");
  if (slash < 1 || slash === value.length - 1)
    throw new Error(`Invalid fallback model: ${value}`);
  const [id, variant] = value.slice(slash + 1).split("#");
  if (!id)
    throw new Error(`Invalid fallback model: ${value}`);
  return { providerID: value.slice(0, slash), id, ...variant ? { variant } : {} };
}
function createAttempt(model) {
  let stop;
  const stopped = new Promise((_, reject) => {
    stop = reject;
  });
  stopped.catch(noop);
  return { model, cancelled: false, timedOut: false, firstToken: false, stopped, stop: (error) => stop(error) };
}

class CompactionCancelled extends Error {
  constructor() {
    super("Compaction fallback cancelled");
  }
}
function cancellation() {
  return new CompactionCancelled;
}
function exhausted(cause) {
  return new Error(`Compaction fallback failed: ${getErrorMessage(cause)}`, { cause });
}
async function installV2CompactionFallback(ctx, options) {
  const { config } = options;
  const children = new Map;
  const removed = new Map;
  const runs = new Map;
  const active = new Set;
  const failures = new Map;
  const registrations = [];
  let disposed = false;
  const attemptFail = (attempt, error, timedOut = false) => {
    if (attempt.error !== undefined)
      return;
    attempt.error = error;
    attempt.timedOut = timedOut;
    attempt.stop(error);
  };
  const cancelAttempt = (attempt) => {
    attempt.cancelled = true;
    attemptFail(attempt, cancellation());
    if (attempt.child) {
      const child = attempt.child;
      ctx.session.interrupt({ sessionID: child, resume: false }).catch((error) => {
        if (!disposed)
          logError("V2 compaction child interrupt failed", { sessionID: child, error: String(error) });
      });
    }
  };
  const cancelRun = (run, mode) => {
    if (run.cancel === "hard" || run.cancel === mode)
      return;
    const first = run.cancel === undefined;
    run.cancel = mode;
    if (first && run.attempt)
      cancelAttempt(run.attempt);
  };
  const cancel = (sessionID) => {
    const run = runs.get(sessionID);
    if (run)
      cancelRun(run, "hard");
  };
  const cancelAll = () => {
    for (const run of runs.values())
      cancelRun(run, "soft");
  };
  const race = (attempt, promise) => Promise.race([promise, attempt.stopped]);
  const markFirstToken = (attempt) => {
    attempt.firstToken = true;
    clearTimeout(attempt.timer);
    attempt.timer = undefined;
  };
  const isInternal = (sessionID) => {
    if (children.has(sessionID))
      return true;
    const expires = removed.get(sessionID);
    if (expires === undefined)
      return false;
    if (expires > Date.now())
      return true;
    removed.delete(sessionID);
    return false;
  };
  const rememberRemoved = (sessionID) => {
    const now = Date.now();
    for (const [id, expires] of removed)
      if (expires <= now)
        removed.delete(id);
    removed.set(sessionID, now + REMOVED_CHILD_TTL_MS);
  };
  const discard = async (child, interrupt) => {
    if (interrupt) {
      try {
        await ctx.session.interrupt({ sessionID: child, resume: false });
      } catch (error) {
        if (!disposed)
          logError("V2 compaction child interrupt failed", { sessionID: child, error: String(error) });
      }
    }
    try {
      await ctx.session.remove({ sessionID: child });
    } catch (error) {
      if (!disposed)
        logError("V2 compaction child removal failed", { sessionID: child, error: String(error) });
    }
  };
  const armFirstTokenTimer = (attempt, parentID, state, chain) => {
    attempt.timer = setTimeout(() => {
      if (attempt.firstToken || attempt.cancelled || attempt.error !== undefined)
        return;
      if (!planFallback(parentID, state, chain, config).success)
        return;
      logInfo("V2 compaction first-token window expired", { sessionID: parentID, model: attempt.model });
      attemptFail(attempt, new Error(`First token timeout after ${config.timeout_seconds}s`), true);
    }, config.timeout_seconds * 1000);
    attempt.timer.unref?.();
  };
  async function runAttempt(parentID, run, parentAgent, model, snapshot, state, chain, from) {
    if (run.cancel !== undefined)
      throw cancellation();
    const attempt = createAttempt(model);
    run.attempt = attempt;
    let child;
    let record;
    let prompt;
    let succeeded = false;
    try {
      const admission = ctx.session.create({
        parentID,
        title: "Compaction fallback",
        agent: options.childAgent?.(parentAgent) ?? parentAgent,
        model: parseModel(model),
        location: { directory: ctx.location.directory },
        metadata: { [PLUGIN_NAME]: true, compaction: true },
        permissions: DENY_ALL
      });
      let created;
      try {
        created = await race(attempt, admission);
      } catch (error) {
        if (attempt.cancelled) {
          const orphan = await admission.then((session) => session.id, () => {
            return;
          });
          if (orphan) {
            rememberRemoved(orphan);
            await discard(orphan, true);
          }
        }
        throw error;
      }
      child = created.id;
      record = { attempt, snapshot, state, chain, original: model === state.originalModel, contextApplied: false };
      children.set(child, record);
      if (attempt.cancelled)
        throw cancellation();
      if (from !== undefined)
        notifyFallback(parentID, from, model);
      if (config.timeout_seconds > 0)
        armFirstTokenTimer(attempt, parentID, state, chain);
      prompt = ctx.session.prompt({
        sessionID: child,
        text: CHILD_PROMPT,
        resume: true,
        metadata: { [PLUGIN_NAME]: true }
      });
      await race(attempt, prompt);
      if (attempt.cancelled)
        throw cancellation();
      await race(attempt, ctx.session.wait({ sessionID: child }).catch((error) => {
        attemptFail(attempt, error);
      }));
      if (attempt.error !== undefined)
        return { ok: false, error: attempt.error, forceFallback: attempt.timedOut };
      if (!record.contextApplied) {
        return { ok: false, error: new Error("Compaction child was not scoped by the context hook"), forceFallback: true };
      }
      const messages = await race(attempt, ctx.session.context({ sessionID: child }));
      const assistant = [...messages].reverse().find((message) => message.type === "assistant");
      if (!assistant)
        return { ok: false, error: new Error("Compaction child produced no output"), forceFallback: true };
      if (assistant.error)
        return { ok: false, error: assistant.error, forceFallback: false };
      const summary = assistant.content.filter((part) => part.type === "text").map((part) => part.text).join(`
`).trim();
      if (!summary)
        return { ok: false, error: new Error("Compaction child produced an empty summary"), forceFallback: true };
      const providerState = model === state.originalModel ? assistant.providerState : undefined;
      succeeded = true;
      return {
        ok: true,
        result: {
          summary,
          ...providerState ? { providerState } : {},
          ...assistant.tokens ? { tokens: assistant.tokens } : {},
          metadata: { [PLUGIN_NAME]: true, model, fallback: model !== state.originalModel, chain: chain.length }
        }
      };
    } catch (error) {
      if (attempt.cancelled)
        throw cancellation();
      if (attempt.error !== undefined)
        return { ok: false, error: attempt.error, forceFallback: attempt.timedOut };
      return { ok: false, error, forceFallback: false };
    } finally {
      clearTimeout(attempt.timer);
      attempt.timer = undefined;
      run.attempt = undefined;
      if (prompt)
        await prompt.then(noop, noop);
      if (child) {
        await discard(child, !succeeded);
        children.delete(child);
        rememberRemoved(child);
      }
    }
  }
  const notifyFallback = (sessionID, from, to) => {
    logInfo("V2 compaction fallback admitted", { sessionID, from, to });
    Promise.resolve().then(() => options.notify?.({ sessionID, from, to, kind: "compaction" })).catch((error) => logError("V2 compaction notification failed", { error: String(error) }));
  };
  const execute = async (run, event, snapshot) => {
    const chain = await options.chain(event.agent);
    if (run.cancel !== undefined)
      throw cancellation();
    if (!chain.length)
      return;
    const state = createFallbackState(modelName(event.model));
    const stored = failures.get(event.sessionID);
    if (stored)
      state.failedModels = new Map(stored);
    let first;
    let previous;
    try {
      for (;; ) {
        const outcome = await runAttempt(event.sessionID, run, event.agent, state.currentModel, snapshot, state, chain, previous);
        if (run.cancel !== undefined)
          throw cancellation();
        if (outcome.ok) {
          event.result = outcome.result;
          return;
        }
        first ??= outcome.error;
        if (!outcome.forceFallback && !isRetryableError(outcome.error, config.retry_on_errors, config.retryable_error_patterns))
          throw exhausted(first);
        const blocked = isProviderWideRateLimitError(outcome.error) ? state.currentModel.split("/")[0] : undefined;
        const next = planFallback(event.sessionID, state, chain, config, blocked);
        if (!next.success)
          throw exhausted(first);
        commitFallback(state, next);
        previous = next.failedModel;
        logInfo("V2 compaction fallback selected", { sessionID: event.sessionID, from: next.failedModel, to: next.newModel });
      }
    } finally {
      if (run.cancel === undefined)
        storeFailures(event.sessionID, state);
    }
  };
  const storeFailures = (sessionID, state) => {
    const now = Date.now();
    const cooldownMs = config.cooldown_seconds * 1000;
    const live = new Map([...state.failedModels].filter(([, failedAt]) => now - failedAt < cooldownMs));
    if (live.size)
      failures.set(sessionID, live);
    else
      failures.delete(sessionID);
  };
  const compaction = (event) => {
    if (disposed || event.result || options.streamHealthy?.() === false)
      return;
    options.clearMainTimer?.(event.sessionID);
    const snapshot = structuredClone({ system: event.system, messages: event.messages, options: event.options });
    const previous = runs.get(event.sessionID);
    if (previous)
      cancelRun(previous, "hard");
    const run = { sessionID: event.sessionID, startedAt: Date.now() };
    runs.set(event.sessionID, run);
    const work = execute(run, event, snapshot).catch((error) => {
      if (run.cancel === "soft" && error instanceof CompactionCancelled)
        return;
      throw error;
    }).finally(() => {
      if (runs.get(event.sessionID) === run)
        runs.delete(event.sessionID);
    });
    const tracked = work.then(noop, noop);
    active.add(tracked);
    tracked.then(() => {
      active.delete(tracked);
    });
    return work;
  };
  const context = (event) => {
    const record = children.get(event.sessionID);
    if (!record)
      return;
    const copy = structuredClone(record.snapshot);
    event.system = copy.system;
    const messages = copy.messages;
    messages.push({ role: "user", content: [{ type: "text", text: SUMMARY_INSTRUCTION }] });
    event.messages = messages;
    delete event.tools;
    if (record.original)
      event.options = copy.options;
    record.contextApplied = true;
  };
  const httpRequest = async (event) => {
    if (!children.has(event.sessionID))
      return;
    const request = event.request;
    if (!request.headers.get("content-type")?.toLowerCase().includes("json"))
      return;
    let body;
    try {
      body = await request.clone().json();
    } catch {
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return;
    const payload = body;
    if (!Array.isArray(payload.tools) || payload.tools.length !== 0)
      return;
    const sanitized = { ...payload };
    delete sanitized.tools;
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    event.request = new Request(request, { headers, body: JSON.stringify(sanitized) });
  };
  const retry = (event) => {
    const record = children.get(event.sessionID);
    if (!record || !isRetryableError(event.error, config.retry_on_errors, config.retryable_error_patterns))
      return;
    const blocked = isProviderWideRateLimitError(event.error) ? record.state.currentModel.split("/")[0] : undefined;
    if (planFallback(event.sessionID, record.state, record.chain, config, blocked).success) {
      event.decision = { retry: false };
    }
  };
  const handleEvent = (event) => {
    const data = event.data;
    const sessionID = data.sessionID;
    if (!sessionID)
      return;
    const record = children.get(sessionID);
    if (record) {
      const attempt = record.attempt;
      if (event.type === "session.text.delta" || event.type === "session.reasoning.delta") {
        if (data.delta?.length)
          markFirstToken(attempt);
      } else if (event.type === "session.execution.failed") {
        attemptFail(attempt, data.error ?? new Error("Compaction child failed"));
      } else if (event.type === "session.execution.interrupted" || event.type === "session.deleted") {
        attemptFail(attempt, new Error(`Compaction child ${event.type}`));
      }
      return;
    }
    if (isInternal(sessionID))
      return;
    if (event.type === "session.deleted") {
      failures.delete(sessionID);
      cancel(sessionID);
      return;
    }
    if (event.type === "session.execution.interrupted") {
      const created = event.created;
      const run = runs.get(sessionID);
      if (run && created !== undefined && created < run.startedAt)
        return;
      cancel(sessionID);
    }
  };
  const registerHooks = async () => {
    registrations.push(await ctx.session.hook("context", context));
    registrations.push(await ctx.session.hook("http.request", httpRequest));
    registrations.push(await ctx.session.hook("retry", retry));
    registrations.push(await ctx.session.hook("compaction", compaction));
  };
  try {
    await registerHooks();
  } catch (error) {
    await Promise.all(registrations.map((registration) => registration.dispose()));
    throw error;
  }
  return {
    async dispose() {
      if (disposed)
        return;
      disposed = true;
      cancelAll();
      await Promise.all([...active]);
      failures.clear();
      removed.clear();
      await Promise.all(registrations.map((registration) => registration.dispose()));
    },
    isInternal,
    handleEvent,
    cancel,
    cancelAll
  };
}

// v2.ts
var V2_RUNTIME = Object.freeze({
  revision: "streaming-ttft-v3",
  moduleID: crypto.randomUUID(),
  buildID: "2026-11-17T20:31:43.868Z"
});
function parseModelRef(value) {
  const slash = value.indexOf("/");
  if (slash < 1 || slash === value.length - 1)
    throw new Error(`Invalid fallback model: ${value}`);
  const [id, variant] = value.slice(slash + 1).split("#");
  if (!id)
    throw new Error(`Invalid fallback model: ${value}`);
  return { providerID: value.slice(0, slash), id, ...variant ? { variant } : {} };
}
function modelName2(model) {
  return `${model.providerID}/${model.id}${model.variant && model.variant !== "default" ? `#${model.variant}` : ""}`;
}
async function withSignal(promise, signal) {
  if (signal.aborted)
    throw signal.reason;
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
async function setupV2(ctx) {
  const file = loadPluginConfig(ctx.location.directory);
  const options = ctx.options;
  const config = { ...DEFAULT_CONFIG, ...file, ...options };
  if (!config.enabled)
    return;
  const agents = { ...file.agents, ...options.agents };
  const resolvedAgents = {};
  const normalizeModels = (value) => normalizeFallbackModelsField(value).map((model) => modelName2(parseModelRef(model)));
  const globalModels = normalizeModels(config.fallback_models);
  for (const model of [...globalModels, ...Object.values(agents).flatMap((agent) => normalizeFallbackModelsField(agent.fallback_models))]) {
    parseModelRef(model);
  }
  const states = new Map;
  const controller = new AbortController;
  const registrations = [];
  let disposed = false;
  let streamHealthy = true;
  let compaction;
  let inventory;
  let inventoryUpdatedAt = 0;
  let inventoryRequest;
  const refreshInventory = async (force = false) => {
    const ttl = inventory ? 30000 : 5000;
    if (!force && inventoryUpdatedAt > 0 && Date.now() - inventoryUpdatedAt < ttl)
      return;
    if (inventoryRequest)
      return inventoryRequest;
    const request = (async () => {
      try {
        const lookupSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
        const { data } = await withSignal(ctx.model.list({ location: { directory: ctx.location.directory } }), lookupSignal);
        inventory = new Map(data.filter((model) => model.enabled).map((model) => [
          `${model.providerID}/${model.modelID}`,
          new Set(model.variants.map((variant) => variant.id))
        ]));
      } catch (error) {
        inventory = undefined;
        logError("V2 model inventory unavailable", { error: String(error) });
      } finally {
        inventoryUpdatedAt = Date.now();
      }
    })();
    inventoryRequest = request;
    try {
      await request;
    } finally {
      if (inventoryRequest === request)
        inventoryRequest = undefined;
    }
  };
  const available = (name) => {
    if (!inventory)
      return false;
    const { providerID, id, variant } = parseModelRef(name);
    const variants = inventory.get(`${providerID}/${id}`);
    return variants !== undefined && (!variant || variant === "default" || variants.has(variant));
  };
  const resolveAgentFallback = async (agentID) => {
    await refreshInventory();
    try {
      const lookupSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
      const { data: agent } = await withSignal(ctx.agent.get({ agentID, location: { directory: ctx.location.directory } }), lookupSignal);
      const models = normalizeFallbackModelsField(agent.request.body?.fallback_models).flatMap((model) => {
        try {
          return [modelName2(parseModelRef(model))];
        } catch (error) {
          logError("V2 invalid legacy fallback model ignored", { agent: agentID, model, error: String(error) });
          return [];
        }
      });
      const value = { model: agent.model && modelName2(agent.model), fallback_models: models };
      if (JSON.stringify(resolvedAgents[agentID]) !== JSON.stringify(value)) {
        resolvedAgents[agentID] = value;
        logInfo("V2 agent fallback configuration loaded", { directory: ctx.location.directory, agent: agentID, ...value });
      }
    } catch (error) {
      logError("V2 agent fallback configuration unavailable", { agent: agentID, error: String(error) });
    }
  };
  const notifications = await registerFallbackNotifications(ctx, config);
  registrations.push(notifications);
  const configuredChain = (agent) => {
    const merged = mergeAgentConfigs(resolvedAgents, agents);
    const models = normalizeModels(readFallbackModels(agent, merged));
    if (!models.length)
      return globalModels;
    const primary = merged?.[agent]?.model;
    if (primary && !models.includes(primary))
      models.unshift(primary);
    return models;
  };
  const chain = (agent) => configuredChain(agent).filter(available);
  const clearTimer = (state) => {
    clearTimeout(state.timer);
    state.timer = undefined;
  };
  const clearPending = (state) => {
    state.pending = undefined;
    state.pendingBlockedProvider = undefined;
  };
  const track = (sessionID, agent, model) => {
    const name = modelName2(model);
    let state = states.get(sessionID);
    if (!state || !state.pending && state.fallback.currentModel !== name) {
      if (state)
        clearTimer(state);
      state = { fallback: createFallbackState(name), agent, cancelled: false, expectedInterrupts: 0, active: false, awaitingExecution: false, lastAccess: Date.now() };
      states.set(sessionID, state);
    }
    state.agent = agent;
    state.lastAccess = Date.now();
    return state;
  };
  const plan = (sessionID, state, error, timeout = false) => {
    if (disposed || state.cancelled || !streamHealthy)
      return;
    if (state.requestKind !== "primary")
      return;
    if (!timeout && !isRetryableError(error, config.retry_on_errors, config.retryable_error_patterns))
      return;
    if (state.pending)
      return state.pending;
    const blockedProvider = isProviderWideRateLimitError(error) ? state.fallback.currentModel.split("/")[0] : undefined;
    const result = planFallback(sessionID, state.fallback, chain(state.agent), config, blockedProvider);
    if (!result.success)
      return;
    state.pending = result;
    state.pendingBlockedProvider = blockedProvider;
    clearTimer(state);
    return result;
  };
  const dispatch = (sessionID, state, interrupt = false) => {
    if (!state.pending || state.cancelled || disposed)
      return;
    state.pendingReady = true;
    state.pendingInterrupt ||= interrupt;
    if (state.dispatch)
      return;
    let pending = state.pending;
    state.recoveryFailed = false;
    const shouldInterrupt = state.pendingInterrupt;
    state.pendingReady = false;
    state.pendingInterrupt = false;
    state.dispatch = (async () => {
      if (shouldInterrupt) {
        state.expectedInterrupts++;
        try {
          const result = await ctx.session.interrupt({ sessionID, resume: false }, { signal: controller.signal });
          if (!result.interrupted)
            state.expectedInterrupts = Math.max(0, state.expectedInterrupts - 1);
        } catch (error) {
          state.expectedInterrupts = Math.max(0, state.expectedInterrupts - 1);
          throw error;
        }
      }
      await ctx.session.wait({ sessionID }, { signal: controller.signal });
      if (disposed || state.cancelled || state.pending !== pending)
        return;
      if (state.requestKind !== "primary") {
        clearPending(state);
        return;
      }
      await refreshInventory(true);
      if (disposed || state.cancelled || state.pending !== pending)
        return;
      if (state.requestKind !== "primary") {
        clearPending(state);
        return;
      }
      if (!available(pending.newModel)) {
        const refreshed = planFallback(sessionID, state.fallback, chain(state.agent), config, state.pendingBlockedProvider);
        if (!refreshed.success) {
          clearPending(state);
          state.active = false;
          state.awaitingExecution = false;
          state.recoveryFailed = true;
          return;
        }
        pending = refreshed;
        state.pending = refreshed;
      }
      await ctx.session.switchModel({ sessionID, model: parseModelRef(pending.newModel) }, { signal: controller.signal });
      if (disposed || state.cancelled || state.pending !== pending)
        return;
      commitFallback(state.fallback, pending);
      state.ownedExecution = true;
      clearPending(state);
      state.messageID = undefined;
      state.active = false;
      state.requestToken = undefined;
      state.awaitingExecution = true;
      state.requestStartedAt = Date.now();
      await ctx.session.prompt({
        sessionID,
        text: FALLBACK_CONTINUATION_PROMPT,
        resume: true,
        metadata: { [PLUGIN_NAME]: true }
      }, { signal: controller.signal });
      if (state.cancelled || state.parentCancelled) {
        await withSignal(ctx.session.interrupt({ sessionID, resume: false }), controller.signal);
        return;
      }
      logInfo("V2 fallback dispatched", { sessionID, from: pending.failedModel, model: pending.newModel });
      notifications.notify({ sessionID, from: pending.failedModel, to: pending.newModel, kind: "primary" });
    })().catch((error) => {
      if (!disposed)
        logError("V2 fallback dispatch failed", { sessionID, error: String(error) });
      if (!state.pending || state.pending === pending) {
        clearPending(state);
        state.active = false;
        state.awaitingExecution = false;
        state.recoveryFailed = true;
      }
    }).finally(() => {
      state.dispatch = undefined;
      if (state.pendingReady)
        dispatch(sessionID, state, state.pendingInterrupt);
    });
  };
  const startRequest = (sessionID, state) => {
    clearTimer(state);
    state.messageID = undefined;
    state.cancelled = false;
    state.active = true;
    state.awaitingExecution = false;
    state.recoveryFailed = false;
    state.requestKind = "primary";
    state.requestStartedAt = Date.now();
    const token = Symbol("request");
    state.requestToken = token;
    if (config.timeout_seconds <= 0 || !chain(state.agent).length)
      return;
    state.timer = setTimeout(() => {
      if (state.requestToken !== token || state.cancelled)
        return;
      logInfo("V2 first-token window expired", { sessionID, messageID: state.messageID });
      if (plan(sessionID, state, undefined, true))
        dispatch(sessionID, state, true);
    }, config.timeout_seconds * 1000);
    state.timer.unref();
  };
  const retry = (event) => {
    const state = states.get(event.sessionID);
    if (!state || state.requestKind !== "primary" || state.agent !== event.agent || state.fallback.currentModel !== modelName2(event.model))
      return;
    if (plan(event.sessionID, state, event.error))
      event.decision = { retry: false };
    else if (!disposed && !state.cancelled && streamHealthy && state.ownedExecution && isRetryableError(event.error, config.retry_on_errors, config.retryable_error_patterns)) {
      event.decision = { retry: false };
    }
  };
  const prompt = async (event) => {
    if (event.metadata?.[PLUGIN_NAME])
      return;
    const state = states.get(event.sessionID);
    if (state)
      state.parentCancelled = false;
    if (!state || state.active || state.dispatch)
      return;
    try {
      clearTimer(state);
      clearPending(state);
      state.cancelled = false;
      state.parentCancelled = false;
      state.lastAccess = Date.now();
      const current = await ctx.session.get({ sessionID: event.sessionID });
      if (current.model && modelName2(current.model) !== state.fallback.currentModel) {
        states.delete(event.sessionID);
        return;
      }
      const original = state.fallback.originalModel;
      if (original !== state.fallback.currentModel && !isModelInCooldown(original, state.fallback, config.cooldown_seconds)) {
        await ctx.session.switchModel({ sessionID: event.sessionID, model: parseModelRef(original) });
        state.fallback = createFallbackState(original);
      } else {
        state.fallback.attemptCount = 0;
        state.fallback.fallbackIndex = -1;
      }
    } catch (error) {
      logError("V2 cooldown recovery failed", { sessionID: event.sessionID, error: String(error) });
    }
  };
  const handleEvent = (event) => {
    if (event.location && (event.location.directory !== ctx.location.directory || ("workspaceID" in event.location) && event.location.workspaceID !== ctx.location.workspaceID))
      return;
    if (event.type === "model.updated" || event.type === "provider.updated") {
      refreshInventory(true);
      return;
    }
    compaction?.handleEvent(event);
    const data = event.data;
    if (!("sessionID" in data))
      return;
    const sessionID = data.sessionID;
    if (compaction?.isInternal(sessionID))
      return;
    if (event.type === "session.step.started") {
      if (!event.location && !states.has(sessionID))
        return;
      const state2 = track(sessionID, event.data.agent, event.data.model);
      if (state2.messageID === event.data.assistantMessageID)
        return;
      if (!state2.requestToken)
        startRequest(sessionID, state2);
      state2.messageID = event.data.assistantMessageID;
      return;
    }
    const state = states.get(sessionID);
    if (!state)
      return;
    state.lastAccess = Date.now();
    if ("assistantMessageID" in data && data.assistantMessageID !== state.messageID)
      return;
    if (event.type === "session.text.delta" || event.type === "session.reasoning.delta" || event.type === "session.tool.input.delta") {
      if (event.data.delta.length)
        clearTimer(state);
    } else if (event.type === "session.text.started" || event.type === "session.reasoning.started" || event.type === "session.tool.input.started" || event.type === "session.tool.called" || event.type === "session.step.ended") {
      clearTimer(state);
    } else if (event.type === "session.step.failed") {
      clearTimer(state);
      plan(sessionID, state, event.data.error);
    } else if (event.type === "session.execution.failed") {
      clearTimer(state);
      state.active = false;
      state.awaitingExecution = false;
      state.requestToken = undefined;
      if (plan(sessionID, state, event.data.error))
        dispatch(sessionID, state);
      else {
        state.ownedExecution = false;
        if (!state.dispatch)
          clearPending(state);
      }
    } else if (event.type === "session.execution.interrupted" || event.type === "session.deleted") {
      if (event.type === "session.execution.interrupted" && state.expectedInterrupts > 0) {
        state.expectedInterrupts--;
        return;
      }
      clearTimer(state);
      state.active = false;
      state.cancelled = true;
      state.ownedExecution = false;
      state.awaitingExecution = false;
      clearPending(state);
      state.pendingReady = false;
      if (event.type === "session.deleted")
        states.delete(sessionID);
    } else if (event.type === "session.idle" || event.type === "session.execution.succeeded") {
      if (state.dispatch || state.awaitingExecution || state.requestStartedAt !== undefined && event.created < state.requestStartedAt)
        return;
      clearTimer(state);
      state.active = false;
      state.requestToken = undefined;
      clearPending(state);
      state.pendingReady = false;
      state.expectedInterrupts = 0;
      state.ownedExecution = false;
    } else if (event.type === "session.compaction.failed") {
      clearTimer(state);
      state.requestKind = "compaction";
      clearPending(state);
    }
  };
  try {
    if (config.compaction_fallback) {
      compaction = await installV2CompactionFallback(ctx, {
        config,
        childAgent: () => "compaction",
        streamHealthy: () => streamHealthy,
        chain: async (agent) => {
          await resolveAgentFallback("compaction");
          if (Object.hasOwn(agents, "compaction") || normalizeFallbackModelsField(readFallbackModels("compaction", resolvedAgents)).length)
            return chain("compaction");
          if (agent !== "compaction")
            await resolveAgentFallback(agent);
          return chain(agent);
        },
        notify: notifications.notify,
        clearMainTimer: (sessionID) => {
          const state = states.get(sessionID);
          if (state) {
            clearTimer(state);
            state.requestKind = "compaction";
          }
        }
      });
      registrations.push(compaction);
    }
    if (config.foreground_task_fallback) {
      registrations.push(await installV2ForegroundTaskFallback(ctx, {
        isCancelled: (sessionID) => states.get(sessionID)?.cancelled === true,
        cancelFallback: (sessionID) => {
          compaction?.cancel(sessionID);
          const state = states.get(sessionID);
          if (!state)
            return;
          clearTimer(state);
          state.cancelled = true;
          state.parentCancelled = true;
          clearPending(state);
          state.pendingReady = false;
          state.active = false;
          state.awaitingExecution = false;
          state.requestToken = undefined;
        },
        ownsFallback: (sessionID) => {
          const state = states.get(sessionID);
          return Boolean(state && !state.cancelled && (state.pending || state.dispatch || state.fallback.attemptCount > 0 || state.active && chain(state.agent).length));
        },
        async waitForFallback(sessionID, signal) {
          const abort = AbortSignal.any([signal, controller.signal]);
          while (!abort.aborted) {
            const state = states.get(sessionID);
            if (!state || state.cancelled || state.recoveryFailed || disposed)
              return;
            if (!state.pending && !state.dispatch && !state.awaitingExecution) {
              const current = await withSignal(ctx.session.get({ sessionID }), abort);
              if (!state.pending && !state.dispatch && !state.awaitingExecution && !state.cancelled && !abort.aborted) {
                const hostIdle = current.time?.idle !== undefined && current.time.idle >= (state.requestStartedAt ?? 0);
                const terminal = hostIdle || !state.active && current.time?.idle === undefined;
                if (state.fallback.attemptCount > 0 && current.outcome === "succeeded" && terminal) {
                  return withSignal(readV2ForegroundSubagentOutput(ctx, sessionID), abort);
                }
                if (current.outcome && terminal)
                  return;
              }
            }
            try {
              await sleep(50, undefined, { signal: abort });
            } catch {
              return;
            }
          }
        }
      }));
    }
    registrations.push(await ctx.session.hook("context", async (event) => {
      if (disposed || compaction?.isInternal(event.sessionID))
        return;
      if (states.get(event.sessionID)?.parentCancelled) {
        ctx.session.interrupt({ sessionID: event.sessionID, resume: false }).catch((error) => {
          if (!disposed)
            logError("V2 cancelled child interrupt failed", { sessionID: event.sessionID, error: String(error) });
        });
        return;
      }
      const state = track(event.sessionID, event.agent, event.model);
      clearTimer(state);
      state.cancelled = false;
      state.active = true;
      state.awaitingExecution = false;
      state.requestStartedAt = Date.now();
      const token = Symbol("context");
      state.requestToken = token;
      await resolveAgentFallback(event.agent);
      if (!disposed && !state.cancelled && states.get(event.sessionID) === state && state.requestToken === token) {
        startRequest(event.sessionID, state);
      }
    }));
    registrations.push(await ctx.session.hook("model.request", (event) => {
      const state = states.get(event.sessionID);
      if (state && event.kind === "compaction") {
        state.requestKind = "compaction";
        clearTimer(state);
        clearPending(state);
        return;
      }
      if (state && state.fallback.currentModel === modelName2(event.model)) {
        if (state.active && event.kind !== "primary" && event.kind !== "compaction")
          return;
        state.requestKind = event.kind;
      }
    }));
    registrations.push(await ctx.session.hook("retry", retry));
    registrations.push(await ctx.session.hook("prompt", prompt));
  } catch (error) {
    await Promise.all(registrations.map((registration) => registration.dispose()));
    throw error;
  }
  (async () => {
    while (!disposed) {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          streamHealthy = true;
          handleEvent(event);
        }
      } catch (error) {
        if (!disposed)
          logError("V2 fallback event subscription failed", { error: String(error) });
      }
      streamHealthy = false;
      compaction?.cancelAll();
      for (const state of states.values()) {
        clearTimer(state);
        state.active = false;
        state.awaitingExecution = false;
        if (!state.dispatch)
          clearPending(state);
      }
      try {
        await sleep(1000, undefined, { signal: controller.signal });
      } catch {
        break;
      }
    }
  })();
  const cleanupInterval = setInterval(() => {
    for (const [id, state] of states) {
      if (!state.active && !state.awaitingExecution && !state.dispatch && !state.timer && Date.now() - state.lastAccess > 30 * 60 * 1000)
        states.delete(id);
    }
  }, 5 * 60 * 1000);
  cleanupInterval.unref();
  logInfo("V2 fallback plugin initialized", {
    directory: ctx.location.directory,
    models: globalModels,
    runtime: V2_RUNTIME,
    backgroundRuntime: BACKGROUND_RUNTIME,
    generationID: crypto.randomUUID()
  });
  return async () => {
    disposed = true;
    controller.abort();
    clearInterval(cleanupInterval);
    for (const state of states.values()) {
      state.cancelled = true;
      clearTimer(state);
    }
    states.clear();
    await Promise.all(registrations.map((registration) => registration.dispose()));
  };
}
var definition = { id: PLUGIN_NAME, setup: setupV2 };
var v2_default = {
  ...definition,
  async server(...args) {
    return (await Promise.resolve().then(() => (init_v1(), exports_v1))).default(...args);
  }
};
export {
  v2_default as default
};
