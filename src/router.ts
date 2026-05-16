export interface RouteDecision {
  target: string;
  model: string;
  effort: "low" | "medium" | "high";
  mode: string;
  approval_required: boolean;
  reason: string;
}

export interface RoutingProfiles {
  codexModel: string;
  codexEffort: "low" | "medium" | "high";
  claudeModel: string;
  claudeEffort: "low" | "medium" | "high";
}
const DEFAULT_ROUTING_PROFILES: RoutingProfiles = {
  codexModel: "gpt-5.3-codex",
  codexEffort: "medium",
  claudeModel: "claude-sonnet-4-6",
  claudeEffort: "medium",
};

interface RoutingRule {
  keywords: readonly string[];
  decision: Omit<RouteDecision, "reason">;
}

const STATIC_ROUTE_KEYWORDS = {
  release: ["commit", "push", "tag", "release", "merge", "publish"] as const,
  review: ["review", "audit", "check", "inspect"] as const,
  implementation: ["implement", "test", "tests", "cli", "mcp", "patch", "fix", "code", "change"] as const,
  planning: ["plan", "planning", "product", "design", "architecture"] as const,
};

function buildRoutingRules(profiles: RoutingProfiles): readonly RoutingRule[] {
  return [
    {
      keywords: STATIC_ROUTE_KEYWORDS.release,
      decision: {
        target: "approval",
        model: "current-session",
        effort: "medium",
        mode: "release_control",
        approval_required: true,
      },
    },
    {
      keywords: STATIC_ROUTE_KEYWORDS.review,
      decision: {
        target: "claude-reviewer",
        model: profiles.claudeModel,
        effort: profiles.claudeEffort,
        mode: "read_only",
        approval_required: false,
      },
    },
    {
      keywords: STATIC_ROUTE_KEYWORDS.implementation,
      decision: {
        target: "codex",
        model: profiles.codexModel,
        effort: profiles.codexEffort,
        mode: "implementation",
        approval_required: false,
      },
    },
    {
      keywords: STATIC_ROUTE_KEYWORDS.planning,
      decision: {
        target: "overseer",
        model: profiles.claudeModel,
        effort: profiles.claudeEffort,
        mode: "plan",
        approval_required: false,
      },
    },
  ];
}

function defaultDecision(profiles: RoutingProfiles): Omit<RouteDecision, "reason"> {
  return {
    target: "overseer",
    model: profiles.claudeModel,
    effort: profiles.claudeEffort,
    mode: "plan",
    approval_required: false,
  };
}

const TASK_KEYWORDS = new Set(
  Object.values(STATIC_ROUTE_KEYWORDS).flatMap((list) => list.map((keyword) => keyword.toLowerCase())),
);

export type MessageClassification = "task" | "conversation";

export function classifyForChat(message: string): MessageClassification {
  const normalized = message.toLowerCase();
  const tokens = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
  for (const token of tokens) {
    if (TASK_KEYWORDS.has(token)) return "task";
  }
  return "conversation";
}

export function classifyMessage(message: string, profiles: RoutingProfiles = DEFAULT_ROUTING_PROFILES): RouteDecision {
  const routingRules = buildRoutingRules(profiles);
  const normalized = message.toLowerCase();
  const tokens = new Set(normalized.match(/[a-z0-9]+/g) ?? []);

  for (const rule of routingRules) {
    for (const keyword of rule.keywords) {
      if (tokens.has(keyword)) {
        return {
          ...rule.decision,
          reason: `matched keyword: ${keyword}`,
        };
      }
    }
  }

  return {
    ...defaultDecision(profiles),
    reason: "no keyword match \u2192 overseer",
  };
}
