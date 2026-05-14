import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

function captureIO({ isTTY = false }: { isTTY?: boolean } = {}) {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write: (chunk: string) => (stdout += chunk), isTTY },
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

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*m/g, "");
}

describe("relayos banner", () => {
  it("prints a static RelayOS ASCII banner", async () => {
    const cap = captureIO();

    const code = await runCli(["banner"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain(
      "██████╗ ███████╗██╗      █████╗ ██╗   ██╗ ██████╗ ███████╗",
    );
    expect(cap.stdout).toContain(
      "       Local-first safety, audit, and handoff layer",
    );
    expect(cap.stdout).toContain("relayos launch latest");
    expect(cap.stdout).toContain("relayos policy latest");
    expect(cap.stdout).toContain("relayos checkpoint create");
    expect(cap.stdout).toContain("relayos diff-risk");
    expect(cap.stdout).toContain("relayos report");
    expect(cap.stdout).toContain("relayos overseer brief");
    expect(cap.stdout).not.toContain("Optional shell aliases are user-managed");
    expect(cap.stdout).not.toContain("\u001B[");
    expect(cap.stdout.split("\n").length).toBeGreaterThan(10);
    expect(cap.stderr).toBe("");
  });

  it("prints the banner by default with no alias note or usage footer", async () => {
    const cap = captureIO();

    const code = await runCli([], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain(
      "██████╗ ███████╗██╗      █████╗ ██╗   ██╗ ██████╗ ███████╗",
    );
    expect(cap.stdout).toContain("Local-first safety, audit, and handoff layer");
    expect(cap.stdout).toContain("relayos launch latest");
    expect(cap.stdout).not.toContain("Optional shell aliases are user-managed");
    expect(cap.stdout).not.toContain("usage: relayos");
    expect(cap.stderr).toBe("");
  });

  it("adds color for interactive tty output", async () => {
    const cap = captureIO({ isTTY: true });
    const prevCI = process.env.CI;
    const prevNoColor = process.env.NO_COLOR;
    delete process.env.CI;
    delete process.env.NO_COLOR;
    try {
      const code = await runCli(["banner"], cap.io);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("\u001B[94m");
      expect(cap.stdout).toContain("\u001B[1;97m");
      expect(cap.stdout).toContain("\u001B[1;36m");
    } finally {
      if (prevCI === undefined) delete process.env.CI;
      else process.env.CI = prevCI;
      if (prevNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prevNoColor;
    }
  });

  it("keeps plain output when NO_COLOR is set", async () => {
    const cap = captureIO({ isTTY: true });
    const prevNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const code = await runCli(["banner"], cap.io);
      expect(code).toBe(0);
      expect(cap.stdout).toBe(stripAnsi(cap.stdout));
    } finally {
      if (prevNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prevNoColor;
    }
  });

  it("rejects unexpected args with usage", async () => {
    const cap = captureIO();

    const code = await runCli(["banner", "--json"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos banner");
  });

  it("mentions banner in the top-level dispatcher usage", async () => {
    const cap = captureIO();

    const code = await runCli(["bad-command"], cap.io);

    expect(code).toBe(1);
    expect(cap.stdout).toBe("");
    expect(cap.stderr).toContain("banner");
  });
});
