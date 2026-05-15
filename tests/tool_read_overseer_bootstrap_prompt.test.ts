import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerBootstrapPrompt } from "../src/tools/read_overseer_bootstrap_prompt.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-bootstrap-prompt-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("read_overseer_bootstrap_prompt", () => {
  it("returns a read-only bootstrap payload with protocol and recommended first calls", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerBootstrapPrompt({});

    expect(result.ok).toBe(false);
    expect(result.protocol).toBe("relayos-overseer-session-v1");
    expect(result.tool).toBe("read_overseer_bootstrap_prompt");
    expect(typeof result.prompt).toBe("string");
    expect(result.prompt).toContain("read_overseer_handshake {}");
    expect(result.prompt).toContain('read_overseer_summary {"limit":8}');
    expect(result.prompt).toContain('read_overseer_context_pack {"limit":8}');
    expect(result.prompt).toContain('read_overseer_recent {"limit":8}');
    expect(result.prompt).toContain("Do not commit/push/tag/release without explicit user approval.");
    expect(result.prompt).toContain("Recommend exactly one next safe action");
    expect(result.recommended_first_calls).toEqual([
      { tool: "read_overseer_handshake", input: {} },
      { tool: "read_overseer_summary", input: { limit: 8 } },
      { tool: "read_overseer_recent", input: { limit: 8 } },
    ]);
    expect(Array.isArray(result.safety_boundaries)).toBe(true);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("rejects unexpected input fields", async () => {
    chdir(tempDir());
    await expect(readOverseerBootstrapPrompt({ bad: true })).rejects.toThrow();
  });
});
