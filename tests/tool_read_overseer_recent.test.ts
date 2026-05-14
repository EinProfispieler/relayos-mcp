import { mkdtempSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerRecent } from "../src/tools/read_overseer_recent.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-recent-"));
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

describe("read_overseer_recent", () => {
  it("returns compact readback with defaults and no writes when overseer state is missing", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerRecent({});

    expect(result.ok).toBe(false);
    expect(result.context_complete).toBe(false);
    expect(result.workspace_path.endsWith("/.relayos/overseer")).toBe(true);
    expect(Array.isArray(result.missing)).toBe(true);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.next_action).toBeNull();
    expect(result.current_state).toBeNull();
    expect(result.recent_notes).toEqual([]);
    expect(result.notes_count).toBe(0);
    expect(result.limit).toBe(5);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("returns recent notes in chronological order and applies limit", async () => {
    const cwd = tempDir();
    chdir(cwd);
    writeTimeline(cwd, [
      { ts: "2026-01-01T00:00:00.000Z", text: "one" },
      { ts: "2026-01-01T00:01:00.000Z", text: "two" },
      { ts: "2026-01-01T00:02:00.000Z", text: "three" },
    ]);

    const result = await readOverseerRecent({ limit: 2 });

    expect(result.limit).toBe(2);
    expect(result.notes_count).toBe(2);
    expect(result.recent_notes).toEqual([
      { ts: "2026-01-01T00:01:00.000Z", text: "two" },
      { ts: "2026-01-01T00:02:00.000Z", text: "three" },
    ]);
  });

  it("reads compact next_action and current_state values", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const dir = join(cwd, ".relayos", "overseer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "NEXT_ACTION.md"), "ship patch now\n", "utf8");
    writeFileSync(
      join(dir, "CURRENT_STATE.md"),
      "# Current State\n\nAs of 2026-05-14: stable.\n\nMore detail.\n",
      "utf8",
    );

    const result = await readOverseerRecent({});

    expect(result.next_action).toBe("ship patch now");
    expect(result.current_state).toBe("As of 2026-05-14: stable.");
  });

  it("rejects invalid limit values and unexpected fields", async () => {
    chdir(tempDir());
    await expect(readOverseerRecent({ limit: 0 })).rejects.toThrow();
    await expect(readOverseerRecent({ limit: 21 })).rejects.toThrow();
    await expect(readOverseerRecent({ limit: 2.5 })).rejects.toThrow();
    await expect(readOverseerRecent({ limit: "2" })).rejects.toThrow();
    await expect(readOverseerRecent({ limit: 2, bad: true })).rejects.toThrow();
  });
});
