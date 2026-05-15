import { describe, expect, it } from "vitest";
import {
  buildHandoffInputFromPending,
  decideApproveAction,
  resolveRunHandoffId,
  type PendingActionProposal,
} from "../src/chat.js";

function pending(overrides: Partial<PendingActionProposal> = {}): PendingActionProposal {
  return {
    originalMessage: "please fix the login bug and add tests",
    aiPlan: {
      task_type: "implementation",
      target: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "implementation",
      approval_required: false,
      confidence: 0.88,
      reason: "matched keyword: fix",
      next_action: "Proceed with local implementation flow.",
    },
    actionProposal: {
      action: "create_handoff",
      target: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "implementation",
      approval_required: false,
      status: "not_executed",
    },
    executed: false,
    ...overrides,
  };
}

describe("chat /approve helpers", () => {
  it("approves only pending codex create_handoff proposals", () => {
    expect(decideApproveAction(pending())).toBe("create_handoff");
    expect(decideApproveAction(pending({ executed: true }))).toBe("none");
    expect(
      decideApproveAction(
        pending({ actionProposal: { ...pending().actionProposal, target: "claude" } }),
      ),
    ).toBe("none");
  });

  it("blocks release-control approval requests", () => {
    expect(
      decideApproveAction(
        pending({
          actionProposal: {
            action: "request_approval",
            target: "approval",
            mode: "release_control",
            approval_required: true,
            status: "blocked_until_user_approval",
          },
        }),
      ),
    ).toBe("blocked");
  });

  it("builds handoff input with enforced auto_spawn=false and defaults", () => {
    const built = buildHandoffInputFromPending(
      pending({
        originalMessage: "   " + "x".repeat(200),
        actionProposal: {
          action: "create_handoff",
          target: "codex",
          status: "not_executed",
        },
      }),
    );

    expect(built.source_agent).toBe("claude");
    expect(built.target_agent).toBe("codex");
    expect(built.execution_mode).toBe("patch");
    expect(built.auto_spawn).toBe(false);
    expect(built.model).toBe("gpt-5.3-codex");
    expect(built.effort).toBe("medium");
    expect(built.task_title.length).toBeLessThanOrEqual(80);
    expect(built.expected_output).toEqual(["Patch applied", "Tests pass"]);
    expect(built.task_description).toContain("Original user message:");
    expect(built.task_description).toContain("AI plan summary:");
    expect(built.task_description).toContain("Action proposal:");
  });

  it("refuses /run when no handoff was created in this session", () => {
    const resolved = resolveRunHandoffId(null);
    expect(resolved.handoffId).toBeNull();
    expect(resolved.errorMessage).toBe("No handoff created in this session. Use /approve first.");
  });

  it("uses the session-created handoff id for /run", () => {
    const resolved = resolveRunHandoffId("h_01JSESSION123");
    expect(resolved.errorMessage).toBeNull();
    expect(resolved.handoffId).toBe("h_01JSESSION123");
  });
});
