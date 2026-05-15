import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerDoctor } from "../src/tools/read_overseer_doctor.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-doctor-tool-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("read_overseer_doctor", () => {
  it("returns stable read-only doctor payload shape", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerDoctor({});

    expect(result.tool).toBe("overseer-doctor");
    expect(typeof result.ok).toBe("boolean");
    expect(result.workspace_path.endsWith("/.relayos/overseer")).toBe(true);
    expect(typeof result.version).toBe("string");
    expect(typeof result.context_complete).toBe("boolean");
    expect(Array.isArray(result.missing)).toBe(true);
    expect(typeof result.recent_notes_count).toBe("number");
    expect(typeof result.recent_decisions_count).toBe("number");
    expect(typeof result.recent_handoff_results_count).toBe("number");
    expect(typeof result.handoff_results_available).toBe("boolean");
    expect(typeof result.run_preflight_ready).toBe("boolean");
    expect(Array.isArray(result.tracked_local_state_files)).toBe(true);
    expect(typeof result.stale_build_possible).toBe("boolean");
    expect(Array.isArray(result.checks)).toBe(true);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(
      [
        "ready",
        "run npm run build",
        "initialize/fix local overseer context",
        "inspect missing files",
      ].includes(result.recommended_next_action),
    ).toBe(true);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("reports tracked local overseer state files when present", async () => {
    const cwd = tempDir();
    chdir(cwd);
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "dev@example.com"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Dev"], { cwd, stdio: "ignore" });
    const dir = join(cwd, ".relayos", "overseer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tracked.txt"), "tracked\n", "utf8");
    execFileSync("git", ["add", ".relayos/overseer/tracked.txt"], { cwd, stdio: "ignore" });

    const result = await readOverseerDoctor({});

    expect(Array.isArray(result.tracked_local_state_files)).toBe(true);
    expect(result.tracked_local_state_files).toContain(".relayos/overseer/tracked.txt");
  });

  it("rejects unexpected input fields", async () => {
    chdir(tempDir());
    await expect(readOverseerDoctor({ bad: true })).rejects.toThrow();
  });

  it("reports handoff result evidence availability based on local records", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const resultMissing = await readOverseerDoctor({});
    expect(resultMissing.recent_handoff_results_count).toBe(0);
    expect(resultMissing.handoff_results_available).toBe(false);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);

    const dir = join(cwd, ".relayos", "overseer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "handoff_results.jsonl"),
      `${JSON.stringify({
        ts: "2026-01-01T00:00:00.000Z",
        run_id: "run-1",
        status: "completed",
        summary: "ok",
      })}\n`,
      "utf8",
    );

    const resultPresent = await readOverseerDoctor({});
    expect(resultPresent.recent_handoff_results_count).toBe(1);
    expect(resultPresent.handoff_results_available).toBe(true);
  });
});
