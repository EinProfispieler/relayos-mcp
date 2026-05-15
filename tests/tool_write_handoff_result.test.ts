import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { writeHandoffResult } from "../src/tools/write_handoff_result.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-write-handoff-result-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("write_handoff_result", () => {
  it("records one handoff result and returns compact payload", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await writeHandoffResult({
      run_id: "run-1",
      status: "completed",
      summary: "done",
    });

    expect(result.ok).toBe(true);
    expect(result.recorded.run_id).toBe("run-1");
    expect(result.recorded.status).toBe("completed");
    expect(result.recorded.summary).toBe("done");
    expect(result.results_path.endsWith("/.relayos/overseer/handoff_results.jsonl")).toBe(true);
    expect(existsSync(result.results_path)).toBe(true);
  });

  it("records optional evidence fields", async () => {
    chdir(tempDir());

    const result = await writeHandoffResult({
      run_id: "run-2",
      status: "needs_review",
      summary: "needs review",
      tests_run: ["npm test", "npm run lint"],
      test_result: "pass",
      blockers: ["pending approval"],
      needs_review: true,
      requires_user_approval: true,
    });

    expect(result.recorded.tests_run).toEqual(["npm test", "npm run lint"]);
    expect(result.recorded.test_result).toBe("pass");
    expect(result.recorded.blockers).toEqual(["pending approval"]);
    expect(result.recorded.needs_review).toBe(true);
    expect(result.recorded.requires_user_approval).toBe(true);
  });

  it("matches CLI entry field names and append semantics", async () => {
    const cwd = tempDir();
    chdir(cwd);

    await runCli(
      ["overseer", "handoff-result", "add", "--run-id", "run-cli", "--status", "completed", "--summary", "cli"],
      { stdout: { write: () => {} }, stderr: { write: () => {} } },
    );
    await writeHandoffResult({ run_id: "run-mcp", status: "failed", summary: "mcp" });

    const resultsPath = join(cwd, ".relayos", "overseer", "handoff_results.jsonl");
    const lines = readFileSync(resultsPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.run_id).toBe("run-cli");
    expect(lines[1]?.run_id).toBe("run-mcp");
    expect(lines[1]?.status).toBe("failed");
    expect(lines[1]?.summary).toBe("mcp");
    expect(Object.keys(lines[1] ?? {}).sort()).toEqual(["run_id", "status", "summary", "ts"]);
  });

  it("rejects missing/empty/whitespace run_id and summary", async () => {
    chdir(tempDir());
    await expect(writeHandoffResult({ status: "completed", summary: "ok" })).rejects.toThrow();
    await expect(
      writeHandoffResult({ run_id: "", status: "completed", summary: "ok" }),
    ).rejects.toThrow();
    await expect(
      writeHandoffResult({ run_id: "   ", status: "completed", summary: "ok" }),
    ).rejects.toThrow();
    await expect(
      writeHandoffResult({ run_id: "run", status: "completed", summary: "" }),
    ).rejects.toThrow();
    await expect(
      writeHandoffResult({ run_id: "run", status: "completed", summary: "   " }),
    ).rejects.toThrow();
  });

  it("rejects invalid status and unexpected extra fields", async () => {
    chdir(tempDir());
    await expect(
      writeHandoffResult({ run_id: "run", status: "queued", summary: "bad" }),
    ).rejects.toThrow();
    await expect(
      writeHandoffResult({ run_id: "run", status: "completed", summary: "ok", bad: true }),
    ).rejects.toThrow();
  });
});
