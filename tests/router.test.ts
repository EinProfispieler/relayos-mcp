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

  it("routes commit and push to release control approval", () => {
    const decision = classifyMessage("please commit and push this change");
    expect(decision.target).toBe("approval");
    expect(decision.model).toBe("current-session");
    expect(decision.mode).toBe("release_control");
    expect(decision.approval_required).toBe(true);
    expect(decision.effort).toBe("medium");
  });

  it("routes tag and release to release control approval", () => {
    const decision = classifyMessage("tag and release this version");
    expect(decision.target).toBe("approval");
    expect(decision.model).toBe("current-session");
    expect(decision.mode).toBe("release_control");
    expect(decision.approval_required).toBe(true);
    expect(decision.effort).toBe("medium");
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

  it("routes review ahead of implementation keywords", () => {
    const decision = classifyMessage("please review and then implement fix");
    expect(decision.target).toBe("claude-reviewer");
    expect(decision.mode).toBe("read_only");
  });

  it("routes review of latest patch to review", () => {
    const decision = classifyMessage("please review the latest patch");
    expect(decision.target).toBe("claude-reviewer");
    expect(decision.mode).toBe("read_only");
    expect(decision.reason).toBe("matched keyword: review");
  });

  it("routes implementation fix requests to codex", () => {
    const decision = classifyMessage("please fix the CLI bug");
    expect(decision.target).toBe("codex");
    expect(decision.model).toBe("gpt-5.3-codex");
    expect(decision.mode).toBe("implementation");
  });

  it("routes run tests to codex implementation", () => {
    const decision = classifyMessage("run tests");
    expect(decision.target).toBe("codex");
    expect(decision.model).toBe("gpt-5.3-codex");
    expect(decision.mode).toBe("implementation");
  });

  it("does not match test by substring inside latest", () => {
    const decision = classifyMessage("latest");
    expect(decision.target).toBe("overseer");
    expect(decision.model).toBe("claude-sonnet-4-6");
    expect(decision.mode).toBe("plan");
    expect(decision.reason).toBe("no keyword match → overseer");
  });
});
