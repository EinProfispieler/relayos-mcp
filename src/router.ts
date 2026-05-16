export interface RouteDecision {
  target: string;
  model: string;
  effort: "low" | "medium" | "high";
  mode: string;
  approval_required: boolean;
  reason: string;
}

interface RoutingRule {
  keywords: readonly string[];
  decision: Omit<RouteDecision, "reason">;
}

const ROUTING_RULES: readonly RoutingRule[] = [
  {
    keywords: ["commit", "push", "tag", "release", "merge", "publish"],
    decision: {
      target: "approval",
      model: "current-session",
      effort: "medium",
      mode: "release_control",
      approval_required: true,
    },
  },
  {
    keywords: ["review", "audit", "check", "inspect"],
    decision: {
      target: "claude-reviewer",
      model: "claude-sonnet-4-6",
      effort: "medium",
      mode: "read_only",
      approval_required: false,
    },
  },
  {
    keywords: ["implement", "test", "tests", "cli", "mcp", "patch", "fix", "code", "change"],
    decision: {
      target: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "implementation",
      approval_required: false,
    },
  },
  {
    keywords: ["plan", "planning", "product", "design", "architecture"],
    decision: {
      target: "overseer",
      model: "claude-sonnet-4-6",
      effort: "medium",
      mode: "plan",
      approval_required: false,
    },
  },
];

const DEFAULT_DECISION: Omit<RouteDecision, "reason"> = {
  target: "overseer",
  model: "claude-sonnet-4-6",
  effort: "medium",
  mode: "plan",
  approval_required: false,
};

const TASK_KEYWORDS = new Set(
  ROUTING_RULES.flatMap((rule) => rule.keywords.map((keyword) => keyword.toLowerCase())),
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

export function classifyMessage(message: string): RouteDecision {
  const normalized = message.toLowerCase();
  const tokens = new Set(normalized.match(/[a-z0-9]+/g) ?? []);

  for (const rule of ROUTING_RULES) {
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
    ...DEFAULT_DECISION,
    reason: "no keyword match \u2192 overseer",
  };
}
