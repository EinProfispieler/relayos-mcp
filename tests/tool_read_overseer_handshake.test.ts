import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerHandshake } from "../src/tools/read_overseer_handshake.js";

const cleanups: Array<() => void> = [];
let previousCwd: string | undefined;
const REPO_ROOT = process.cwd();

afterEach(() => {
  if (previousCwd) {
    process.chdir(previousCwd);
    previousCwd = undefined;
  }
  while (cleanups.length) cleanups.pop()!();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-handshake-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("read_overseer_handshake", () => {
  it("returns incomplete handshake when canonical context files are missing", async () => {
    chdir(tempDir());

    const result = await readOverseerHandshake({});

    expect(result.ok).toBe(false);
    expect(result.protocol).toBe("relayos-overseer-session-v1");
    expect(result.session_role).toBe("overseer_client");
    expect(result.context_complete).toBe(false);
    expect(result.workspace_path).toBe(join(process.cwd(), ".relayos", "overseer"));
    expect(Array.isArray(result.files)).toBe(true);
    expect(Array.isArray(result.missing)).toBe(true);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(Array.isArray(result.must_read)).toBe(true);
    expect(Array.isArray(result.forbidden_actions)).toBe(true);
    expect(Array.isArray(result.requires_explicit_user_approval_for)).toBe(true);
    expect(Array.isArray(result.notes)).toBe(true);
  });

  it("returns complete handshake at repo root", async () => {
    chdir(REPO_ROOT);

    const result = await readOverseerHandshake({});

    expect(result.ok).toBe(true);
    expect(result.context_complete).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.next_action_source).toBe(
      join(REPO_ROOT, ".relayos", "overseer", "NEXT_ACTION.md"),
    );
    expect(result.files.every((f) => typeof f.name === "string" && typeof f.exists === "boolean")).toBe(true);
  });

  it("is read-only and does not create .relayos/overseer", async () => {
    const cwd = tempDir();
    chdir(cwd);

    await readOverseerHandshake({});

    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("rejects unexpected input fields", async () => {
    chdir(tempDir());

    await expect(readOverseerHandshake({ bad: true })).rejects.toThrow();
  });
});
