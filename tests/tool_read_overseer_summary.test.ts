import { mkdtempSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerSummary } from "../src/tools/read_overseer_summary.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-summary-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

function writeTimeline(cwd: string, lines: Array<{ ts: string; text: string }>) {
  const dir = join(cwd, ".relayos", "overseer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "timeline.jsonl"),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    "utf8",
  );
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

describe("read_overseer_summary", () => {
  it("returns deterministic read-only summary defaults when state is missing", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerSummary({});

    expect(result.protocol).toBe("relayos-overseer-session-v1");
    expect(result.tool).toBe("read_overseer_summary");
    expect(result.workspace_path.endsWith("/.relayos/overseer")).toBe(true);
    expect(result.limit).toBe(8);
    expect(result.recent_notes).toEqual([]);
    expect(result.notes_count).toBe(0);
    expect(result.recent_decisions).toEqual([]);
    expect(result.decisions_count).toBe(0);
    expect(result.run_preflight.tool).toBe("run-preflight");
    expect(result.recommended_next_action_prompt).toContain("exactly one next safe action");
    expect(Array.isArray(result.evidence_links)).toBe(true);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("returns bounded notes/decisions and preflight snapshot", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const dir = join(cwd, ".relayos", "overseer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROJECT_BRIEF.md"), "RelayOS project.\n", "utf8");
    writeFileSync(join(dir, "CURRENT_STATE.md"), "Stable.\n", "utf8");
    writeFileSync(join(dir, "NEXT_ACTION.md"), "review summary output\n", "utf8");
    writeFileSync(join(dir, "MODEL_POLICY.md"), "Use medium.\n", "utf8");
    writeFileSync(join(dir, "FORBIDDEN_ACTIONS.md"), "No tags.\n", "utf8");
    writeTimeline(cwd, [
      { ts: "2026-01-01T00:00:00.000Z", text: "one" },
      { ts: "2026-01-01T00:01:00.000Z", text: "two" },
      { ts: "2026-01-01T00:02:00.000Z", text: "three" },
    ]);
    writeDecisions(cwd, [
      { ts: "2026-01-01T00:03:00.000Z", text: "decision one" },
      { ts: "2026-01-01T00:04:00.000Z", text: "decision two" },
      { ts: "2026-01-01T00:05:00.000Z", text: "decision three" },
    ]);

    const result = await readOverseerSummary({ limit: 2 });

    expect(result.limit).toBe(2);
    expect(result.project_summary).toBe("RelayOS project.");
    expect(result.current_state).toBe("Stable.");
    expect(result.next_action).toBe("review summary output");
    expect(result.notes_count).toBe(2);
    expect(result.recent_notes).toEqual([
      { ts: "2026-01-01T00:01:00.000Z", text: "two" },
      { ts: "2026-01-01T00:02:00.000Z", text: "three" },
    ]);
    expect(result.decisions_count).toBe(2);
    expect(result.recent_decisions).toEqual([
      { ts: "2026-01-01T00:04:00.000Z", text: "decision two" },
      { ts: "2026-01-01T00:05:00.000Z", text: "decision three" },
    ]);
    expect(result.run_preflight.ok).toBe(true);
    expect(Array.isArray(result.run_preflight.checks)).toBe(true);
  });

  it("rejects invalid limit values and unexpected fields", async () => {
    chdir(tempDir());
    await expect(readOverseerSummary({ limit: 0 })).rejects.toThrow();
    await expect(readOverseerSummary({ limit: 21 })).rejects.toThrow();
    await expect(readOverseerSummary({ limit: 2.5 })).rejects.toThrow();
    await expect(readOverseerSummary({ limit: "2" })).rejects.toThrow();
    await expect(readOverseerSummary({ limit: 2, bad: true })).rejects.toThrow();
  });
});
