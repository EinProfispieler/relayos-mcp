import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerContextPack } from "../src/tools/read_overseer_context_pack.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-context-pack-"));
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

describe("read_overseer_context_pack", () => {
  it("returns compact read-only context pack with defaults when state is missing", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerContextPack({});

    expect(result.ok).toBe(false);
    expect(result.protocol).toBe("relayos-overseer-session-v1");
    expect(result.tool).toBe("read_overseer_context_pack");
    expect(result.context_complete).toBe(false);
    expect(result.workspace_path.endsWith("/.relayos/overseer")).toBe(true);
    expect(result.project_summary).toBeNull();
    expect(result.current_state).toBeNull();
    expect(result.next_action).toBeNull();
    expect(result.model_policy).toBeNull();
    expect(result.recent_notes).toEqual([]);
    expect(result.notes_count).toBe(0);
    expect(result.recent_decisions).toEqual([]);
    expect(result.decisions_count).toBe(0);
    expect(result.limit).toBe(8);
    expect(Array.isArray(result.forbidden_actions)).toBe(true);
    expect(result.recommended_prompt).toContain("exactly one next safe action");
    expect(Array.isArray(result.evidence_links)).toBe(true);
    expect(result.evidence_links.length).toBeGreaterThanOrEqual(9);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("returns compact fields and bounded notes when state files exist", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const dir = join(cwd, ".relayos", "overseer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROJECT_BRIEF.md"), "# Brief\nRelayOS coordination project.\n", "utf8");
    writeFileSync(join(dir, "CURRENT_STATE.md"), "# Current State\nStable milestone shipped.\n", "utf8");
    writeFileSync(join(dir, "NEXT_ACTION.md"), "review scoped docs\n", "utf8");
    writeFileSync(join(dir, "MODEL_POLICY.md"), "# Model Policy\nUse medium effort by default.\n", "utf8");
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

    const result = await readOverseerContextPack({ limit: 2 });

    expect(result.limit).toBe(2);
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
    expect(result.project_summary).toBe("RelayOS coordination project.");
    expect(result.current_state).toBe("Stable milestone shipped.");
    expect(result.next_action).toBe("review scoped docs");
    expect(result.model_policy).toBe("Use medium effort by default.");
  });

  it("rejects invalid limit values and unexpected fields", async () => {
    chdir(tempDir());
    await expect(readOverseerContextPack({ limit: 0 })).rejects.toThrow();
    await expect(readOverseerContextPack({ limit: 21 })).rejects.toThrow();
    await expect(readOverseerContextPack({ limit: 2.5 })).rejects.toThrow();
    await expect(readOverseerContextPack({ limit: "2" })).rejects.toThrow();
    await expect(readOverseerContextPack({ limit: 2, bad: true })).rejects.toThrow();
  });
});
