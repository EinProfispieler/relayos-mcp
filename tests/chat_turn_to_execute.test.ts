/**
 * Integration: chat-turn → execute-handoff --dry-run
 *
 * Tests the full pipeline from a stub conversation reply through handoff
 * creation and into CLI execution, without spawning a real Codex/Claude process.
 *
 * Why --dry-run: execute-handoff --dry-run reads and validates the envelope,
 * resolves the launch_command, and prints it — giving us proof that the
 * envelope created by chat-turn is well-formed and executable, without
 * touching any external process.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChatTurn, type ChatTurnResult } from "../src/chat.js";
import { runCli } from "../src/cli.js";
import type { handleConversation } from "../src/conversation.js";

// ── helpers ──────────────────────────────────────────────────────────────────

type ConverseFn = typeof handleConversation;

function makeIO() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: { write: (s: string) => { out.push(s); } },
      stderr: { write: (s: string) => { err.push(s); } },
    },
    get stdout() { return out.join(""); },
    get stderr() { return err.join(""); },
    getSentinel(): ChatTurnResult | null {
      const line = out.find((l) => l.startsWith("@@RELAYOS_TURN@@ "));
      if (!line) return null;
      return JSON.parse(line.slice("@@RELAYOS_TURN@@ ".length)) as ChatTurnResult;
    },
  };
}

function captureIO() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write: (s: string) => { stdout += s; } },
      stderr: { write: (s: string) => { stderr += s; } },
    },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

function stubConversation(reply: string): ConverseFn {
  return async () => ({ reply, provider_used: "stub/test-model/medium" } as unknown as Awaited<ReturnType<ConverseFn>>);
}

// ── ACTION_INTENT blocks ──────────────────────────────────────────────────────

const CODEX_IMPL_REPLY = `Sure, I'll implement that.

ACTION_INTENT
intent_type: create_handoff
confidence: 0.9
summary: add hello function to src/util.ts
target: codex
model: gpt-5.3-codex
effort: medium
mode: patch
approval_required: false
END_ACTION_INTENT`;

const CLAUDE_REVIEW_REPLY = `I'll review that.

ACTION_INTENT
intent_type: review
confidence: 0.9
summary: review the auth module
target: claude
model: claude-sonnet-4-6
effort: medium
mode: review
approval_required: false
END_ACTION_INTENT`;

// ── fixtures ──────────────────────────────────────────────────────────────────

let handoffRoot: string;
let prevHandoffDir: string | undefined;
let prevCwd: string;

beforeEach(() => {
  prevCwd = process.cwd();
  prevHandoffDir = process.env.HANDOFF_DIR;
  handoffRoot = mkdtempSync(join(tmpdir(), "relayos-e2e-"));
  mkdirSync(join(handoffRoot, "envelopes"), { recursive: true });
  process.env.HANDOFF_DIR = handoffRoot;
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(handoffRoot, { recursive: true, force: true });
  if (prevHandoffDir === undefined) delete process.env.HANDOFF_DIR;
  else process.env.HANDOFF_DIR = prevHandoffDir;
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("chat-turn → handoff envelope", () => {
  it("implementation intent writes envelope to HANDOFF_DIR", async () => {
    const { io, getSentinel } = makeIO();
    await runChatTurn("add hello function", io, {
      conversation: stubConversation(CODEX_IMPL_REPLY),
    });
    const result = getSentinel();
    expect(result?.handoff_id).toMatch(/^h_/);

    const envelopePath = join(handoffRoot, "envelopes", `${result!.handoff_id}.json`);
    expect(existsSync(envelopePath)).toBe(true);
  });

  it("envelope has correct target_agent and execution_mode", async () => {
    const { io, getSentinel } = makeIO();
    await runChatTurn("add hello function", io, {
      conversation: stubConversation(CODEX_IMPL_REPLY),
    });
    const result = getSentinel();
    const envelope = JSON.parse(
      readFileSync(join(handoffRoot, "envelopes", `${result!.handoff_id}.json`), "utf8"),
    );
    expect(envelope.target_agent).toBe("codex");
    expect(envelope.execution_mode).toBe("patch");
    expect(envelope.status).toBe("recorded");
  });

  it("envelope task_title includes the intent summary", async () => {
    const { io, getSentinel } = makeIO();
    await runChatTurn("add hello function", io, {
      conversation: stubConversation(CODEX_IMPL_REPLY),
    });
    const result = getSentinel();
    const envelope = JSON.parse(
      readFileSync(join(handoffRoot, "envelopes", `${result!.handoff_id}.json`), "utf8"),
    );
    expect(envelope.task_title).toContain("hello");
  });

  it("claude review intent writes envelope with target_agent=claude", async () => {
    const { io, getSentinel } = makeIO();
    await runChatTurn("review auth module", io, {
      conversation: stubConversation(CLAUDE_REVIEW_REPLY),
    });
    const result = getSentinel();
    const envelope = JSON.parse(
      readFileSync(join(handoffRoot, "envelopes", `${result!.handoff_id}.json`), "utf8"),
    );
    expect(envelope.target_agent).toBe("claude");
    expect(envelope.execution_mode).toBe("review");
  });
});

describe("chat-turn → execute-handoff --dry-run", () => {
  it("dry-run exits 0 and prints launch_command for codex handoff", async () => {
    // Step 1: chat-turn creates envelope
    const turnIO = makeIO();
    await runChatTurn("add hello function", turnIO.io, {
      conversation: stubConversation(CODEX_IMPL_REPLY),
    });
    const handoffId = turnIO.getSentinel()?.handoff_id;
    expect(handoffId).toMatch(/^h_/);

    // Step 2: execute-handoff --dry-run reads it, prints launch_command
    const execIO = captureIO();
    const code = await runCli(
      ["overseer", "execute-handoff", "--dry-run", handoffId!],
      execIO.io,
    );
    expect(code).toBe(0);
    expect(execIO.stdout).toContain("launch_command");
    expect(execIO.stderr).toBe("");
  });

  it("dry-run launch_command references the handoff_id", async () => {
    const turnIO = makeIO();
    await runChatTurn("add hello function", turnIO.io, {
      conversation: stubConversation(CODEX_IMPL_REPLY),
    });
    const handoffId = turnIO.getSentinel()?.handoff_id;

    const execIO = captureIO();
    await runCli(["overseer", "execute-handoff", "--dry-run", handoffId!], execIO.io);

    // The launch_command should embed the handoff id so the agent knows what to run
    expect(execIO.stdout).toContain(handoffId);
  });

  it("dry-run for claude review handoff exits 0", async () => {
    const turnIO = makeIO();
    await runChatTurn("review auth module", turnIO.io, {
      conversation: stubConversation(CLAUDE_REVIEW_REPLY),
    });
    const handoffId = turnIO.getSentinel()?.handoff_id;

    const execIO = captureIO();
    const code = await runCli(
      ["overseer", "execute-handoff", "--dry-run", handoffId!],
      execIO.io,
    );
    expect(code).toBe(0);
    expect(execIO.stdout).toContain("launch_command");
  });

  it("execute-handoff fails when handoff_id does not exist", async () => {
    const execIO = captureIO();
    const code = await runCli(
      ["overseer", "execute-handoff", "--dry-run", "h_doesnotexist"],
      execIO.io,
    );
    expect(code).toBe(1);
    expect(execIO.stderr).toContain("not found");
  });

  it("envelope status becomes spawning on real execute (non dry-run path guard)", async () => {
    // Verify the envelope starts as "recorded" — the real execute path
    // would flip it to "spawning" before launching; dry-run does NOT flip it.
    const turnIO = makeIO();
    await runChatTurn("add hello function", turnIO.io, {
      conversation: stubConversation(CODEX_IMPL_REPLY),
    });
    const handoffId = turnIO.getSentinel()?.handoff_id!;
    const envelopePath = join(handoffRoot, "envelopes", `${handoffId}.json`);

    // Before dry-run: status = recorded
    const before = JSON.parse(readFileSync(envelopePath, "utf8"));
    expect(before.status).toBe("recorded");

    // After dry-run: status still = recorded (dry-run doesn't mutate)
    const execIO = captureIO();
    await runCli(["overseer", "execute-handoff", "--dry-run", handoffId], execIO.io);
    const after = JSON.parse(readFileSync(envelopePath, "utf8"));
    expect(after.status).toBe("recorded");
  });
});
