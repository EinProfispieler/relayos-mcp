import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { writeOverseerDecision } from "../src/tools/write_overseer_decision.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-write-decision-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("write_overseer_decision", () => {
  it("records a decision and returns a compact result payload", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await writeOverseerDecision({ text: "first decision" });

    expect(result.ok).toBe(true);
    expect(result.recorded).toBe("first decision");
    expect(result.decisions_path.endsWith("/.relayos/overseer/decisions.jsonl")).toBe(true);
    expect(existsSync(result.decisions_path)).toBe(true);
  });

  it("appends timestamped decision entries to local decisions jsonl", async () => {
    const cwd = tempDir();
    chdir(cwd);

    await writeOverseerDecision({ text: "first decision" });
    await writeOverseerDecision({ text: "second decision" });

    const decisionsPath = join(cwd, ".relayos", "overseer", "decisions.jsonl");
    const lines = readFileSync(decisionsPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { ts: string; text: string });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toBe("first decision");
    expect(lines[1]?.text).toBe("second decision");
    expect(Object.keys(lines[0] ?? {}).sort()).toEqual(["text", "ts"]);
    expect(Object.keys(lines[1] ?? {}).sort()).toEqual(["text", "ts"]);
    expect(typeof lines[0]?.ts).toBe("string");
    expect(lines[0]?.ts.length).toBeGreaterThan(0);
  });

  it("matches CLI decisions entry field names and append semantics", async () => {
    const cwd = tempDir();
    chdir(cwd);

    await runCli(
      ["overseer", "decision", "add", "from cli"],
      { stdout: { write: () => {} }, stderr: { write: () => {} } },
    );
    await writeOverseerDecision({ text: "from mcp" });

    const decisionsPath = join(cwd, ".relayos", "overseer", "decisions.jsonl");
    const lines = readFileSync(decisionsPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0] ?? {}).sort()).toEqual(["text", "ts"]);
    expect(Object.keys(lines[1] ?? {}).sort()).toEqual(["text", "ts"]);
    expect(lines[0]?.text).toBe("from cli");
    expect(lines[1]?.text).toBe("from mcp");
  });

  it("rejects missing text", async () => {
    chdir(tempDir());
    await expect(writeOverseerDecision({})).rejects.toThrow();
  });

  it("rejects empty or whitespace-only text", async () => {
    chdir(tempDir());
    await expect(writeOverseerDecision({ text: "" })).rejects.toThrow();
    await expect(writeOverseerDecision({ text: "   " })).rejects.toThrow();
  });

  it("rejects unexpected extra input fields", async () => {
    chdir(tempDir());
    await expect(writeOverseerDecision({ text: "ok", bad: true })).rejects.toThrow();
  });
});
