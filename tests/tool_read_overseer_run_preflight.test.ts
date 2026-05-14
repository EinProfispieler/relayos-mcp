import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerRunPreflight } from "../src/tools/read_overseer_run_preflight.js";

const cleanups: Array<() => void> = [];
let previousCwd: string | undefined;

afterEach(() => {
  if (previousCwd) {
    process.chdir(previousCwd);
    previousCwd = undefined;
  }
  while (cleanups.length) cleanups.pop()!();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-run-preflight-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("read_overseer_run_preflight", () => {
  it("returns read-only preflight JSON shape with missing context", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerRunPreflight({});

    expect(result.ok).toBe(true);
    expect(result.tool).toBe("run-preflight");
    expect(typeof result.workspace_path).toBe("string");
    expect(result.context_complete).toBe(false);
    expect(Array.isArray(result.missing)).toBe(true);
    expect(Array.isArray(result.checks)).toBe(true);
    expect(typeof result.recent_notes_count).toBe("number");
    expect(result.runtime_active).toBe(false);
    expect(result.runner_active).toBe(false);
    expect(result.queue_active).toBe(false);
    expect(typeof result.ready_for_future_run).toBe("boolean");
    expect(Array.isArray(result.notes)).toBe(true);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("reports ready_for_future_run true when required files are present", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const dir = join(cwd, ".relayos", "overseer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROJECT_BRIEF.md"), "brief\n", "utf8");
    writeFileSync(join(dir, "CURRENT_STATE.md"), "current\n", "utf8");
    writeFileSync(join(dir, "OPERATING_POLICY.md"), "policy\n", "utf8");
    writeFileSync(join(dir, "NEXT_ACTION.md"), "next\n", "utf8");
    writeFileSync(join(dir, "FORBIDDEN_ACTIONS.md"), "forbidden\n", "utf8");
    writeFileSync(join(dir, "MODEL_POLICY.md"), "model\n", "utf8");
    writeFileSync(
      join(dir, "timeline.jsonl"),
      `${JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", text: "note" })}\n`,
      "utf8",
    );

    const result = await readOverseerRunPreflight({});

    expect(result.context_complete).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.ready_for_future_run).toBe(true);
    expect(result.checks.every((c) => c.status === "pass")).toBe(true);
    expect(result.recent_notes_count).toBe(1);
  });

  it("rejects unexpected input fields", async () => {
    chdir(tempDir());
    await expect(readOverseerRunPreflight({ bad: true })).rejects.toThrow();
  });
});
