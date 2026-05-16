import { describe, expect, it } from "vitest";
import { buildActionProposal } from "../src/action_dispatch.js";
import { planRouteFromActionIntent } from "../src/ai_planner.js";
import { extractActionIntentFromReply } from "../src/chat.js";

describe("action intent integration", () => {
  it("keeps ordinary conversation when no ACTION_INTENT block exists", () => {
    const parsed = extractActionIntentFromReply("Here is a normal answer.");
    expect(parsed.visibleReply).toBe("Here is a normal answer.");
    expect(parsed.actionIntent).toBeNull();
  });

  it("creates action proposal for valid create_handoff ACTION_INTENT", () => {
    const parsed = extractActionIntentFromReply(
      [
        "I can fix that bug.",
        "ACTION_INTENT",
        "intent_type: create_handoff",
        "confidence: 0.85",
        "summary: Fix router bug",
        "target: codex",
        "model: gpt-5.3-codex",
        "effort: medium",
        "mode: patch",
        "approval_required: false",
        "suggested_next_command: /handoff fix router bug",
        "END_ACTION_INTENT",
      ].join("\n"),
    );

    expect(parsed.actionIntent).not.toBeNull();
    const plan = planRouteFromActionIntent(parsed.actionIntent!);
    const proposal = buildActionProposal(plan);
    expect(proposal.action).toBe("create_handoff");
    expect(proposal.target).toBe("codex");
    expect(proposal.status).toBe("not_executed");
  });

  it("silently ignores malformed ACTION_INTENT blocks", () => {
    const parsed = extractActionIntentFromReply(
      [
        "I can help with that.",
        "ACTION_INTENT",
        "intent_type: create_handoff",
        "summary: Missing confidence and approval fields",
        "END_ACTION_INTENT",
      ].join("\n"),
    );

    expect(parsed.visibleReply).toBe("I can help with that.");
    expect(parsed.actionIntent).toBeNull();
  });

  it("blocks release_control intents until explicit user approval", () => {
    const parsed = extractActionIntentFromReply(
      [
        "I can prepare the release process.",
        "ACTION_INTENT",
        "intent_type: release_control",
        "confidence: 0.95",
        "summary: Commit and release changes",
        "approval_required: false",
        "END_ACTION_INTENT",
      ].join("\n"),
    );

    const plan = planRouteFromActionIntent(parsed.actionIntent!);
    const proposal = buildActionProposal(plan);
    expect(proposal.action).toBe("request_approval");
    expect(proposal.approval_required).toBe(true);
    expect(proposal.status).toBe("blocked_until_user_approval");
  });
});
