import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeOverseerNote } from "../src/tools/write_overseer_note.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-write-note-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("write_overseer_note", () => {
  it("records a note and returns a compact result payload", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await writeOverseerNote({ text: "first note" });

    expect(result.ok).toBe(true);
    expect(result.recorded).toBe("first note");
    expect(result.timeline_path.endsWith("/.relayos/overseer/timeline.jsonl")).toBe(true);
    expect(existsSync(result.timeline_path)).toBe(true);
  });

  it("appends timestamped note entries to local timeline jsonl", async () => {
    const cwd = tempDir();
    chdir(cwd);

    await writeOverseerNote({ text: "first note" });
    await writeOverseerNote({ text: "second note" });

    const timelinePath = join(cwd, ".relayos", "overseer", "timeline.jsonl");
    const lines = readFileSync(timelinePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { ts: string; text: string });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toBe("first note");
    expect(lines[1]?.text).toBe("second note");
    expect(typeof lines[0]?.ts).toBe("string");
    expect(lines[0]?.ts.length).toBeGreaterThan(0);
  });

  it("rejects missing text", async () => {
    chdir(tempDir());
    await expect(writeOverseerNote({})).rejects.toThrow();
  });

  it("rejects empty or whitespace-only text", async () => {
    chdir(tempDir());
    await expect(writeOverseerNote({ text: "" })).rejects.toThrow();
    await expect(writeOverseerNote({ text: "   " })).rejects.toThrow();
  });

  it("rejects unexpected extra input fields", async () => {
    chdir(tempDir());
    await expect(writeOverseerNote({ text: "ok", bad: true })).rejects.toThrow();
  });
});
