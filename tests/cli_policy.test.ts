import { afterEach, describe, expect, it } from "vitest";
import { createAuditWriter } from "../src/audit.js";
import { runCli } from "../src/cli.js";
import { readEnvelope, writeEnvelope } from "../src/envelope.js";
import type { Envelope } from "../src/schema.js";
import { createHandoff } from "../src/tools/create_handoff.js";
import { sampleInput, tempLayout } from "./_helpers.js";

const cleanups: Array<() => void> = [];
let previousHandoffDir: string | undefined;

afterEach(() => {
  if (previousHandoffDir === undefined) {
    delete process.env.HANDOFF_DIR;
  } else {
    process.env.HANDOFF_DIR = previousHandoffDir;
  }
  previousHandoffDir = undefined;
  while (cleanups.length) cleanups.pop()!();
});

async function withLayout() {
  const temp = await tempLayout();
  cleanups.push(temp.cleanup);
  previousHandoffDir = process.env.HANDOFF_DIR;
  process.env.HANDOFF_DIR = temp.layout.root;
  return temp;
}

async function file(
  layout: Awaited<ReturnType<typeof withLayout>>["layout"],
  overrides: Record<string, unknown> = {},
): Promise<Envelope> {
  const audit = createAuditWriter(layout);
  const { status, ...inputOverrides } = overrides;
  const created = await createHandoff(sampleInput(inputOverrides), {
    layout,
    audit,
  });
  const envelope = await readEnvelope(layout, created.handoff_id);
  if (!envelope) throw new Error("expected envelope");
  if (typeof status === "string") {
    envelope.status = status as Envelope["status"];
    await writeEnvelope(layout, envelope);
  }
  return envelope;
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

describe("relayos launch policy banner", () => {
  it("allow: no banner, command on stdout, exit 0 (preserves $(relayos launch))", async () => {
    const { layout } = await withLayout();
    await file(layout);
    const cap = captureIO();

    const code = await runCli(["launch", "latest"], cap.io);

    expect(code).toBe(0);
    expect(cap.stderr).toBe("");
    expect(cap.stdout).toContain("codex exec");
    expect(cap.stdout).not.toContain("# RelayOS policy");
  });

  it("warn: banner on stderr, command on stdout, exit 0", async () => {
    const { layout } = await withLayout();
    await file(layout, {
      allowed_files: [],
      task_description: "Refactor the util module broadly.",
    });
    const cap = captureIO();

    const code = await runCli(["launch", "latest"], cap.io);

    expect(code).toBe(0);
    expect(cap.stderr).toContain("# RelayOS policy: WARN");
    expect(cap.stderr).toContain("broad_edit_scope");
    expect(cap.stdout).toContain("codex exec");
  });

  it("block: banner on stderr only, no command on stdout, exit 2", async () => {
    const { layout } = await withLayout();
    await file(layout, {
      task_description: "Run rm -rf /tmp/build to clear the cache.",
    });
    const cap = captureIO();

    const code = await runCli(["launch", "latest"], cap.io);

    expect(code).toBe(2);
    expect(cap.stderr).toContain("# RelayOS policy: BLOCK");
    expect(cap.stderr).toContain("destructive_instruction");
    expect(cap.stderr).toContain("--force");
    expect(cap.stdout).toBe("");
  });

  it("--force overrides block: banner on stderr, command on stdout, exit 0", async () => {
    const { layout } = await withLayout();
    await file(layout, {
      task_description: "Run rm -rf /tmp/build to clear the cache.",
    });
    const cap = captureIO();

    const code = await runCli(["launch", "--force", "latest"], cap.io);

    expect(code).toBe(0);
    expect(cap.stderr).toContain("# RelayOS policy: BLOCK");
    expect(cap.stdout).toContain("codex exec");
  });

  it("--force is positional-order tolerant (after selector also works)", async () => {
    const { layout } = await withLayout();
    await file(layout, {
      task_description: "Run rm -rf /tmp/build to clear the cache.",
    });
    const cap = captureIO();

    const code = await runCli(["launch", "latest", "--force"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("codex exec");
  });
});

describe("relayos policy subcommand", () => {
  it("prints DECISION + findings + HANDOFF line on stdout, exit 0", async () => {
    const { layout } = await withLayout();
    const env = await file(layout);
    const cap = captureIO();

    const code = await runCli(["policy", "latest"], cap.io);

    expect(code).toBe(0);
    expect(cap.stderr).toBe("");
    expect(cap.stdout).toContain("DECISION: ALLOW");
    expect(cap.stdout).toContain(`HANDOFF: ${env.id}`);
    expect(cap.stdout).toContain("target=codex");
    expect(cap.stdout).toContain("mode=patch");
  });

  it("lists findings for a warn-level handoff", async () => {
    const { layout } = await withLayout();
    await file(layout, {
      allowed_files: [],
      task_description: "Refactor util broadly.",
    });
    const cap = captureIO();

    const code = await runCli(["policy"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: WARN");
    expect(cap.stdout).toContain("- broad_edit_scope:");
  });

  it("policy on a block-level handoff exits 0 (query, not action)", async () => {
    const { layout } = await withLayout();
    await file(layout, {
      task_description: "Run rm -rf /var to clean.",
    });
    const cap = captureIO();

    const code = await runCli(["policy", "latest"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("DECISION: BLOCK");
    expect(cap.stdout).toContain("- destructive_instruction:");
  });

  it("propagates resolution errors with policy-specific prefix", async () => {
    await withLayout();
    const cap = captureIO();

    const code = await runCli(["policy", "h_DOES_NOT_EXIST"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("relayos policy:");
    expect(cap.stderr).toContain("was not found");
    expect(cap.stdout).toBe("");
  });
});
