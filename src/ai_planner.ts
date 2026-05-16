import { type RouteDecision, classifyMessage } from "./router.js";
import {
  AIRoutingPlan,
  type AIRoutingPlan as AIRoutingPlanType,
  type ActionIntentBlock,
  type RelayConfig,
} from "./schema.js";
import { resolveModelProfiles } from "./model_profiles.js";

function safeDefaultRoute(cfg?: RelayConfig): RouteDecision {
  const profiles = resolveModelProfiles(cfg);
  return {
    target: "overseer",
    model: profiles.claudeModel,
    effort: profiles.claudeEffort,
    mode: "plan",
    approval_required: false,
    reason: "safe fallback route",
  };
}

function detectTaskType(message: string): string {
  const normalized = message.toLowerCase();
  if (/(review|audit|inspect|check)/.test(normalized)) return "review";
  if (/(commit|push|tag|release|merge|publish)/.test(normalized)) return "release";
  if (/(implement|fix|patch|code|change|test)/.test(normalized)) return "implementation";
  if (/(plan|planning|design|architecture|product)/.test(normalized)) return "planning";
  return "general";
}

function confidenceForRoute(route: RouteDecision): number {
  if (route.approval_required) return 0.98;
  if (route.target === "claude-reviewer") return 0.9;
  if (route.target === "codex") return 0.88;
  return 0.75;
}

function nextActionForRoute(route: RouteDecision): string {
  if (route.approval_required) {
    return "Request explicit user approval before execution.";
  }
  if (route.target === "claude-reviewer") {
    return "Run read-only review flow and summarize findings.";
  }
  if (route.target === "codex") {
    return "Proceed with local implementation flow.";
  }
  return "Proceed with overseer planning flow.";
}

export function planRoute(message: string, route: RouteDecision): AIRoutingPlanType {
  return AIRoutingPlan.parse({
    task_type: detectTaskType(message),
    target: route.target,
    model: route.model,
    effort: route.effort,
    mode: route.mode,
    approval_required: route.approval_required,
    confidence: confidenceForRoute(route),
    reason: route.reason,
    next_action: nextActionForRoute(route),
  });
}

export function safePlanRoute(message: string, cfg?: RelayConfig, route?: RouteDecision): AIRoutingPlanType {
  try {
    const profiles = resolveModelProfiles(cfg);
    const baseRoute = route ?? classifyMessage(message, profiles);
    return planRoute(message, baseRoute);
  } catch {
    const fallbackRoute = route ?? safeDefaultRoute(cfg);
    return AIRoutingPlan.parse({
      task_type: "general",
      target: fallbackRoute.target,
      model: fallbackRoute.model,
      effort: fallbackRoute.effort,
      mode: fallbackRoute.mode,
      approval_required: fallbackRoute.approval_required,
      confidence: 0.5,
      reason: "planner failure; static route fallback engaged",
      next_action: "Proceed with static fallback route only.",
    });
  }
}

export function planRouteFromActionIntent(intent: ActionIntentBlock, cfg?: RelayConfig): AIRoutingPlanType {
  const profiles = resolveModelProfiles(cfg);
  const isReleaseControl = intent.intent_type === "release_control";
  const taskType =
    intent.intent_type === "create_handoff"
      ? "implementation"
      : intent.intent_type;
  const target = isReleaseControl ? "approval" : (intent.target ?? "overseer");
  const mode = isReleaseControl ? "release_control" : (intent.mode ?? "plan");
  const approvalRequired = isReleaseControl ? true : intent.approval_required;
  const defaultModel = target === "codex" ? profiles.codexModel : profiles.claudeModel;
  const defaultEffort = target === "codex" ? profiles.codexEffort : profiles.claudeEffort;

  return AIRoutingPlan.parse({
    task_type: taskType,
    target,
    model: intent.model ?? defaultModel,
    effort: intent.effort ?? defaultEffort,
    mode,
    approval_required: approvalRequired,
    confidence: intent.confidence,
    reason: intent.summary,
    next_action: intent.suggested_next_command ?? "Await explicit user instruction.",
  });
}
