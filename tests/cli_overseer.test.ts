import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
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

describe("relayos overseer status", () => {
  it("prints a no-state message when the workspace is empty", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "status"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER STATUS");
    expect(cap.stdout).toContain("no overseer state");
    expect(cap.stderr).toBe("");
  });

  it("shows the next action after it is set", async () => {
    chdir(tempDir());
    const cap = captureIO();
    await runCli(["overseer", "next", "deploy the patch"], cap.io);

    const cap2 = captureIO();
    const code = await runCli(["overseer", "status"], cap2.io);

    expect(code).toBe(0);
    expect(cap2.stdout).toContain("NEXT ACTION");
    expect(cap2.stdout).toContain("deploy the patch");
  });

  it("shows recent notes after they are added", async () => {
    chdir(tempDir());
    await runCli(["overseer", "note", "first note"], captureIO().io);
    await runCli(["overseer", "note", "second note"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "status"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("RECENT NOTES");
    expect(cap.stdout).toContain("first note");
    expect(cap.stdout).toContain("second note");
  });
});

describe("relayos overseer note", () => {
  it("records a note and exits 0", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "note", "test", "note", "text"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("note recorded");
    expect(cap.stdout).toContain("test note text");
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with usage when no text is given", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "note"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer note");
  });
});

describe("relayos overseer next", () => {
  it("sets and prints the next action", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "next", "run", "full", "suite"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("run full suite");
    expect(cap.stderr).toBe("");
  });

  it("reads back the current next action when called with no args", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "review PR #42"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "next"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("review PR #42");
  });

  it("prints a no-data message when no next action is set", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "next"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("no next action set");
    expect(cap.stderr).toBe("");
  });

  it("overwrites the previous next action", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "old action"], captureIO().io);
    await runCli(["overseer", "next", "new action"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "next"], cap.io);

    expect(cap.stdout).toContain("new action");
    expect(cap.stdout).not.toContain("old action");
  });
});

describe("relayos overseer: error cases", () => {
  it("exits 1 with usage on unknown subcommand", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "bogus"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer");
  });

  it("exits 1 with usage when no subcommand is given", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer");
  });

  it("mentions overseer in the top-level dispatcher usage", async () => {
    const cap = captureIO();

    const code = await runCli(["bad-command"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("overseer");
  });
});

describe("relayos overseer start", () => {
  it("prints banner, startup mode guidance, and overseer brief", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "start"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("Local-first safety, audit, and handoff layer");
    expect(cap.stdout).toContain("OVERSEER STARTUP MODE");
    expect(cap.stdout).toContain("Serial mode is the default");
    expect(cap.stdout).toContain("Write tasks are processed one at a time.");
    expect(cap.stdout).toContain("Parallel mode is future/opt-in");
    expect(cap.stdout).toContain("RELAYOS OVERSEER BRIEF");
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with usage on unexpected args", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "start", "--json"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer start");
  });
});

describe("relayos overseer mode", () => {
  it("prints the current read-only execution mode guidance", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "mode"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER MODE");
    expect(cap.stdout).toContain("Current/default mode: serial.");
    expect(cap.stdout).toContain("Write tasks are processed one at a time.");
    expect(cap.stdout).toContain("Parallel mode is future/opt-in");
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with usage on unexpected args", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "mode", "json"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer mode");
  });
});

describe("relayos overseer env", () => {
  it("prints cwd and reports runtime workspace as not configured when RELAYOS_RUNTIME_HOME is unset", async () => {
    chdir(tempDir());
    const prev = process.env.RELAYOS_RUNTIME_HOME;
    delete process.env.RELAYOS_RUNTIME_HOME;
    const cap = captureIO();

    try {
      const code = await runCli(["overseer", "env"], cap.io);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("OVERSEER ENVIRONMENT");
      expect(cap.stdout).toContain(`Current working directory: ${process.cwd()}`);
      expect(cap.stdout).toContain("RELAYOS_RUNTIME_HOME: not set");
      expect(cap.stdout).toContain("Runtime workspace: not configured");
      expect(cap.stdout).toContain("`.relayos/` paths resolve relative to the current working directory");
      expect(cap.stdout).toContain("future/not active");
      expect(cap.stdout).toContain("outside the RelayOS source repo");
      expect(cap.stderr).toBe("");
    } finally {
      if (prev === undefined) delete process.env.RELAYOS_RUNTIME_HOME;
      else process.env.RELAYOS_RUNTIME_HOME = prev;
    }
  });

  it("prints RELAYOS_RUNTIME_HOME when set but marks support as future/not active", async () => {
    chdir(tempDir());
    const prev = process.env.RELAYOS_RUNTIME_HOME;
    process.env.RELAYOS_RUNTIME_HOME = "/tmp/relayos-runtime";
    const cap = captureIO();

    try {
      const code = await runCli(["overseer", "env"], cap.io);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("RELAYOS_RUNTIME_HOME: set (/tmp/relayos-runtime)");
      expect(cap.stdout).toContain("configured in environment, but support is future/not active");
      expect(cap.stdout).toContain("future/not active");
    } finally {
      if (prev === undefined) delete process.env.RELAYOS_RUNTIME_HOME;
      else process.env.RELAYOS_RUNTIME_HOME = prev;
    }
  });

  it("exits 1 with usage on unexpected args", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "env", "--json"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer env");
  });
});

