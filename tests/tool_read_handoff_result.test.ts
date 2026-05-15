import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readHandoffResult } from "../src/tools/read_handoff_result.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-read-handoff-result-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

function writeResults(cwd: string, lines: Array<Record<string, unknown>>) {
  const dir = join(cwd, ".relayos", "overseer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "handoff_results.jsonl"),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    "utf8",
  );
}

describe("read_handoff_result", () => {
  it("returns empty results for missing state and does not create overseer dir", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readHandoffResult({ run_id: "run-1" });

    expect(result.ok).toBe(true);
    expect(result.workspace_path.endsWith("/.relayos/overseer")).toBe(true);
    expect(result.run_id).toBe("run-1");
    expect(result.results).toEqual([]);
    expect(result.results_count).toBe(0);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("filters results by run_id in append order", async () => {
    const cwd = tempDir();
    chdir(cwd);
    writeResults(cwd, [
      { ts: "2026-01-01T00:00:00.000Z", run_id: "run-z", status: "blocked", summary: "z1" },
      { ts: "2026-01-01T00:01:00.000Z", run_id: "run-x", status: "failed", summary: "x1" },
      { ts: "2026-01-01T00:02:00.000Z", run_id: "run-z", status: "completed", summary: "z2" },
    ]);

    const result = await readHandoffResult({ run_id: "run-z" });

    expect(result.run_id).toBe("run-z");
    expect(result.results_count).toBe(2);
    expect(result.results).toEqual([
      { ts: "2026-01-01T00:00:00.000Z", run_id: "run-z", status: "blocked", summary: "z1" },
      { ts: "2026-01-01T00:02:00.000Z", run_id: "run-z", status: "completed", summary: "z2" },
    ]);
  });

  it("rejects missing/empty/whitespace run_id and unexpected fields", async () => {
    chdir(tempDir());
    await expect(readHandoffResult({})).rejects.toThrow();
    await expect(readHandoffResult({ run_id: "" })).rejects.toThrow();
    await expect(readHandoffResult({ run_id: "   " })).rejects.toThrow();
    await expect(readHandoffResult({ run_id: "x", bad: true })).rejects.toThrow();
  });
});
