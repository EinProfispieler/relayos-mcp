import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

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

describe("relayos banner", () => {
  it("prints a static RelayOS command banner", async () => {
    const cap = captureIO();

    const code = await runCli(["banner"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("RELAYOS");
    expect(cap.stdout).toContain("relayos launch latest");
    expect(cap.stdout).toContain("relayos policy latest");
    expect(cap.stdout).toContain("relayos report");
    expect(cap.stdout).toContain("Optional shell aliases are user-managed");
    expect(cap.stderr).toBe("");
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
    expect(cap.stderr).toContain("banner");
  });
});
