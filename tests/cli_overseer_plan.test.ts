import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chdir, cwd } from "node:process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";

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

const PLAN_OUTPUT = `Planning complete.

PROJECT_PLAN
goal: add a settings export command
questions:
  - Which format — JSON or YAML?
tasks:
  - id: t1
    title: implement the export command
    target: codex
    model: gpt-5.5
    effort: medium
    mode: patch
    description: add relayos settings export
    depends_on: []
reporting: write_handoff_result with status and summary
END_PROJECT_PLAN`;

beforeEach(() => {
  prevCwd = cwd();
  handoffRoot = mkdtempSync(join(tmpdir(), "relayos-plan-handoff-"));
  projectRoot = mkdtempSync(join(tmpdir(), "relayos-plan-project-"));
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

function writePlanHandoff(id: string, stdout: string) {
  writeFileSync(
    join(handoffRoot, "envelopes", `${id}.json`),
    JSON.stringify({ id, status: "completed", target_agent: "claude", execution_mode: "plan" }),
    "utf8",
  );
  writeFileSync(join(handoffRoot, "envelopes", `${id}.stdout.log`), stdout, "utf8");
}

describe("relayos overseer plan-extract", () => {
  it("returns usage when handoff id is missing", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-extract"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Usage:");
  });

  it("fails when the handoff is not found", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-extract", "h_missing"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("not found");
  });

  it("fails when no PROJECT_PLAN block is present", async () => {
    writePlanHandoff("h_noplan", "just normal output, no block");
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-extract", "h_noplan"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("No valid PROJECT_PLAN");
  });

  it("extracts, persists, and emits the plan", async () => {
    writePlanHandoff("h_plan", PLAN_OUTPUT);
    const cap = captureIO();
    const code = await runCli(["overseer", "plan-extract", "h_plan"], cap.io);
    expect(code).toBe(0);

    const planLine = cap.stdout
      .split("\n")
      .find((l) => l.startsWith("@@RELAYOS_PLAN@@ "));
    expect(planLine).toBeDefined();
    const plan = JSON.parse(planLine!.slice("@@RELAYOS_PLAN@@ ".length));
    expect(plan.goal).toBe("add a settings export command");
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].target).toBe("codex");
    expect(plan.source_handoff_id).toBe("h_plan");

    const planFile = join(projectRoot, ".relayos", "overseer", "plans", `${plan.plan_id}.json`);
    expect(existsSync(planFile)).toBe(true);
    const persisted = JSON.parse(readFileSync(planFile, "utf8"));
    expect(persisted.plan_id).toBe(plan.plan_id);
  });
});
