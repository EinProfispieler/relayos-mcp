import { describe, expect, it } from "vitest";
import { classifyMessage } from "../src/router.js";

describe("classifyMessage", () => {
  it("routes implementation keywords to codex", () => {
    const decision = classifyMessage("please implement this cli patch");
    expect(decision.target).toBe("codex");
    expect(decision.model).toBe("gpt-5.3-codex");
    expect(decision.mode).toBe("implementation");
    expect(decision.effort).toBe("medium");
    expect(decision.approval_required).toBe(false);
  });

  it("routes review keywords to claude-reviewer", () => {
    const decision = classifyMessage("please review and inspect this");
    expect(decision.target).toBe("claude-reviewer");
    expect(decision.model).toBe("claude-sonnet-4-6");
    expect(decision.mode).toBe("read_only");
  });

  it("routes planning keywords to overseer", () => {
    const decision = classifyMessage("need architecture and product planning");
    expect(decision.target).toBe("overseer");
    expect(decision.model).toBe("claude-sonnet-4-6");
    expect(decision.mode).toBe("plan");
  });

  it("release keywords require approval", () => {
    const decision = classifyMessage("please push a release tag");
    expect(decision.target).toBe("release-control");
    expect(decision.model).toBe("n/a");
    expect(decision.mode).toBe("release-control");
    expect(decision.approval_required).toBe(true);
    expect(decision.effort).toBe("low");
  });

  it("unknown message defaults to overseer", () => {
    const decision = classifyMessage("what is for lunch today");
    expect(decision.target).toBe("overseer");
    expect(decision.model).toBe("claude-sonnet-4-6");
    expect(decision.mode).toBe("plan");
    expect(decision.reason).toBe("no keyword match → overseer");
  });

  it("matching is case-insensitive", () => {
    const decision = classifyMessage("Please FIX this quickly");
    expect(decision.target).toBe("codex");
    expect(decision.reason).toBe("matched keyword: fix");
  });

  it("first-match wins for overlapping keywords", () => {
    const decision = classifyMessage("please review and then implement fix");
    expect(decision.target).toBe("codex");
    expect(decision.mode).toBe("implementation");
  });
});
