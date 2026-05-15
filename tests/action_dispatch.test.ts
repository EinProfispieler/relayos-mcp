import { describe, expect, it } from "vitest";
import { buildActionProposal } from "../src/action_dispatch.js";
import type { AIRoutingPlan } from "../src/schema.js";

function plan(overrides: Partial<AIRoutingPlan>): AIRoutingPlan {
  return {
    task_type: "general",
    target: "overseer",
    model: "claude-sonnet-4-6",
    effort: "medium",
    mode: "plan",
    approval_required: false,
    confidence: 0.8,
    reason: "test",
    next_action: "Proceed safely.",
    ...overrides,
  };
}

describe("buildActionProposal", () => {
  it("maps implementation to create_handoff", () => {
    const proposal = buildActionProposal(
      plan({ task_type: "implementation", model: "gpt-5.3-codex", mode: "patch" }),
    );

    expect(proposal).toEqual({
      action: "create_handoff",
      target: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "patch",
      approval_required: false,
      status: "not_executed",
    });
  });

  it("maps review to read-only review_request", () => {
    const proposal = buildActionProposal(
      plan({ task_type: "review", model: "claude-sonnet-4-6", mode: "review" }),
    );

    expect(proposal).toEqual({
      action: "review_request",
      target: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      mode: "read_only",
      approval_required: false,
      status: "not_executed",
    });
  });

  it("maps release control signals to approval-gated proposal", () => {
    const proposal = buildActionProposal(
      plan({ task_type: "release", next_action: "please commit and push this" }),
    );

    expect(proposal).toEqual({
      action: "request_approval",
      target: "approval",
      mode: "release_control",
      approval_required: true,
      status: "blocked_until_user_approval",
    });
  });

  it("maps planning to local plan", () => {
    const proposal = buildActionProposal(plan({ task_type: "planning" }));

    expect(proposal).toEqual({
      action: "local_plan",
      target: "local",
      mode: "plan",
      approval_required: false,
      status: "not_executed",
    });
  });

  it("falls back to unknown for unsupported task types", () => {
    const proposal = buildActionProposal(plan({ task_type: "general" }));
    expect(proposal).toEqual({ action: "unknown", status: "not_executed" });
  });
});
