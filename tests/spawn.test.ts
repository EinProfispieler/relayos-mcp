import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { detectCli, runTarget } from "../src/spawn/index.js";
import { stdoutLogPath, stderrLogPath } from "../src/storage.js";
import { tempLayout } from "./_helpers.js";

describe("detectCli", () => {
  it("returns found=true for `node` (always present in the test env)", async () => {
    const r = await detectCli("node");
    expect(r.found).toBe(true);
    expect(r.target_binary).toBe("node");
    expect(r.resolved_path && r.resolved_path.length > 0).toBe(true);
  });

  it("returns found=false for a clearly-missing binary", async () => {
    const r = await detectCli("definitely-not-a-real-binary-xyz-987654321");
    expect(r.found).toBe(false);
    expect(r.resolved_path).toBeUndefined();
  });
});

describe("runTarget", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it("captures stdout/stderr to disk and returns tails + exit_code", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const id = "h_TEST_SPAWN";
    const r = await runTarget({
      layout,
      handoffId: id,
      binary: "/bin/sh",
      argv: ["/bin/sh", "-c", "echo hello-stdout; echo hello-stderr 1>&2; exit 0"],
    });
    expect(r.exit_code).toBe(0);
    expect(r.stdout_tail).toContain("hello-stdout");
    expect(r.stderr_tail).toContain("hello-stderr");
    expect(existsSync(stdoutLogPath(layout, id))).toBe(true);
    expect(existsSync(stderrLogPath(layout, id))).toBe(true);
    expect(r.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("reports non-zero exit codes", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const r = await runTarget({
      layout,
      handoffId: "h_FAIL",
      binary: "/bin/sh",
      argv: ["/bin/sh", "-c", "exit 7"],
    });
    expect(r.exit_code).toBe(7);
  });
});
