import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chdir, cwd } from "node:process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";
import {
  buildProjectPlan,
  buildPlanReport,
  parseProjectPlanBlock,
  persistProjectPlan,
} from "../src/project_plan.js";
import { resolveOverseerLayout } from "../src/overseer.js";

let projectRoot = "";
let prevCwd = "";
const prevHandoffDir = process.env.HANDOFF_DIR;

function captureIO() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write: (c: string) => (stdout += c) },
      stderr: { write: (c: string) => (stderr += c) },
    },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

const PLAN_BLOCK = `Planning done.

PROJECT_PLAN
goal: add search endpoint
questions:
  - Should results be paginated?
  - Max page size?
tasks:
  - id: t1
    title: implement GET /search
    target: codex
    model: gpt-5.5
    effort: medium
    mode: patch
    description: add search route to app.ts
    depends_on: []
  - id: t2
    title: review search handler
    target: claude
    model: claude-sonnet-4-6
    effort: medium
    mode: review
    description: review t1 for correctness
    depends_on: [t1]
reporting: write_handoff_result
END_PROJECT_PLAN`;

function setupPlan() {
  const layout = resolveOverseerLayout(projectRoot);
  const parsed = parseProjectPlanBlock(PLAN_BLOCK)!;
  const plan = buildProjectPlan(parsed, "h_source");
  persistProjectPlan(layout, plan);
  return plan;
}

beforeEach(() => {
  prevCwd = cwd();
  projectRoot = mkdtempSync(join(tmpdir(), "relayos-phase4-"));
  mkdirSync(join(projectRoot, ".relayos", "overseer", "plans"), { recursive: true });
  // Provide a dummy HANDOFF_DIR so plan-task-handoff can write envelopes
  const handoffRoot = mkdtempSync(join(tmpdir(), "relayos-phase4-hf-"));
  mkdirSync(join(handoffRoot, "envelopes"), { recursive: true });
  process.env.HANDOFF_DIR = handoffRoot;
  chdir(projectRoot);
});

afterEach(() => {
  chdir(prevCwd);
  const handoffDir = process.env.HANDOFF_DIR!;
  if (prevHandoffDir === undefined) delete process.env.HANDOFF_DIR;
  else process.env.HANDOFF_DIR = prevHandoffDir;
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(handoffDir, { recursive: true, force: true });
});

// ── plan-report ───────────────────────────────────────────────────────────────

describe("relayos overseer plan-report", () => {
  it("returns usage when plan_id is missing → exit 1, stderr contains 'Usage:'", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-report"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Usage:");
  });

  it("returns error when plan not found → exit 1, stderr contains 'not found'", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-report", "plan_MISSING"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("not found");
  });

  it("exits 0 for plan with no handoff results — all tasks pending, sentinel present", async () => {
    const plan = setupPlan();
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-report", plan.plan_id], cap.io);
    expect(code).toBe(0);

    // Sentinel should be present
    const sentinelLine = cap.stdout.split("\n").find((l) => l.startsWith("@@RELAYOS_PLAN_REPORT@@ "));
    expect(sentinelLine).toBeDefined();

    const data = JSON.parse(sentinelLine!.slice("@@RELAYOS_PLAN_REPORT@@ ".length));
    expect(data.plan_id).toBe(plan.plan_id);
    expect(data.goal).toBe("add search endpoint");
    expect(data.summary.total).toBe(2);
    expect(data.summary.completed).toBe(0);
    expect(data.summary.failed).toBe(0);
    expect(data.summary.blocked).toBe(0);
    // All tasks are pending (no running either)
    expect(data.summary.pending).toBe(2);
    expect(data.tasks).toHaveLength(2);
    expect(data.tasks[0].id).toBe("t1");
    expect(data.tasks[1].id).toBe("t2");
    // No result_summary since no handoff_results.jsonl
    expect(data.tasks[0].result_summary).toBeUndefined();
    // markdown should NOT be present in sentinel payload
    expect(data.markdown).toBeUndefined();
  });

  it("shows completed task with result_summary after writing handoff_results.jsonl", async () => {
    const plan = setupPlan();
    const layout = resolveOverseerLayout(projectRoot);

    // Simulate: task t1 has been assigned a handoff and completed
    const handoffId = "h_testresult001";
    // Update plan to have t1 running with handoff_id
    const updatedTasks = plan.tasks.map((t) =>
      t.id === "t1" ? { ...t, status: "completed" as const, handoff_id: handoffId } : t,
    );
    const updatedPlan = { ...plan, tasks: updatedTasks };
    persistProjectPlan(layout, updatedPlan);

    // Write a handoff result for t1
    const resultRecord = {
      run_id: handoffId,
      status: "completed",
      summary: "Added GET /search endpoint with pagination",
      test_result: "all 5 tests pass",
      needs_review: false,
      blockers: [],
    };
    writeFileSync(
      layout.handoffResultsPath,
      JSON.stringify(resultRecord) + "\n",
      "utf8",
    );

    const cap = captureIO();
    const code = await runCli(["overseer", "plan-report", plan.plan_id], cap.io);
    expect(code).toBe(0);

    const sentinelLine = cap.stdout.split("\n").find((l) => l.startsWith("@@RELAYOS_PLAN_REPORT@@ "));
    expect(sentinelLine).toBeDefined();

    const data = JSON.parse(sentinelLine!.slice("@@RELAYOS_PLAN_REPORT@@ ".length));
    expect(data.summary.completed).toBe(1);

    const t1 = data.tasks.find((t: { id: string }) => t.id === "t1");
    expect(t1).toBeDefined();
    expect(t1.status).toBe("completed");
    expect(t1.result_summary).toBe("Added GET /search endpoint with pagination");
    expect(t1.test_result).toBe("all 5 tests pass");
  });

  it("writes the .report.md file to <plansDir>/<plan_id>.report.md", async () => {
    const plan = setupPlan();
    const layout = resolveOverseerLayout(projectRoot);

    const cap = captureIO();
    const code = await runCli(["overseer", "plan-report", plan.plan_id], cap.io);
    expect(code).toBe(0);

    const expectedPath = join(layout.plansDir, `${plan.plan_id}.report.md`);
    expect(existsSync(expectedPath)).toBe(true);

    const content = readFileSync(expectedPath, "utf8");
    expect(content).toContain("# Plan Report:");
    expect(content).toContain(plan.plan_id);
    expect(content).toContain("add search endpoint");
    expect(content).toContain("implement GET /search");
  });
});

