/**
 * Locks the doc/code consistency fix: `overseer status`, `recent`, and
 * `brief` must read UPPERCASE canonical context files when present, and
 * fall back to the legacy lowercase filenames only when the canonical
 * file is absent.
 *
 * Why this test exists:
 * - `docs/OVERSEER.md` Storage section claims canonical readers expect
 *   UPPERCASE names (`PROJECT_BRIEF.md`, `CURRENT_STATE.md`, …).
 * - Before this fix, three CLI handlers (`runOverseerStatus`,
 *   `runOverseerRecent`, `runOverseerBrief`) read lowercase legacy
 *   names directly (`project_brief.md`, `current.md`, …), making the
 *   doc claim false in practice. See `readOverseerCanonicalText` in
 *   `src/overseer.ts` for the wrapper introduced to bridge both.
 * - `init-context` (`src/overseer.ts:initContextFiles`) still writes
 *   lowercase stubs today; the legacy-fallback half of these tests
 *   keeps that path alive until init-context is rewritten.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { chdir, cwd } from "node:process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";
import {
  readOverseerCanonicalText,
  resolveOverseerLayout,
} from "../src/overseer.js";

/**
 * Probe the OS / filesystem for case-sensitivity. macOS APFS is case-
 * insensitive by default; ext4 + most Linux setups are case-sensitive.
 * The "both files exist simultaneously" tests below only make sense on
 * a case-sensitive FS — on macOS the second writeText overwrites the
 * first, so the "canonical wins" scenario cannot be physically
 * constructed.
 */
