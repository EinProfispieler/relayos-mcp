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
    keywords: ["implement", "test", "cli", "mcp", "patch", "fix", "code", "change"],
    decision: {
      target: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "implementation",
      approval_required: false,
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
    keywords: ["plan", "planning", "product", "design", "architecture"],
    decision: {
      target: "overseer",
      model: "claude-sonnet-4-6",
      effort: "medium",
      mode: "plan",
      approval_required: false,
    },
  },
  {
    keywords: ["commit", "push", "tag", "release"],
    decision: {
      target: "release-control",
      model: "n/a",
      effort: "low",
      mode: "release-control",
      approval_required: true,
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

export function classifyMessage(message: string): RouteDecision {
  const normalized = message.toLowerCase();

  for (const rule of ROUTING_RULES) {
    for (const keyword of rule.keywords) {
      if (normalized.includes(keyword)) {
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
