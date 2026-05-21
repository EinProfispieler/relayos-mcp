import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chdir, cwd } from "node:process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";
import { buildProjectPlan, parseProjectPlanBlock, persistProjectPlan } from "../src/project_plan.js";
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
  projectRoot = mkdtempSync(join(tmpdir(), "relayos-phase2-"));
  mkdirSync(join(projectRoot, ".relayos", "overseer", "plans"), { recursive: true });
  // Provide a dummy HANDOFF_DIR so plan-task-handoff can write envelopes
  const handoffRoot = mkdtempSync(join(tmpdir(), "relayos-phase2-hf-"));
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

// ── plan-answer ──────────────────────────────────────────────────────────────

describe("relayos overseer plan-answer", () => {
  it("returns usage when args are missing", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-answer"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Usage:");
  });

  it("fails when plan not found", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-answer", "plan_MISSING", "yes"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("not found");
  });

  it("appends answer to plan and emits sentinel", async () => {
    const plan = setupPlan();
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-answer", plan.plan_id, "yes, paginate results"], cap.io);
    expect(code).toBe(0);

    // Sentinel line present
    const sentinelLine = cap.stdout.split("\n").find((l) => l.startsWith("@@RELAYOS_PLAN_ANSWER@@ "));
    expect(sentinelLine).toBeDefined();
    const data = JSON.parse(sentinelLine!.slice("@@RELAYOS_PLAN_ANSWER@@ ".length));
    expect(data.plan_id).toBe(plan.plan_id);
    expect(data.answers).toHaveLength(1);
    expect(data.answers[0]).toBe("yes, paginate results");
  });

  it("accumulates multiple answers in order", async () => {
    const plan = setupPlan();
    const cap1 = captureIO();
    await runCli(["overseer", "plan-answer", plan.plan_id, "yes, paginate"], cap1.io);
    const cap2 = captureIO();
    await runCli(["overseer", "plan-answer", plan.plan_id, "max 20 items"], cap2.io);

    const data2 = JSON.parse(
      cap2.stdout.split("\n").find((l) => l.startsWith("@@RELAYOS_PLAN_ANSWER@@ "))!
        .slice("@@RELAYOS_PLAN_ANSWER@@ ".length),
    );
    expect(data2.answers).toHaveLength(2);
    expect(data2.answers[0]).toBe("yes, paginate");
    expect(data2.answers[1]).toBe("max 20 items");
  });
});

// ── plan-task-handoff ────────────────────────────────────────────────────────

describe("relayos overseer plan-task-handoff", () => {
  it("returns usage when args are missing", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-task-handoff"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Usage:");
  });

  it("fails when plan not found", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-task-handoff", "plan_MISSING", "t1"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("not found");
  });

  it("fails when task not found", async () => {
    const plan = setupPlan();
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-task-handoff", plan.plan_id, "t_bad"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Task not found");
  });

  it("creates handoff envelope and emits sentinel", async () => {
    const plan = setupPlan();
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-task-handoff", plan.plan_id, "t1"], cap.io);
    expect(code).toBe(0);

    const sentinelLine = cap.stdout.split("\n").find((l) => l.startsWith("@@RELAYOS_TASK_HANDOFF@@ "));
    expect(sentinelLine).toBeDefined();
    const data = JSON.parse(sentinelLine!.slice("@@RELAYOS_TASK_HANDOFF@@ ".length));
    expect(data.plan_id).toBe(plan.plan_id);
    expect(data.task_id).toBe("t1");
    expect(data.handoff_id).toMatch(/^h_/);
    expect(data.title).toBe("implement GET /search");

    // Envelope was written to HANDOFF_DIR
    const envelopePath = join(process.env.HANDOFF_DIR!, "envelopes", `${data.handoff_id}.json`);
    expect(existsSync(envelopePath)).toBe(true);
    const env = JSON.parse(readFileSync(envelopePath, "utf8"));
    expect(env.target_agent).toBe("codex");
    expect(env.execution_mode).toBe("patch");
  });

  it("re-emits sentinel if task already has handoff_id", async () => {
    const plan = setupPlan();
    // First call
    const cap1 = captureIO();
    await runCli(["overseer", "plan-task-handoff", plan.plan_id, "t1"], cap1.io);
    const first = JSON.parse(
      cap1.stdout.split("\n").find((l) => l.startsWith("@@RELAYOS_TASK_HANDOFF@@ "))!
        .slice("@@RELAYOS_TASK_HANDOFF@@ ".length),
    );
    // Second call — idempotent
    const cap2 = captureIO();
    await runCli(["overseer", "plan-task-handoff", plan.plan_id, "t1"], cap2.io);
    const second = JSON.parse(
      cap2.stdout.split("\n").find((l) => l.startsWith("@@RELAYOS_TASK_HANDOFF@@ "))!
        .slice("@@RELAYOS_TASK_HANDOFF@@ ".length),
    );
    expect(second.handoff_id).toBe(first.handoff_id);
  });
});

// ── store: PROJECT_PLAN_ANSWER / PROJECT_PLAN_TASK_UPDATE ──────────────────

describe("store Phase 2 actions", () => {
  // Import reducer + initialState inline from the compiled RTUI (bun) — instead,
  // re-verify via the CLI round-trip above. Store tests are in store.test.ts (bun).
  // This file just guards the CLI surface.
  it("placeholder — store actions tested in src/rtui/state/store.test.ts", () => {
    expect(true).toBe(true);
  });
});
