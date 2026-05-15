import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readHandoffResults } from "../src/tools/read_handoff_results.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-read-handoff-results-"));
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

describe("read_handoff_results", () => {
  it("returns empty results by default and does not create overseer dir when state is missing", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readHandoffResults({});

    expect(result.ok).toBe(true);
    expect(result.workspace_path.endsWith("/.relayos/overseer")).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.results_count).toBe(0);
    expect(result.limit).toBe(8);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("returns latest bounded results in chronological order", async () => {
    const cwd = tempDir();
    chdir(cwd);
    writeResults(cwd, [
      { ts: "2026-01-01T00:00:00.000Z", run_id: "run-a", status: "completed", summary: "a" },
      { ts: "2026-01-01T00:01:00.000Z", run_id: "run-b", status: "failed", summary: "b" },
      { ts: "2026-01-01T00:02:00.000Z", run_id: "run-c", status: "blocked", summary: "c" },
    ]);

    const result = await readHandoffResults({ limit: 2 });

    expect(result.limit).toBe(2);
    expect(result.results_count).toBe(2);
    expect(result.results).toEqual([
      { ts: "2026-01-01T00:01:00.000Z", run_id: "run-b", status: "failed", summary: "b" },
      { ts: "2026-01-01T00:02:00.000Z", run_id: "run-c", status: "blocked", summary: "c" },
    ]);
  });

  it("returns empty results when workspace exists but file is missing", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const dir = join(cwd, ".relayos", "overseer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "NEXT_ACTION.md"), "review tests\n", "utf8");

    const result = await readHandoffResults({});

    expect(result.results).toEqual([]);
    expect(result.results_count).toBe(0);
    expect(result.limit).toBe(8);
    expect(typeof result.workspace_path).toBe("string");
  });

  it("rejects invalid limit values and unexpected fields", async () => {
    chdir(tempDir());
    await expect(readHandoffResults({ limit: 0 })).rejects.toThrow();
    await expect(readHandoffResults({ limit: 21 })).rejects.toThrow();
    await expect(readHandoffResults({ limit: 2.5 })).rejects.toThrow();
    await expect(readHandoffResults({ limit: "2" })).rejects.toThrow();
    await expect(readHandoffResults({ limit: 2, bad: true })).rejects.toThrow();
  });
});
