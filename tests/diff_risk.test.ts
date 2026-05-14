import { describe, expect, it } from "vitest";
import {
  evaluateDiffRisk,
  formatDiffRisk,
  type DiffRiskInput,
} from "../src/diff_risk.js";

function input(partial: Partial<DiffRiskInput> = {}): DiffRiskInput {
  return {
    statusLines: partial.statusLines ?? [],
    diffText: partial.diffText ?? "",
    untracked: partial.untracked ?? [],
  };
}

describe("evaluateDiffRisk: clean tree", () => {
  it("returns allow with empty findings and clean summary", () => {
    const decision = evaluateDiffRisk(input());
    expect(decision.decision).toBe("allow");
    expect(decision.findings).toHaveLength(0);
    expect(decision.files).toHaveLength(0);
    expect(decision.summary).toContain("working tree is clean");
  });
});

describe("evaluateDiffRisk: secret_config_path", () => {
  it("blocks on staged .env", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M .env"] }),
    );
    expect(decision.decision).toBe("block");
    expect(decision.findings.find((f) => f.code === "secret_config_path")).toBeDefined();
  });

  it("blocks on untracked .env.local", () => {
    const decision = evaluateDiffRisk(
      input({
        statusLines: ["?? .env.local"],
        untracked: [".env.local"],
      }),
    );
    expect(decision.decision).toBe("block");
    const finding = decision.findings.find((f) => f.code === "secret_config_path");
    expect(finding?.path).toBe(".env.local");
  });

  it("blocks on secrets/ directory", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M secrets/api.json"] }),
    );
    expect(decision.decision).toBe("block");
  });

  it("blocks on *.pem and *.key", () => {
    const pem = evaluateDiffRisk(input({ statusLines: ["?? server.pem"] }));
    expect(pem.decision).toBe("block");
    const key = evaluateDiffRisk(input({ statusLines: ["?? deploy.key"] }));
    expect(key.decision).toBe("block");
  });

  it("does not flag tokenizer.ts (token-like substring inside word)", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M src/tokenizer.ts"] }),
    );
    expect(decision.findings.find((f) => f.code === "secret_config_path")).toBeUndefined();
  });
});

describe("evaluateDiffRisk: ci_deploy_path", () => {
  it("warns on .github/workflows/*.yml", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M .github/workflows/release.yml"] }),
    );
    expect(decision.decision).toBe("warn");
    expect(decision.findings[0]?.code).toBe("ci_deploy_path");
  });

  it("warns on Dockerfile and docker-compose.yml", () => {
    const a = evaluateDiffRisk(input({ statusLines: [" M Dockerfile"] }));
    expect(a.decision).toBe("warn");
    const b = evaluateDiffRisk(
      input({ statusLines: [" M docker-compose.prod.yml"] }),
    );
    expect(b.decision).toBe("warn");
  });

  it("does not flag a regular yaml file", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M configs/app.yaml"] }),
    );
    expect(decision.findings.find((f) => f.code === "ci_deploy_path")).toBeUndefined();
  });
});

describe("evaluateDiffRisk: dependency_manifest", () => {
  it("warns on package.json", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M package.json"] }),
    );
    expect(decision.decision).toBe("warn");
    expect(decision.findings[0]?.code).toBe("dependency_manifest");
  });

  it("warns on lockfiles (pnpm-lock.yaml, go.sum, Cargo.lock)", () => {
    expect(evaluateDiffRisk(input({ statusLines: [" M pnpm-lock.yaml"] })).decision).toBe("warn");
    expect(evaluateDiffRisk(input({ statusLines: [" M go.sum"] })).decision).toBe("warn");
    expect(evaluateDiffRisk(input({ statusLines: [" M Cargo.lock"] })).decision).toBe("warn");
  });

  it("does not flag a file named package.json.example", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M package.json.example"] }),
    );
    expect(decision.findings.find((f) => f.code === "dependency_manifest")).toBeUndefined();
  });
});

describe("evaluateDiffRisk: auth_security_path", () => {
  it("warns on a path with auth segment", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M src/auth/login.ts"] }),
    );
    expect(decision.decision).toBe("warn");
    expect(decision.findings[0]?.code).toBe("auth_security_path");
  });

  it("warns on payment, billing, stripe, migration", () => {
    expect(
      evaluateDiffRisk(input({ statusLines: [" M src/payments/checkout.ts"] })).decision,
    ).toBe("warn");
    expect(
      evaluateDiffRisk(input({ statusLines: [" M migrations/0042.sql"] })).decision,
    ).toBe("warn");
  });

  it("warns on any *.sql file", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M db/users.sql"] }),
    );
    expect(decision.decision).toBe("warn");
  });

  it("does not flag format.ts even though it contains 'at'", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M src/util/format.ts"] }),
    );
    expect(decision.findings.find((f) => f.code === "auth_security_path")).toBeUndefined();
  });
});

