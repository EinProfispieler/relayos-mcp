import { mkdtempSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerDecisions } from "../src/tools/read_overseer_decisions.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-read-decisions-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

function writeDecisions(cwd: string, lines: Array<{ ts: string; text: string }>) {
  const dir = join(cwd, ".relayos", "overseer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "decisions.jsonl"),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    "utf8",
  );
}

describe("read_overseer_decisions", () => {
  it("returns empty decisions with defaults when state is missing and does no writes", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerDecisions({});

    expect(result.ok).toBe(true);
    expect(result.workspace_path.endsWith("/.relayos/overseer")).toBe(true);
    expect(result.decisions).toEqual([]);
    expect(result.decisions_count).toBe(0);
    expect(result.limit).toBe(8);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("returns recent decisions in chronological order and applies limit", async () => {
    const cwd = tempDir();
    chdir(cwd);
    writeDecisions(cwd, [
      { ts: "2026-01-01T00:00:00.000Z", text: "one" },
      { ts: "2026-01-01T00:01:00.000Z", text: "two" },
      { ts: "2026-01-01T00:02:00.000Z", text: "three" },
    ]);

    const result = await readOverseerDecisions({ limit: 2 });

    expect(result.limit).toBe(2);
    expect(result.decisions_count).toBe(2);
    expect(result.decisions).toEqual([
      { ts: "2026-01-01T00:01:00.000Z", text: "two" },
      { ts: "2026-01-01T00:02:00.000Z", text: "three" },
    ]);
  });

  it("returns empty decisions when workspace exists but decisions.jsonl is missing", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const dir = join(cwd, ".relayos", "overseer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "NEXT_ACTION.md"), "review tests\n", "utf8");

    const result = await readOverseerDecisions({});

    expect(Array.isArray(result.decisions)).toBe(true);
    expect(result.decisions).toEqual([]);
    expect(result.decisions_count).toBe(0);
    expect(result.limit).toBe(8);
    expect(typeof result.workspace_path).toBe("string");
  });

  it("rejects invalid limit values and unexpected fields", async () => {
    chdir(tempDir());
    await expect(readOverseerDecisions({ limit: 0 })).rejects.toThrow();
    await expect(readOverseerDecisions({ limit: 21 })).rejects.toThrow();
    await expect(readOverseerDecisions({ limit: 2.5 })).rejects.toThrow();
    await expect(readOverseerDecisions({ limit: "2" })).rejects.toThrow();
    await expect(readOverseerDecisions({ limit: 2, bad: true })).rejects.toThrow();
  });
});
