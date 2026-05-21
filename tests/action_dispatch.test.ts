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

  it("maps review to a claude-targeted create_handoff", () => {
    const proposal = buildActionProposal(
      plan({ task_type: "review", model: "claude-sonnet-4-6", mode: "review" }),
    );

    expect(proposal).toEqual({
      action: "create_handoff",
      target: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      mode: "review",
      approval_required: false,
      status: "not_executed",
    });
  });

  it("honors an explicit claude target for an implementation task", () => {
    const proposal = buildActionProposal(
      plan({ task_type: "implementation", target: "claude", model: "claude-opus-4-7", mode: "patch" }),
    );

    expect(proposal.action).toBe("create_handoff");
    expect(proposal.target).toBe("claude");
  });

  it("honors an explicit codex target for a review task", () => {
    const proposal = buildActionProposal(
      plan({ task_type: "review", target: "codex", model: "gpt-5.5", mode: "review" }),
    );

    expect(proposal.action).toBe("create_handoff");
    expect(proposal.target).toBe("codex");
    expect(proposal.mode).toBe("review");
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

  it("enforces approval_required from planner output", () => {
    const proposal = buildActionProposal(
      plan({ task_type: "implementation", mode: "patch", approval_required: true }),
    );

    expect(proposal).toEqual({
      action: "request_approval",
      target: "approval",
      mode: "patch",
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
