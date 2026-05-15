import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerRoleProfile } from "../src/tools/read_overseer_role_profile.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-role-profile-tool-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("read_overseer_role_profile", () => {
  it("returns stable static role profile shape", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerRoleProfile({});

    expect(result.role.name).toBe("RelayOS Overseer");
    expect(result.role.description).toBe(
      "high-reasoning human-facing supervisory/control role",
    );
    expect(result.role.recommended_model).toBe("GPT-5.5 Thinking or equivalent");
    expect(result.role.recommended_effort).toBe("medium_or_high");
    expect(result.activation_phrases).toContain("Overseer mode.");
    expect(result.startup_sequence[0]).toBe("read_overseer_role_profile");
    expect(result.startup_sequence).toContain("read_handoff_results");
    expect(result.reporting_style.requirements).toContain("use separate labeled sections.");
    expect(result.reporting_style.requirements).toContain("avoid dense inline prose.");
    expect(result.reporting_style.status_markers).toContain("✅ PASS");
    expect(result.reporting_style.status_markers).toContain("⚠️ WARNING");
    expect(result.reporting_style.status_markers).toContain("🟡 NEEDS APPROVAL");
    expect(result.reporting_style.default_sections).toContain("🔁 Delegation");
    expect(result.reporting_style.default_sections).toContain("🟡 Approval needed");
    expect(result.reporting_style.rules).toContain(
      "Always separate overseer model/effort from delegated worker model/effort.",
    );
    expect(result.reporting_style.rules).toContain(
      "Do not compress Target / Model / Effort into one sentence.",
    );
    expect(result.safety_policy.length).toBeGreaterThan(0);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("enforces strict empty input", async () => {
    chdir(tempDir());
    await expect(readOverseerRoleProfile({ bad: true })).rejects.toThrow();
  });
});
