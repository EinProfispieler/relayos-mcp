import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { chdir, cwd } from "node:process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";
import { getTaskErrorContext, buildFixHandoffInput } from "../src/project_plan.js";
import type { StorageLayout } from "../src/storage.js";
import type { ProjectPlanTask as ProjectPlanTaskT, ProjectPlan as ProjectPlanT } from "../src/schema.js";

let handoffRoot = "";
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
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

beforeEach(() => {
  prevCwd = cwd();
  handoffRoot = mkdtempSync(join(tmpdir(), "relayos-phase3-handoff-"));
  projectRoot = mkdtempSync(join(tmpdir(), "relayos-phase3-project-"));
  mkdirSync(join(handoffRoot, "envelopes"), { recursive: true });
  process.env.HANDOFF_DIR = handoffRoot;
  chdir(projectRoot);
});

afterEach(() => {
  chdir(prevCwd);
  if (prevHandoffDir === undefined) delete process.env.HANDOFF_DIR;
  else process.env.HANDOFF_DIR = prevHandoffDir;
  rmSync(handoffRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

/** Write a minimal plan to the overseer plans dir. */
function writePlan(planId: string): void {
  const plansDir = join(projectRoot, ".relayos", "overseer", "plans");
  mkdirSync(plansDir, { recursive: true });
  const plan = {
    plan_id: planId,
    created_at: new Date().toISOString(),
    goal: "test goal",
    questions: [],
    answers: [],
    tasks: [
      {
        id: "t1",
        title: "implement feature",
        target: "codex",
        model: "gpt-5.5",
        effort: "medium",
        mode: "patch",
        description: "do the thing",
        depends_on: [],
        status: "pending",
        retry_count: 0,
      },
    ],
    reporting: "",
    status: "ready",
  };
  writeFileSync(join(plansDir, `${planId}.json`), JSON.stringify(plan, null, 2), "utf8");
}

/** Write a completed envelope to simulate a pre-executed handoff. */
function writeCompletedEnvelope(id: string, exitCode: number): void {
  const envelope = {
    id,
    status: "completed",
    target_agent: "codex",
    execution_mode: "patch",
    launch_command: "codex exec",
    working_dir: projectRoot,
    spawn: {
      exit_code: exitCode,
      stdout_tail: "done",
      stderr_tail: "",
    },
  };
  writeFileSync(
    join(handoffRoot, "envelopes", `${id}.json`),
    JSON.stringify(envelope),
    "utf8",
  );
}

describe("relayos overseer plan-execute-task — argument validation", () => {
  it("returns usage when plan_id is missing", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-execute-task"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Usage:");
  });

  it("returns usage when task_id is missing", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-execute-task", "plan_ABC"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Usage:");
  });
});

describe("relayos overseer plan-execute-task — not found errors", () => {
  it("fails when plan is not found", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-execute-task", "plan_MISSING", "t1"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("not found");
  });

  it("fails when task is not found in existing plan", async () => {
    writePlan("plan_A");
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-execute-task", "plan_A", "t_NOPE"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("not found");
  });
});

describe("getTaskErrorContext", () => {
  it("returns empty string when no log files exist", () => {
    const layout: StorageLayout = {
      root: handoffRoot,
      auditPath: join(handoffRoot, "audit.jsonl"),
      envelopesDir: join(handoffRoot, "envelopes"),
      checkpointsDir: join(handoffRoot, "checkpoints"),
    };
    const ctx = getTaskErrorContext(layout, "h_nonexistent");
    expect(ctx).toBe("");
  });

  it("returns stdout content from log file", () => {
    const layout: StorageLayout = {
      root: handoffRoot,
      auditPath: join(handoffRoot, "audit.jsonl"),
      envelopesDir: join(handoffRoot, "envelopes"),
      checkpointsDir: join(handoffRoot, "checkpoints"),
    };
    writeFileSync(join(handoffRoot, "envelopes", "h_test.stdout.log"), "build failed: syntax error", "utf8");
    const ctx = getTaskErrorContext(layout, "h_test");
    expect(ctx).toContain("build failed: syntax error");
    expect(ctx).toContain("--- stdout ---");
  });

  it("returns stderr content from log file", () => {
    const layout: StorageLayout = {
      root: handoffRoot,
      auditPath: join(handoffRoot, "audit.jsonl"),
      envelopesDir: join(handoffRoot, "envelopes"),
      checkpointsDir: join(handoffRoot, "checkpoints"),
    };
    writeFileSync(join(handoffRoot, "envelopes", "h_err.stderr.log"), "Error: cannot find module", "utf8");
    const ctx = getTaskErrorContext(layout, "h_err");
    expect(ctx).toContain("Error: cannot find module");
    expect(ctx).toContain("--- stderr ---");
  });

  it("caps output to ~4000 chars", () => {
    const layout: StorageLayout = {
      root: handoffRoot,
      auditPath: join(handoffRoot, "audit.jsonl"),
      envelopesDir: join(handoffRoot, "envelopes"),
      checkpointsDir: join(handoffRoot, "checkpoints"),
    };
    const bigContent = "x".repeat(10000);
    writeFileSync(join(handoffRoot, "envelopes", "h_big.stdout.log"), bigContent, "utf8");
    const ctx = getTaskErrorContext(layout, "h_big");
    expect(ctx.length).toBeLessThanOrEqual(4500); // cap is ~4000 with some header overhead
  });
});

describe("buildFixHandoffInput", () => {
  it("augments description with error context and attempt number", () => {
    const task: ProjectPlanTaskT = {
      id: "t1",
      title: "implement feature",
      target: "codex",
      model: "gpt-5.5",
      effort: "medium",
      mode: "patch",
      description: "do the thing",
      depends_on: [],
      status: "pending",
      retry_count: 0,
    };

    const plan: ProjectPlanT = {
      plan_id: "plan_TEST",
      created_at: new Date().toISOString(),
      goal: "test goal",
      questions: [],
      answers: [],
      tasks: [task],
      reporting: "",
      status: "ready",
    };

    const fixInput = buildFixHandoffInput(task, plan, "/tmp/cwd", "h_orig_123", "TypeError: foo is not a function", 1);

    expect(fixInput.task_description).toContain("Fix attempt 1");
    expect(fixInput.task_description).toContain("h_orig_123");
    expect(fixInput.task_description).toContain("TypeError: foo is not a function");
    expect(fixInput.task_description).toContain("do the thing"); // original description preserved
    expect(fixInput.task_title).toContain("[fix-1]");
  });

  it("includes '(no output captured)' when error context is empty", () => {
    const task: ProjectPlanTaskT = {
      id: "t2",
      title: "another task",
      target: "claude",
      model: "claude-sonnet-4-5",
      effort: "low",
      mode: "review",
      description: "review the code",
      depends_on: [],
      status: "pending",
      retry_count: 0,
    };

    const plan: ProjectPlanT = {
      plan_id: "plan_TEST2",
      created_at: new Date().toISOString(),
      goal: "review goal",
      questions: [],
      answers: [],
      tasks: [task],
      reporting: "",
      status: "ready",
    };

    const fixInput = buildFixHandoffInput(task, plan, "/tmp/cwd", "h_empty", "", 2);
    expect(fixInput.task_description).toContain("(no output captured)");
    expect(fixInput.task_title).toContain("[fix-2]");
  });
});
