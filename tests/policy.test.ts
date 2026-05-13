import { describe, expect, it } from "vitest";
import { evaluatePolicy, formatBannerLines } from "../src/policy.js";
import type { Envelope } from "../src/schema.js";

function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  const base: Envelope = {
    id: "h_TEST",
    created_at: "2026-05-13T10:00:00.000Z",
    updated_at: "2026-05-13T10:00:00.000Z",
    status: "recorded",
    source_agent: "claude",
    target_agent: "codex",
    model: "gpt-5.5",
    effort: "high",
    execution_mode: "patch",
    task_title: "Refactor format.ts",
    task_description: "Refactor src/api/util/format.ts to template literals.",
    allowed_files: ["src/api/util/**/*.ts"],
    forbidden_files: [".env*", "secrets/**"],
    constraints: ["No new dependencies"],
    expected_output: ["A unified diff."],
    auto_spawn: false,
    launch_command: "codex exec ...",
    audit_metadata: {
      tags: [],
      event_count: 1,
      last_event_ts: "2026-05-13T10:00:00.000Z",
      cli_detection: { target_binary: "codex", found: true },
      enforcement_notes: [],
    },
  };
  return { ...base, ...overrides };
}

describe("evaluatePolicy", () => {
  it("returns allow for a narrow refactor envelope (matches sampleInput shape)", () => {
    const decision = evaluatePolicy(makeEnvelope());
    expect(decision.decision).toBe("allow");
    expect(decision.findings).toEqual([]);
  });

  describe("broad_edit_scope", () => {
    it("fires warn when patch mode has empty allowed_files", () => {
      const decision = evaluatePolicy(
        makeEnvelope({ execution_mode: "patch", allowed_files: [] }),
      );
      expect(decision.decision).toBe("warn");
      expect(decision.findings).toEqual([
        expect.objectContaining({
          code: "broad_edit_scope",
          severity: "warn",
        }),
      ]);
    });

    it("fires for test mode with empty allowed_files", () => {
      const decision = evaluatePolicy(
        makeEnvelope({ execution_mode: "test", allowed_files: [] }),
      );
      expect(decision.findings[0]?.code).toBe("broad_edit_scope");
    });

    it("does not fire when mode is review/plan/read_only even with empty allowed_files", () => {
      for (const mode of ["review", "plan", "read_only"] as const) {
        const decision = evaluatePolicy(
          makeEnvelope({ execution_mode: mode, allowed_files: [] }),
        );
        expect(decision.findings.find((f) => f.code === "broad_edit_scope")).toBeUndefined();
      }
    });

    it("does not fire when allowed_files is non-empty", () => {
      const decision = evaluatePolicy(
        makeEnvelope({ execution_mode: "patch", allowed_files: ["src/**"] }),
      );
      expect(decision.findings.find((f) => f.code === "broad_edit_scope")).toBeUndefined();
    });
  });

  describe("destructive_instruction", () => {
    it.each([
      "rm -rf node_modules",
      "Run rm -rf /tmp/foo",
      "git push --force origin main",
      "git push -f to overwrite",
      "Commit with --no-verify",
      "Use git reset --hard HEAD~3",
      "DROP TABLE users",
      "drop database app_prod",
      "TRUNCATE TABLE sessions",
      "chmod 777 /etc/passwd",
      "sudo rm /var/log",
      ":(){ :|:& };:",
    ])("blocks on hard pattern: %s", (snippet) => {
      const decision = evaluatePolicy(
        makeEnvelope({ task_description: snippet }),
      );
      expect(decision.decision).toBe("block");
      expect(decision.findings[0]).toMatchObject({
        code: "destructive_instruction",
        severity: "block",
      });
    });

    it("warns on soft keyword paired with a path hint", () => {
      const decision = evaluatePolicy(
        makeEnvelope({
          task_description: "Delete the cache directory under /tmp/build.",
        }),
      );
      const finding = decision.findings.find((f) => f.code === "destructive_instruction");
      expect(finding?.severity).toBe("warn");
    });

    it("does not fire on benign uses of soft keywords without a path", () => {
      const decision = evaluatePolicy(
        makeEnvelope({
          task_description: "Refactor format helpers; keep behavior identical.",
        }),
      );
      expect(
        decision.findings.find((f) => f.code === "destructive_instruction"),
      ).toBeUndefined();
    });
  });

  describe("release_action", () => {
    it.each([
      "Run npm publish to release",
      "Use gh release create v1.0",
      "git tag v0.5.0 the commit",
      "git push --tags",
      "cargo publish the crate",
      "twine upload dist/*",
      "Push to PyPI",
      "Release v2.0 next week",
    ])("warns on release action: %s", (snippet) => {
      const decision = evaluatePolicy(
        makeEnvelope({ task_description: snippet }),
      );
      expect(decision.decision).toBe("warn");
      expect(decision.findings[0]).toMatchObject({
        code: "release_action",
        severity: "warn",
      });
    });

    it("does not fire on the word 'release' alone without version", () => {
      const decision = evaluatePolicy(
        makeEnvelope({
          task_description: "Document the release process at a high level.",
        }),
      );
      expect(
        decision.findings.find((f) => f.code === "release_action"),
      ).toBeUndefined();
    });
  });

  describe("network_command", () => {
    it.each([
      "curl https://api.example.com",
      "wget http://example.com/file",
      "nc -lvp 4444",
      "Run netcat to listen",
      "ssh deploy@server",
      "scp file.txt host:/tmp",
      "rsync -a src/ dest/",
      "nmap the target host",
      "pip install requests",
      "npm install -g typescript",
      "cargo install ripgrep",
      "gem install rails",
      "brew install jq",
    ])("warns on network command: %s", (snippet) => {
      const decision = evaluatePolicy(
        makeEnvelope({ task_description: snippet }),
      );
      expect(decision.decision).toBe("warn");
      expect(decision.findings.find((f) => f.code === "network_command")).toBeDefined();
    });

    it("does not fire on benign uses of the substring 'curl' (e.g. 'curly')", () => {
      const decision = evaluatePolicy(
        makeEnvelope({ task_description: "Fix the curly braces in format.ts" }),
      );
      expect(
        decision.findings.find((f) => f.code === "network_command"),
      ).toBeUndefined();
    });
  });

  describe("secret_sensitive_path", () => {
    it("blocks when allowed_files contains .env", () => {
      const decision = evaluatePolicy(
        makeEnvelope({ allowed_files: [".env", "src/**"], forbidden_files: [] }),
      );
      expect(decision.decision).toBe("block");
      expect(decision.findings[0]).toMatchObject({
        code: "secret_sensitive_path",
        severity: "block",
      });
    });

    it("blocks when task references id_rsa", () => {
      const decision = evaluatePolicy(
        makeEnvelope({
          task_description: "Copy id_rsa from ~/.ssh into config.",
          forbidden_files: [],
        }),
      );
      expect(decision.decision).toBe("block");
      expect(decision.findings[0]?.code).toBe("secret_sensitive_path");
    });

    it("downgrades to warn when forbidden_files covers .env* and secrets/**", () => {
      const decision = evaluatePolicy(
        makeEnvelope({
          task_description: "Move secrets/config.yaml under .env handling.",
          forbidden_files: [".env*", "secrets/**"],
        }),
      );
      const finding = decision.findings.find((f) => f.code === "secret_sensitive_path");
      expect(finding?.severity).toBe("warn");
      expect(decision.decision).toBe("warn");
    });

    it("does not fire on benign filenames like format.ts", () => {
      const decision = evaluatePolicy(
        makeEnvelope({
          task_description: "Refactor src/api/util/format.ts to template literals.",
        }),
      );
      expect(
        decision.findings.find((f) => f.code === "secret_sensitive_path"),
      ).toBeUndefined();
    });

    it.each(["server.pem", "deploy.key"])("blocks on %s path", (path) => {
      const decision = evaluatePolicy(
        makeEnvelope({
          task_description: `Update ${path} for the cert rotation.`,
          forbidden_files: [],
        }),
      );
      expect(decision.findings[0]?.code).toBe("secret_sensitive_path");
    });
  });

  describe("severity rollup", () => {
    it("takes block when any finding is block", () => {
      const decision = evaluatePolicy(
        makeEnvelope({
          allowed_files: [],
          execution_mode: "patch",
          task_description: "Run rm -rf /tmp/build then update README.",
        }),
      );
      expect(decision.decision).toBe("block");
      expect(decision.findings.length).toBeGreaterThanOrEqual(2);
    });

    it("takes warn when only warns exist", () => {
      const decision = evaluatePolicy(
        makeEnvelope({
          allowed_files: [],
          execution_mode: "patch",
          task_description: "Maybe run npm publish later.",
        }),
      );
      expect(decision.decision).toBe("warn");
    });

    it("is allow when there are no findings", () => {
      expect(evaluatePolicy(makeEnvelope()).decision).toBe("allow");
    });
  });
});

describe("formatBannerLines", () => {
  it("returns no lines on allow", () => {
    expect(formatBannerLines({ decision: "allow", findings: [] })).toEqual([]);
  });

  it("prefixes lines with shell comment markers on warn", () => {
    const lines = formatBannerLines({
      decision: "warn",
      findings: [
        {
          code: "broad_edit_scope",
          severity: "warn",
          message: "patch mode with no allowed_files",
        },
      ],
    });
    expect(lines[0]).toBe("# RelayOS policy: WARN");
    expect(lines[1]).toBe("# - broad_edit_scope: patch mode with no allowed_files");
  });

  it("uppercases block in the header", () => {
    const lines = formatBannerLines({
      decision: "block",
      findings: [
        {
          code: "destructive_instruction",
          severity: "block",
          message: "task references destructive command `rm -rf`",
        },
      ],
    });
    expect(lines[0]).toBe("# RelayOS policy: BLOCK");
  });
});