describe("evaluateDiffRisk: large_deletion", () => {
  it("warns when ≥200 lines are removed", () => {
    const diff = `--- a/big.ts\n+++ b/big.ts\n${"-old line\n".repeat(250)}`;
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M big.ts"], diffText: diff }),
    );
    expect(decision.decision).toBe("warn");
    expect(decision.findings.find((f) => f.code === "large_deletion")).toBeDefined();
  });

  it("warns when any file is deleted (D status)", () => {
    const decision = evaluateDiffRisk(
      input({ statusLines: [" D removed.ts"] }),
    );
    expect(decision.decision).toBe("warn");
    expect(decision.findings.find((f) => f.code === "large_deletion")).toBeDefined();
  });

  it("does not flag small deletions in modified files", () => {
    const diff = `--- a/small.ts\n+++ b/small.ts\n-old\n+new\n`;
    const decision = evaluateDiffRisk(
      input({ statusLines: [" M small.ts"], diffText: diff }),
    );
    expect(decision.findings.find((f) => f.code === "large_deletion")).toBeUndefined();
  });
});

describe("evaluateDiffRisk: risky_command_in_diff", () => {
  it("warns on `rm -rf` in an added line", () => {
    const diff = `+ rm -rf /tmp/build\n`;
    const decision = evaluateDiffRisk(input({ diffText: diff }));
    expect(decision.decision).toBe("warn");
    expect(decision.findings[0]?.code).toBe("risky_command_in_diff");
  });

  it("warns on `curl ... | sh`", () => {
    const diff = `+curl -fsSL https://example.com/install.sh | sh\n`;
    const decision = evaluateDiffRisk(input({ diffText: diff }));
    expect(decision.decision).toBe("warn");
    expect(decision.findings[0]?.evidence).toContain("curl");
  });

  it("warns on `npm publish`", () => {
    const diff = `+npm publish --access public\n`;
    const decision = evaluateDiffRisk(input({ diffText: diff }));
    expect(decision.decision).toBe("warn");
  });

  it("does not flag commands in REMOVED lines", () => {
    const diff = `--- a/script.sh\n+++ b/script.sh\n-rm -rf /tmp/build\n+echo done\n`;
    const decision = evaluateDiffRisk(input({ diffText: diff }));
    expect(decision.findings.find((f) => f.code === "risky_command_in_diff")).toBeUndefined();
  });

  it("warns on `git push origin main --force` (flag after intervening args)", () => {
    const diff = `+git push origin main --force\n`;
    const decision = evaluateDiffRisk(input({ diffText: diff }));
    expect(decision.decision).toBe("warn");
    expect(decision.findings.find((f) => f.code === "risky_command_in_diff")).toBeDefined();
  });

  it("warns on `git push origin --tags` (flag after intervening args)", () => {
    const diff = `+git push origin --tags\n`;
    const decision = evaluateDiffRisk(input({ diffText: diff }));
    expect(decision.decision).toBe("warn");
    expect(decision.findings.find((f) => f.code === "risky_command_in_diff")).toBeDefined();
  });
});

describe("evaluateDiffRisk: severity rollup", () => {
  it("block trumps warn", () => {
    const decision = evaluateDiffRisk(
      input({
        statusLines: [" M package.json", "?? .env"],
      }),
    );
    expect(decision.decision).toBe("block");
    expect(decision.findings[0]?.severity).toBe("block");
    expect(decision.findings.some((f) => f.severity === "warn")).toBe(true);
  });

  it("orders findings: blocks first, then warns", () => {
    const decision = evaluateDiffRisk(
      input({
        statusLines: [" M package.json", "?? .env"],
      }),
    );
    const severities = decision.findings.map((f) => f.severity);
    const firstWarnIdx = severities.indexOf("warn");
    const lastBlockIdx = severities.lastIndexOf("block");
    expect(lastBlockIdx).toBeLessThan(firstWarnIdx);
  });
});

describe("formatDiffRisk output", () => {
  it("renders DECISION + REASONS + FILES CHECKED + SUMMARY", () => {
    const decision = evaluateDiffRisk(
      input({
        statusLines: [" M package.json"],
      }),
    );
    const out = formatDiffRisk(decision);
    expect(out).toContain("DECISION: WARN");
    expect(out).toContain("REASONS:");
    expect(out).toContain("- dependency_manifest:");
    expect(out).toContain("FILES CHECKED:");
    expect(out).toContain("  M package.json");
    expect(out).toContain("SUMMARY:");
  });

  it("renders (none) for clean tree", () => {
    const decision = evaluateDiffRisk(input());
    const out = formatDiffRisk(decision);
    expect(out).toContain("DECISION: ALLOW");
    expect(out).toContain("REASONS: (none)");
    expect(out).toContain("FILES CHECKED: (none)");
    expect(out).toContain("working tree is clean");
  });
});
