import { describe, expect, it } from "vitest";
import { planRoute, safePlanRoute } from "../src/ai_planner.js";
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
    expect(plan.task_type).toBe("release_control");
    expect(plan.approval_required).toBe(true);
    expect(plan.target).toBe("approval");
    expect(plan.next_action).toContain("approval");
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
