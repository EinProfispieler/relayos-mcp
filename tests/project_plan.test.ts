import { describe, expect, it } from "vitest";
import { parseProjectPlanBlock, buildProjectPlan } from "../src/project_plan.js";

const GOOD_BLOCK = `Here is my plan.

PROJECT_PLAN
goal: add a health-check endpoint
questions:
  - Should the endpoint require auth?
  - What path — /health or /healthz?
tasks:
  - id: t1
    title: add the route handler
    target: codex
    model: gpt-5.5
    effort: medium
    mode: patch
    description: implement GET /health returning 200
    depends_on: []
  - id: t2
    title: review the handler
    target: claude
    model: claude-sonnet-4-6
    effort: medium
    mode: review
    description: review t1 for correctness
    depends_on: [t1]
reporting: each task calls write_handoff_result with status and summary
END_PROJECT_PLAN`;

describe("parseProjectPlanBlock", () => {
  it("parses a well-formed PROJECT_PLAN block", () => {
    const parsed = parseProjectPlanBlock(GOOD_BLOCK);
    expect(parsed).not.toBeNull();
    expect(parsed!.goal).toBe("add a health-check endpoint");
    expect(parsed!.questions).toHaveLength(2);
    expect(parsed!.tasks).toHaveLength(2);
    expect(parsed!.tasks[0]!.id).toBe("t1");
    expect(parsed!.tasks[0]!.target).toBe("codex");
    expect(parsed!.tasks[1]!.depends_on).toEqual(["t1"]);
    expect(parsed!.reporting).toContain("write_handoff_result");
  });

  it("returns null when no block is present", () => {
    expect(parseProjectPlanBlock("just a normal reply")).toBeNull();
  });

  it("returns null when the block has no goal", () => {
    const block = `PROJECT_PLAN
tasks:
  - id: t1
    title: x
    target: codex
    model: gpt-5.5
    effort: low
    mode: patch
    description: do x
END_PROJECT_PLAN`;
    expect(parseProjectPlanBlock(block)).toBeNull();
  });

  it("skips invalid tasks and returns null if none remain", () => {
    const block = `PROJECT_PLAN
goal: something
tasks:
  - id: t1
    title: bad
    target: gemini
    model: g
    effort: medium
    mode: patch
    description: invalid target
END_PROJECT_PLAN`;
    expect(parseProjectPlanBlock(block)).toBeNull();
  });

  it("buildProjectPlan produces a valid persisted ProjectPlan", () => {
    const parsed = parseProjectPlanBlock(GOOD_BLOCK)!;
    const plan = buildProjectPlan(parsed, "h_source");
    expect(plan.plan_id).toMatch(/^plan_/);
    expect(plan.source_handoff_id).toBe("h_source");
    expect(plan.status).toBe("awaiting_answers");
    expect(plan.tasks[0]!.status).toBe("pending");
  });
});
