import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerCapabilities } from "../src/tools/read_overseer_capabilities.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-capabilities-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("read_overseer_capabilities", () => {
  it("returns stable read-only capability policy shape", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerCapabilities({});

    expect(result.ok).toBe(true);
    expect(result.tool).toBe("read_overseer_capabilities");
    expect(result.workspace_path.endsWith("/.relayos/overseer")).toBe(true);
    expect(typeof result.capability_policy_version).toBe("string");
    expect(Array.isArray(result.allowed_by_default)).toBe(true);
    expect(Array.isArray(result.requires_explicit_approval)).toBe(true);
    expect(Array.isArray(result.forbidden)).toBe(true);
    expect(Array.isArray(result.detected_surfaces)).toBe(true);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(result.allowed_by_default.join(" ")).toContain("Read repository files");
    expect(result.requires_explicit_approval.join(" ")).toContain("Commit, push, tag, or release");
    expect(result.forbidden.join(" ")).toContain("Provider/API/cloud/telemetry integration");
    expect(result.detected_surfaces).toContain("MCP: read_overseer_capabilities");
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("rejects unexpected input fields", async () => {
    chdir(tempDir());
    await expect(readOverseerCapabilities({ bad: true })).rejects.toThrow();
  });
});