// ── buildPlanReport (unit tests) ─────────────────────────────────────────────

describe("buildPlanReport unit tests", () => {
  it("creates correct summary counts from mixed statuses", () => {
    const layout = resolveOverseerLayout(projectRoot);
    const parsed = parseProjectPlanBlock(PLAN_BLOCK)!;
    const basePlan = buildProjectPlan(parsed, "h_source");

    // Manually set mixed statuses
    const tasks = [
      { ...basePlan.tasks[0]!, status: "completed" as const, handoff_id: "h_done" },
      { ...basePlan.tasks[1]!, status: "failed" as const, handoff_id: "h_fail" },
    ];
    const plan = { ...basePlan, tasks };

    // Write handoff results
    const results = [
      { run_id: "h_done", status: "completed", summary: "Done fine" },
      { run_id: "h_fail", status: "failed", summary: "Build error", blockers: ["missing dep"] },
    ];
    writeFileSync(
      layout.handoffResultsPath,
      results.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8",
    );

    const report = buildPlanReport(layout, plan);

    expect(report.summary.total).toBe(2);
    expect(report.summary.completed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.blocked).toBe(0);
    expect(report.summary.pending).toBe(0);

    const t1 = report.tasks.find((t) => t.id === "t1");
    expect(t1?.result_summary).toBe("Done fine");

    const t2 = report.tasks.find((t) => t.id === "t2");
    expect(t2?.result_summary).toBe("Build error");
    expect(t2?.blockers).toEqual(["missing dep"]);

    // Markdown should include goal, task table, Q&A
    expect(report.markdown).toContain("add search endpoint");
    expect(report.markdown).toContain("## Tasks");
    expect(report.markdown).toContain("## Questions & Answers");
    expect(report.plan_id).toBe(plan.plan_id);
    expect(report.goal).toBe("add search endpoint");
    expect(report.generated_at).toBeTruthy();
  });

  it("handles missing handoff_results.jsonl gracefully — no tasks have result data", () => {
    const layout = resolveOverseerLayout(projectRoot);
    const parsed = parseProjectPlanBlock(PLAN_BLOCK)!;
    const plan = buildProjectPlan(parsed, "h_source");

    // No results file — should not throw
    const report = buildPlanReport(layout, plan);

    expect(report.summary.total).toBe(2);
    expect(report.summary.completed).toBe(0);
    expect(report.tasks[0]?.result_summary).toBeUndefined();
    expect(report.markdown).toContain("# Plan Report:");
  });
});
