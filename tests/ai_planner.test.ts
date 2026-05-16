import { describe, expect, it } from "vitest";
import { planRoute, planRouteFromActionIntent, safePlanRoute } from "../src/ai_planner.js";
import { classifyMessage } from "../src/router.js";

describe("planRoute", () => {
  it("creates a deterministic plan for implementation routes", () => {
    const route = classifyMessage("please implement router patch");
    const plan = planRoute("please implement router patch", route);
    expect(plan.task_type).toBe("implementation");
    expect(plan.target).toBe("codex");
    expect(plan.model).toBe("gpt-5.3-codex");
    expect(plan.mode).toBe("implementation");
    expect(plan.approval_required).toBe(false);
    expect(plan.confidence).toBeGreaterThan(0);
    expect(plan.next_action.length).toBeGreaterThan(0);
  });

  it("creates approval-required plan for release control routes", () => {
    const route = classifyMessage("please commit and push");
    const plan = planRoute("please commit and push", route);
    expect(plan.task_type).toBe("release");
    expect(plan.approval_required).toBe(true);
    expect(plan.target).toBe("approval");
    expect(plan.next_action).toContain("approval");
  });

  it("uses release task_type for commit and push intents", () => {
    const route = classifyMessage("please commit and push this change");
    const plan = planRoute("please commit and push this change", route);
    expect(plan.task_type).toBe("release");
  });

  it("uses release task_type for tag and release intents", () => {
    const route = classifyMessage("tag and release this version");
    const plan = planRoute("tag and release this version", route);
    expect(plan.task_type).toBe("release");
  });

  it("keeps implementation task_type for implementation intents", () => {
    const route = classifyMessage("please fix the CLI bug");
    const plan = planRoute("please fix the CLI bug", route);
    expect(plan.task_type).toBe("implementation");
  });
});

describe("safePlanRoute", () => {
  it("returns planner output for normal messages", () => {
    const plan = safePlanRoute("review this patch");
    expect(plan.task_type).toBe("review");
    expect(plan.target).toBe("claude-reviewer");
    expect(plan.reason).toContain("matched keyword");
  });

  it("falls back safely if route classification fails", () => {
    const original = String.prototype.toLowerCase;
    String.prototype.toLowerCase = function thrower(): string {
      throw new Error("forced failure");
    };
    try {
      const plan = safePlanRoute("force failure");
      expect(plan.target).toBe("overseer");
      expect(plan.reason).toContain("fallback");
      expect(plan.confidence).toBe(0.5);
    } finally {
      String.prototype.toLowerCase = original;
    }
  });
});

describe("planRouteFromActionIntent", () => {
  it("maps create_handoff action intent to implementation plan", () => {
    const plan = planRouteFromActionIntent({
      intent_type: "create_handoff",
      confidence: 0.85,
      summary: "Fix CLI bug in router",
      approval_required: false,
      target: "codex",
      mode: "patch",
      effort: "medium",
    });

    expect(plan.task_type).toBe("implementation");
    expect(plan.target).toBe("codex");
    expect(plan.mode).toBe("patch");
    expect(plan.approval_required).toBe(false);
    expect(plan.confidence).toBe(0.85);
  });

  it("forces release_control intents to approval required", () => {
    const plan = planRouteFromActionIntent({
      intent_type: "release_control",
      confidence: 0.9,
      summary: "Commit and release changes",
      approval_required: false,
    });

    expect(plan.task_type).toBe("release_control");
    expect(plan.target).toBe("approval");
    expect(plan.mode).toBe("release_control");
    expect(plan.approval_required).toBe(true);
  });
});