describe("relayos overseer brief", () => {
  it("exits 0 and prints header with no overseer state", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "brief"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("RELAYOS OVERSEER BRIEF");
    expect(cap.stdout).toContain("missing");
    expect(cap.stderr).toBe("");
  });

  it("shows next action when set", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "ship the patch"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "brief"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("NEXT ACTION");
    expect(cap.stdout).toContain("ship the patch");
  });

  it("includes local data safety warning", async () => {
    chdir(tempDir());
    const cap = captureIO();

    await runCli(["overseer", "brief"], cap.io);

    expect(cap.stdout).toContain("LOCAL DATA SAFETY");
    expect(cap.stdout).toContain("gitignored");
  });

  it("exits 1 with usage on unexpected args", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "brief", "--json"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer brief");
  });

  it("includes ACTIVE BRANCH section when branch is set", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-feature"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "brief"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("ACTIVE BRANCH");
    expect(cap.stdout).toContain("my-feature");
  });

  it("includes BRANCH PROGRESS section when progress entries exist", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-feature"], captureIO().io);
    await runCli(["overseer", "progress", "first entry"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "brief"], cap.io);

    expect(cap.stdout).toContain("BRANCH PROGRESS");
    expect(cap.stdout).toContain("first entry");
  });

  it("omits ACTIVE BRANCH section when no branch is set", async () => {
    chdir(tempDir());
    const cap = captureIO();

    await runCli(["overseer", "brief"], cap.io);

    expect(cap.stdout).not.toContain("ACTIVE BRANCH");
  });
});

describe("relayos overseer init-context", () => {
  it("creates all stub files and reports each one", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "init-context"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("created: .relayos/overseer/project_brief.md");
    expect(cap.stdout).toContain("created: .relayos/overseer/current.md");
    expect(cap.stdout).toContain("created: .relayos/overseer/branches/active/brief.md");
    expect(cap.stdout).toContain("created: .relayos/overseer/planned/enterprise_server.md");
  });

  it("does not overwrite existing files", async () => {
    chdir(tempDir());
    await runCli(["overseer", "init-context"], captureIO().io);
    await runCli(["overseer", "next", "preserve me"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "init-context"], cap.io);

    expect(cap.stdout).toContain("already complete");
    // next_action.md is not a context init file — unrelated; just verify no crash
  });

  it("reports already complete when run twice", async () => {
    chdir(tempDir());
    await runCli(["overseer", "init-context"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "init-context"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("already complete");
  });
});

describe("relayos overseer branch", () => {
  it("sets the active branch name and confirms", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "branch", "my-task"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("active branch set: my-task");
  });

  it("overwrites previous branch name", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "old-task"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "branch", "new-task"], cap.io);

    expect(cap.stdout).toContain("new-task");
  });

  it("exits 1 with usage when no name is given", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "branch"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer branch <name>");
  });
});

describe("relayos overseer progress", () => {
  it("records a progress entry and confirms", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-task"], captureIO().io);
    const cap = captureIO();

    const code = await runCli(["overseer", "progress", "tests passing"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("progress recorded: tests passing");
  });

  it("prints current progress without args", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-task"], captureIO().io);
    await runCli(["overseer", "progress", "step one done"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "progress"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("step one done");
  });

  it("appends multiple entries in order", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-task"], captureIO().io);
    await runCli(["overseer", "progress", "entry one"], captureIO().io);
    await runCli(["overseer", "progress", "entry two"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "progress"], cap.io);

    const out = cap.stdout;
    expect(out.indexOf("entry one")).toBeLessThan(out.indexOf("entry two"));
  });

  it("prints no-data message when no progress has been recorded", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "progress"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("no branch progress recorded");
  });
});
