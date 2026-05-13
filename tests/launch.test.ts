import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAuditWriter } from "../src/audit.js";
import { runCli } from "../src/cli.js";
import { readEnvelope, writeEnvelope } from "../src/envelope.js";
import {
  buildLaunchCommand,
  LaunchResolutionError,
  resolveHandoff,
} from "../src/launch.js";
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

async function makeEnvelope(
  layout: Awaited<ReturnType<typeof withLayout>>["layout"],
  overrides: Record<string, unknown>,
  createdAt: string,
): Promise<Envelope> {
  const audit = createAuditWriter(layout);
  const { status, ...inputOverrides } = overrides;
  const created = await createHandoff(sampleInput(inputOverrides), {
    layout,
    audit,
  });
  const envelope = await readEnvelope(layout, created.handoff_id);
  if (!envelope) throw new Error("expected envelope");
  envelope.created_at = createdAt;
  if (typeof status === "string") {
    envelope.status = status as Envelope["status"];
  }
  await writeEnvelope(layout, envelope);
  const fresh = await readEnvelope(layout, envelope.id);
  if (!fresh) throw new Error("expected fresh envelope");
  return fresh;
}

async function snapshotStorage(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  async function walk(dir: string, prefix = "") {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path, key);
        continue;
      }
      const s = await stat(path);
      const content = await readFile(path, "utf8");
      out[key] = `${s.mtimeMs}:${content}`;
    }
  }

  await walk(root);
  return out;
}

describe("relayos launch", () => {
  it("latest resolves to the most-recent open handoff and prints a command containing the model", async () => {
    const { layout } = await withLayout();
    await makeEnvelope(
      layout,
      { task_title: "older", model: "gpt-5.4" },
      "2026-05-13T10:00:00.000Z",
    );
    const latest = await makeEnvelope(
      layout,
      { task_title: "newer", model: "gpt-5.5" },
      "2026-05-13T11:00:00.000Z",
    );

    const resolved = await resolveHandoff("latest");
    const command = buildLaunchCommand(resolved);

    expect(resolved.id).toBe(latest.id);
    expect(command).not.toBe("");
    expect(command).toContain("gpt-5.5");
  });

  it("no-arg form behaves identically to latest", async () => {
    const { layout } = await withLayout();
    await makeEnvelope(
      layout,
      { task_title: "latest" },
      "2026-05-13T12:00:00.000Z",
    );

    const implicit = await resolveHandoff();
    const explicit = await resolveHandoff("latest");

    expect(implicit.id).toBe(explicit.id);
    expect(buildLaunchCommand(implicit)).toBe(buildLaunchCommand(explicit));
  });

  it("numeric selection uses the open handoff order and reports out-of-range selections", async () => {
    const { layout } = await withLayout();
    const second = await makeEnvelope(
      layout,
      { task_title: "second" },
      "2026-05-13T13:00:00.000Z",
    );
    const first = await makeEnvelope(
      layout,
      { task_title: "first" },
      "2026-05-13T14:00:00.000Z",
    );

    await expect(resolveHandoff("1")).resolves.toMatchObject({ id: first.id });
    await expect(resolveHandoff("2")).resolves.toMatchObject({ id: second.id });
    await expect(resolveHandoff("3")).rejects.toMatchObject({
      code: "out_of_range",
      message: expect.stringContaining("out of range"),
    });
  });

  it("uses id descending as the tie-breaker for handoffs with the same created_at", async () => {
    const { layout } = await withLayout();
    const sameTime = "2026-05-13T15:00:00.000Z";
    const a = await makeEnvelope(layout, { task_title: "a" }, sameTime);
    const b = await makeEnvelope(layout, { task_title: "b" }, sameTime);

    const expected = [a, b].sort((left, right) =>
      left.id < right.id ? 1 : -1,
    )[0]!;

    await expect(resolveHandoff("latest")).resolves.toMatchObject({
      id: expected.id,
    });
  });

  it("full handoff id fallback returns the matching envelope and unknown ids fail clearly", async () => {
    const { layout } = await withLayout();
    const envelope = await makeEnvelope(
      layout,
      { task_title: "completed", status: "completed" },
      "2026-05-13T16:00:00.000Z",
    );

    await expect(resolveHandoff(envelope.id)).resolves.toMatchObject({
      id: envelope.id,
      status: "completed",
    });
    await expect(resolveHandoff("h_DOES_NOT_EXIST")).rejects.toBeInstanceOf(
      LaunchResolutionError,
    );
    await expect(resolveHandoff("h_DOES_NOT_EXIST")).rejects.toMatchObject({
      code: "unknown_id",
      message: expect.stringContaining("was not found"),
    });
  });

  it("prints only: the CLI does not invoke codex and does not modify storage files", async () => {
    const { layout } = await withLayout();
    await makeEnvelope(
      layout,
      { task_title: "print only", model: "gpt-5.5" },
      "2026-05-13T17:00:00.000Z",
    );
    const fakeBin = join(layout.root, "fake-bin");
    const sentinel = join(layout.root, "codex-ran");
    await mkdir(fakeBin);
    await writeFile(
      join(fakeBin, "codex"),
      `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\n`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;
    const before = await snapshotStorage(layout.root);
    let stdout = "";
    let stderr = "";

    try {
      const code = await runCli(["launch", "latest"], {
        stdout: { write: (chunk: string) => (stdout += chunk) },
        stderr: { write: (chunk: string) => (stderr += chunk) },
      });

      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("codex exec");
      await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(snapshotStorage(layout.root)).resolves.toEqual(before);
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
    }
  });

  it("CLI exits non-zero with a clear error on resolution failure", async () => {
    await withLayout();
    let stdout = "";
    let stderr = "";

    const code = await runCli(["launch", "2"], {
      stdout: { write: (chunk: string) => (stdout += chunk) },
      stderr: { write: (chunk: string) => (stderr += chunk) },
    });

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("out of range");
  });
});