function detectCaseSensitiveFs(): boolean {
  const probeDir = mkdtempSync(join(tmpdir(), "relayos-fs-probe-"));
  try {
    writeFileSync(join(probeDir, "probe.txt"), "a", "utf8");
    // If the FS is case-insensitive, asking for "PROBE.txt" returns the
    // same file (existsSync returns true). On case-sensitive FS the
    // uppercase variant does not exist.
    return !existsSync(join(probeDir, "PROBE.txt"));
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

const CASE_SENSITIVE_FS = detectCaseSensitiveFs();

/**
 * `it` that auto-skips on case-insensitive filesystems. Used for the
 * "both files coexist" scenarios that cannot be reproduced on
 * macOS APFS / case-insensitive NTFS.
 */
const itCaseSensitive = CASE_SENSITIVE_FS ? it : it.skip;

let testRoot = "";
let overseerDir = "";
let prevCwd = "";

function captureIO() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write: (chunk: string) => (stdout += chunk) },
      stderr: { write: (chunk: string) => (stderr += chunk) },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function writeText(name: string, content: string) {
  writeFileSync(join(overseerDir, name), content, "utf8");
}

beforeEach(() => {
  prevCwd = cwd();
  testRoot = mkdtempSync(join(tmpdir(), "relayos-overseer-canon-"));
  overseerDir = join(testRoot, ".relayos", "overseer");
  mkdirSync(overseerDir, { recursive: true });
  chdir(testRoot);
});

afterEach(() => {
  chdir(prevCwd);
  rmSync(testRoot, { recursive: true, force: true });
});

// ── readOverseerCanonicalText helper itself ──────────────────────────

describe("readOverseerCanonicalText (helper)", () => {
  itCaseSensitive(
    "returns the UPPERCASE canonical when both files exist (canonical wins) — case-sensitive FS only",
    async () => {
      const layout = resolveOverseerLayout(testRoot);
      writeText("PROJECT_BRIEF.md", "from-canonical");
      writeText("project_brief.md", "from-legacy");
      const value = await readOverseerCanonicalText(
        layout,
        "PROJECT_BRIEF.md",
        "project_brief.md",
      );
      expect(value).toBe("from-canonical");
    },
  );

  it("falls back to legacy lowercase when canonical is absent", async () => {
    const layout = resolveOverseerLayout(testRoot);
    writeText("project_brief.md", "from-legacy");
    const value = await readOverseerCanonicalText(
      layout,
      "PROJECT_BRIEF.md",
      "project_brief.md",
    );
    expect(value).toBe("from-legacy");
  });

  it("returns null when neither file exists", async () => {
    const layout = resolveOverseerLayout(testRoot);
    const value = await readOverseerCanonicalText(
      layout,
      "PROJECT_BRIEF.md",
      "project_brief.md",
    );
    expect(value).toBeNull();
  });

  it("handles the irregular rename current.md → CURRENT_STATE.md", async () => {
    const layout = resolveOverseerLayout(testRoot);
    writeText("CURRENT_STATE.md", "canonical-state");
    writeText("current.md", "legacy-state");
    const value = await readOverseerCanonicalText(
      layout,
      "CURRENT_STATE.md",
      "current.md",
    );
    expect(value).toBe("canonical-state");
  });

  it("treats an empty/whitespace canonical file as absent and falls back", async () => {
    // readOverseerTextFile returns null for whitespace-only files, so a
    // user accidentally creating an empty PROJECT_BRIEF.md should still
    // get the legacy fallback rather than swallowing all content.
    const layout = resolveOverseerLayout(testRoot);
    writeText("PROJECT_BRIEF.md", "   \n\n   ");
    writeText("project_brief.md", "real legacy content");
    const value = await readOverseerCanonicalText(
      layout,
      "PROJECT_BRIEF.md",
      "project_brief.md",
    );
    expect(value).toBe("real legacy content");
  });
});

// ── End-to-end via the three CLI handlers ────────────────────────────

describe("overseer status — UPPERCASE-first / lowercase-fallback", () => {
  it("reads PROJECT_BRIEF.md + CURRENT_STATE.md when both canonical exist", async () => {
    writeText("PROJECT_BRIEF.md", "RelayOS is a local-first audit and handoff layer.");
    writeText("CURRENT_STATE.md", "`abc1234` — feat: P2 ship");
    const cap = captureIO();
    const code = await runCli(["overseer", "status", "--json"], cap.io);
    expect(code).toBe(0);
    const obj = JSON.parse(cap.stdout);
    expect(obj.project).toContain("local-first audit");
    expect(obj.currentState).not.toBeNull();
  });

  it("falls back to lowercase legacy when canonical absent", async () => {
    writeText("project_brief.md", "Legacy project brief.");
    writeText("current.md", "`def5678` — legacy state");
    const cap = captureIO();
    const code = await runCli(["overseer", "status", "--json"], cap.io);
    expect(code).toBe(0);
    const obj = JSON.parse(cap.stdout);
    expect(obj.project).toContain("Legacy project");
    expect(obj.currentState).not.toBeNull();
  });

  itCaseSensitive(
    "canonical wins when both UPPERCASE and lowercase exist — case-sensitive FS only",
    async () => {
      writeText("PROJECT_BRIEF.md", "Canonical brief content.");
      writeText("project_brief.md", "Legacy brief — should be hidden.");
      const cap = captureIO();
      await runCli(["overseer", "status", "--json"], cap.io);
      const obj = JSON.parse(cap.stdout);
      expect(obj.project).toContain("Canonical");
      expect(obj.project).not.toContain("Legacy");
    },
  );
});

describe("overseer recent — UPPERCASE-first / lowercase-fallback", () => {
  it("reads PROJECT_BRIEF.md when canonical present", async () => {
    writeText("PROJECT_BRIEF.md", "Canonical project line.");
    const cap = captureIO();
    const code = await runCli(["overseer", "recent", "--json"], cap.io);
    expect(code).toBe(0);
    const obj = JSON.parse(cap.stdout);
    expect(obj.project).toContain("Canonical project");
  });

  it("falls back to project_brief.md when canonical absent", async () => {
    writeText("project_brief.md", "Legacy project line.");
    const cap = captureIO();
    const code = await runCli(["overseer", "recent", "--json"], cap.io);
    expect(code).toBe(0);
    const obj = JSON.parse(cap.stdout);
    expect(obj.project).toContain("Legacy project");
  });
});

describe("overseer brief — UPPERCASE-first / lowercase-fallback (all 5 files)", () => {
  it("uses all UPPERCASE canonical context files when present", async () => {
    writeText("PROJECT_BRIEF.md", "## canonical brief content");
    writeText("CURRENT_STATE.md", "## canonical state content");
    writeText("RELEASE_POLICY.md", "## canonical release policy");
    writeText("FORBIDDEN_ACTIONS.md", "## canonical forbidden actions");
    writeText("PRODUCT_DIRECTION.md", "## canonical product direction");

    const cap = captureIO();
    const code = await runCli(["overseer", "brief"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("canonical brief content");
    expect(cap.stdout).toContain("canonical state content");
    expect(cap.stdout).toContain("canonical release policy");
    expect(cap.stdout).toContain("canonical forbidden actions");
    expect(cap.stdout).toContain("canonical product direction");
  });

  it("falls back to legacy lowercase context files when canonical absent", async () => {
    writeText("project_brief.md", "## legacy brief content");
    writeText("current.md", "## legacy state content");
    writeText("release_policy.md", "## legacy release policy");
    writeText("forbidden_actions.md", "## legacy forbidden actions");
    writeText("product_direction.md", "## legacy product direction");

    const cap = captureIO();
    const code = await runCli(["overseer", "brief"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("legacy brief content");
    expect(cap.stdout).toContain("legacy state content");
    expect(cap.stdout).toContain("legacy release policy");
    expect(cap.stdout).toContain("legacy forbidden actions");
    expect(cap.stdout).toContain("legacy product direction");
  });

  it("mixed: canonical PROJECT_BRIEF + legacy current.md → both surface", async () => {
    writeText("PROJECT_BRIEF.md", "## canonical brief");
    writeText("current.md", "## legacy current");
    const cap = captureIO();
    await runCli(["overseer", "brief"], cap.io);
    expect(cap.stdout).toContain("canonical brief");
    expect(cap.stdout).toContain("legacy current");
  });
});

// ── Doc consistency anchor ───────────────────────────────────────────

describe("OVERSEER.md doc consistency", () => {
  // This is the test that fails LOUDLY if anyone reverts the
  // UPPERCASE-first behavior. The doc claims canonical = UPPERCASE; if
  // a regression makes `status` ignore PROJECT_BRIEF.md, this test
  // catches it before the doc starts lying again.
  it("status sees PROJECT_BRIEF.md (canonical name from OVERSEER.md Storage section)", async () => {
    writeText("PROJECT_BRIEF.md", "doc anchor: canonical wins");
    const cap = captureIO();
    await runCli(["overseer", "status", "--json"], cap.io);
    const obj = JSON.parse(cap.stdout);
    expect(obj.project).toContain("doc anchor: canonical wins");
  });
});

// ── P3-A.2: init-context casing fix ──────────────────────────────────

describe("overseer init-context — writes canonical UPPERCASE filenames", () => {
  it("fresh dir: stubs are written under canonical UPPERCASE names", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "init-context"], cap.io);
    expect(code).toBe(0);
    // Each canonical file must exist
    for (const name of [
      "PROJECT_BRIEF.md",
      "CURRENT_STATE.md",
      "RELEASE_POLICY.md",
      "FORBIDDEN_ACTIONS.md",
      "PRODUCT_DIRECTION.md",
    ]) {
      expect(existsSync(join(overseerDir, name))).toBe(true);
    }
    // And the create lines reference the canonical names
    expect(cap.stdout).toContain("created: .relayos/overseer/PROJECT_BRIEF.md");
    expect(cap.stdout).toContain("created: .relayos/overseer/CURRENT_STATE.md");
    // Branch stubs are unchanged
    expect(existsSync(join(overseerDir, "branches/active/brief.md"))).toBe(true);
    expect(existsSync(join(overseerDir, "branches/active/progress.md"))).toBe(true);
  });

  it("after init-context, the 5 canonical stubs it provides are no longer 'missing' in doctor's report", async () => {
    // init-context writes PROJECT_BRIEF / CURRENT_STATE / RELEASE_POLICY
    // / FORBIDDEN_ACTIONS / PRODUCT_DIRECTION. doctor's full
    // context_complete check also requires OPERATING_POLICY,
    // NEXT_ACTION, MODEL_POLICY, timeline.jsonl — those are filled by
    // other commands (`overseer next`, the policy docs the user adds
    // themselves, the timeline that grows via `overseer note`). So
    // assert the subset init-context owns, not the entire check.
    await runCli(["overseer", "init-context"], captureIO().io);
    const cap = captureIO();
    await runCli(["overseer", "doctor", "--json"], cap.io);
    const obj = JSON.parse(cap.stdout);
    const missing: string[] = obj.missing ?? [];
    expect(missing).not.toContain("PROJECT_BRIEF.md");
    expect(missing).not.toContain("CURRENT_STATE.md");
    expect(missing).not.toContain("FORBIDDEN_ACTIONS.md");
  });

  itCaseSensitive(
    "legacy lowercase files are renamed to canonical (preserving content) — case-sensitive FS",
    async () => {
      // Pre-seed the legacy lowercase files with distinctive content.
      writeText("project_brief.md", "legacy brief content — must survive rename");
      writeText("current.md", "legacy current content");
      writeText("forbidden_actions.md", "legacy forbidden content");

      const cap = captureIO();
      const code = await runCli(["overseer", "init-context"], cap.io);
      expect(code).toBe(0);

      // Legacy files no longer exist
      expect(existsSync(join(overseerDir, "project_brief.md"))).toBe(false);
      expect(existsSync(join(overseerDir, "current.md"))).toBe(false);
      expect(existsSync(join(overseerDir, "forbidden_actions.md"))).toBe(false);

      // Canonical files exist with the original legacy content (not stubbed over)
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(join(overseerDir, "PROJECT_BRIEF.md"), "utf8")).toContain(
        "legacy brief content — must survive rename",
      );
      expect(readFileSync(join(overseerDir, "CURRENT_STATE.md"), "utf8")).toContain(
        "legacy current content",
      );
      expect(readFileSync(join(overseerDir, "FORBIDDEN_ACTIONS.md"), "utf8")).toContain(
        "legacy forbidden content",
      );

      // The other (un-renamed) canonical files are stubbed out, not skipped
      expect(existsSync(join(overseerDir, "RELEASE_POLICY.md"))).toBe(true);
      expect(existsSync(join(overseerDir, "PRODUCT_DIRECTION.md"))).toBe(true);

      // Renames are reported on stdout
      expect(cap.stdout).toContain(
        "renamed legacy: .relayos/overseer/project_brief.md → PROJECT_BRIEF.md",
      );
      expect(cap.stdout).toContain(
        "renamed legacy: .relayos/overseer/current.md → CURRENT_STATE.md",
      );
    },
  );

  itCaseSensitive(
    "when BOTH canonical and legacy exist, legacy is left in place (no clobber) — case-sensitive FS",
    async () => {
      writeText("PROJECT_BRIEF.md", "canonical truth");
      writeText("project_brief.md", "legacy edits");

      const cap = captureIO();
      await runCli(["overseer", "init-context"], cap.io);

      // Both files still exist
      expect(existsSync(join(overseerDir, "PROJECT_BRIEF.md"))).toBe(true);
      expect(existsSync(join(overseerDir, "project_brief.md"))).toBe(true);

      // Canonical content is preserved
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(join(overseerDir, "PROJECT_BRIEF.md"), "utf8")).toBe(
        "canonical truth",
      );
      // And the user is informed that the legacy was NOT touched
      expect(cap.stderr).toContain(
        "note: .relayos/overseer/project_brief.md kept (canonical file already exists; not overwritten)",
      );
    },
  );

  it("re-running on a fully-canonical workspace is a no-op (no creates, no renames)", async () => {
    // First run lays down canonical stubs.
    await runCli(["overseer", "init-context"], captureIO().io);
    // Second run should report nothing changed.
    const cap = captureIO();
    const code = await runCli(["overseer", "init-context"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("overseer context already complete");
    expect(cap.stdout).not.toContain("created:");
    expect(cap.stdout).not.toContain("renamed legacy:");
  });
});
