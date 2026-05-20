/**
 * Regression tests proving `appendConversationLog` writes to the
 * provided project root — never to `process.cwd()` — so invocations
 * from `bin/` (or any non-root cwd) cannot leak private session
 * content into `bin/.relayos/`.
 *
 * Context: prior to this fix, `appendConversationLog` used
 * `process.cwd()` to locate `.relayos/overseer/`. When the binary
 * ran from `bin/` as its working directory, the log was written to
 * `bin/.relayos/overseer/conversation_log.jsonl`, which got tracked
 * by git because `.gitignore` only covered `.relayos/overseer/` at
 * repo root. The Batch 1 gitignore fix stops future tracking; this
 * fix removes the bug at its source.
 */
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendConversationLog,
  handleConversation,
  type ConversationMessage,
} from "../src/conversation.js";
import { RelayConfig } from "../src/schema.js";

/**
 * Echoes the prompt back via `node -e`. Used because handleConversation
 * without a provider hits one log-append branch; with a provider hits a
 * different log-append branch. We exercise both.
 */
function echoConfig() {
  return RelayConfig.parse({
    overseer: {
      provider: {
        name: "fake",
        kind: "subscription_cli",
        model: "fake-model",
        effort: "medium",
        execution_mode: "subscription_cli",
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.argv[1] ?? '')", "{{input}}"],
        timeout_ms: 10000,
      },
    },
  });
}

function emptyConfig() {
  // No provider — handleConversation takes the configs.length === 0 branch
  // and still calls appendConversationLog.
  return RelayConfig.parse({});
}

let projectRoot: string;
let originalCwd: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "convlog-pr-"));
  await mkdir(join(projectRoot, "bin"), { recursive: true });
  originalCwd = process.cwd();
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(projectRoot, { recursive: true, force: true });
});

async function readLogLines(root: string): Promise<unknown[]> {
  const path = join(root, ".relayos", "overseer", "conversation_log.jsonl");
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => JSON.parse(s));
}

describe("appendConversationLog respects projectRoot", () => {
  it("writes to <projectRoot>/.relayos/overseer/ even when cwd is bin/", async () => {
    process.chdir(join(projectRoot, "bin"));
    await appendConversationLog(
      [{ role: "user", content: "hello from bin/" }],
      projectRoot,
    );

    const lines = await readLogLines(projectRoot);
    expect(lines).toHaveLength(1);
    expect((lines[0] as { content: string }).content).toBe("hello from bin/");

    // CRUCIAL: bin/.relayos/ must NOT exist
    expect(
      existsSync(join(projectRoot, "bin", ".relayos")),
    ).toBe(false);
  });

  it("writes to <projectRoot>/.relayos/overseer/ when cwd is /", async () => {
    process.chdir("/");
    await appendConversationLog(
      [{ role: "user", content: "from /" }],
      projectRoot,
    );

    const lines = await readLogLines(projectRoot);
    expect(lines).toHaveLength(1);

    // CRUCIAL: nothing leaked into /
    expect(existsSync("/.relayos")).toBe(false);
  });

  it("creates the overseer dir on first write", async () => {
    expect(existsSync(join(projectRoot, ".relayos", "overseer"))).toBe(false);
    await appendConversationLog(
      [{ role: "user", content: "first message" }],
      projectRoot,
    );
    expect(existsSync(join(projectRoot, ".relayos", "overseer"))).toBe(true);
  });

  it("throws if projectRoot is empty (no silent fallback to cwd)", async () => {
    await expect(
      appendConversationLog([{ role: "user", content: "x" }], ""),
    ).rejects.toThrow(/projectRoot is required/);
  });

  it("appends multiple messages in one call as separate JSONL lines", async () => {
    await appendConversationLog(
      [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
      ],
      projectRoot,
    );
    const lines = await readLogLines(projectRoot);
    expect(lines.map((l) => (l as { role: string }).role)).toEqual([
      "user",
      "assistant",
    ]);
  });
});

describe("handleConversation routes log writes through scope.projectRoot", () => {
  it("no-provider branch writes to projectRoot, not cwd", async () => {
    process.chdir(join(projectRoot, "bin"));
    const messages: ConversationMessage[] = [
      { role: "user", content: "hello no-provider" },
    ];
    await handleConversation(messages, emptyConfig(), { projectRoot });

    const lines = await readLogLines(projectRoot);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(projectRoot, "bin", ".relayos"))).toBe(false);
  });

  it("with-provider branch writes both user + assistant lines to projectRoot", async () => {
    process.chdir(join(projectRoot, "bin"));
    const messages: ConversationMessage[] = [
      { role: "user", content: "ping" },
    ];
    await handleConversation(messages, echoConfig(), { projectRoot });

    const lines = await readLogLines(projectRoot);
    // user + assistant
    expect(lines).toHaveLength(2);
    const roles = lines.map((l) => (l as { role: string }).role);
    expect(roles).toEqual(["user", "assistant"]);
    expect(existsSync(join(projectRoot, "bin", ".relayos"))).toBe(false);
  });
});
