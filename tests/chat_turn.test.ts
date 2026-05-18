import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChatTurn, type ChatTurnResult } from "../src/chat.js";
import type { handleConversation } from "../src/conversation.js";

// Minimal CliIO stub
function makeIO() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: { write: (s: string) => { out.push(s); } },
      stderr: { write: (s: string) => { err.push(s); } },
    },
    out,
    err,
    getSentinel(): ChatTurnResult | null {
      const line = out.find((l) => l.startsWith("@@RELAYOS_TURN@@ "));
      if (!line) return null;
      return JSON.parse(line.slice("@@RELAYOS_TURN@@ ".length)) as ChatTurnResult;
    },
  };
}

// Stub conversation function — returns deterministic replies keyed by message content
type ConverseFn = typeof handleConversation;
function stubConversation(messageToReply: Record<string, string>): ConverseFn {
  return async (messages, _config, _scope) => {
    const last = messages[messages.length - 1]?.content ?? "";
    const reply = messageToReply[last] ?? `echo: ${last}`;
    return { reply, provider_used: "stub/test-model/medium" } as unknown as Awaited<ReturnType<ConverseFn>>;
  };
}

const IMPL_REPLY = `Sure, I'll implement that.

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

const RELEASE_REPLY = `I'll commit and push.

ACTION_INTENT
intent_type: create_handoff
confidence: 0.9
summary: commit and push current changes
target: codex
model: gpt-5.3-codex
effort: medium
mode: patch
approval_required: true
END_ACTION_INTENT`;

const CONVO_REPLY = "Hello! How can I help you today?";

describe("runChatTurn", () => {
  let tmpDir: string;
  const origEnv = process.env.HANDOFF_DIR;
  const origCwd = process.cwd();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "relayos-test-turn-"));
    process.env.HANDOFF_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (origEnv === undefined) delete process.env.HANDOFF_DIR;
    else process.env.HANDOFF_DIR = origEnv;
    process.chdir(origCwd);
  });

  it("emits sentinel JSON line on stdout", async () => {
    const { io, getSentinel } = makeIO();
    await runChatTurn(
      "hello",
      io,
      { conversation: stubConversation({ hello: CONVO_REPLY }) },
    );
    const result = getSentinel();
    expect(result).not.toBeNull();
  });

  it("returns exit code 0", async () => {
    const { io } = makeIO();
    const code = await runChatTurn("hello", io, {
      conversation: stubConversation({ hello: CONVO_REPLY }),
    });
    expect(code).toBe(0);
  });

  it("plain conversation reply — no handoff_id, needs_approval false", async () => {
    const { io, getSentinel } = makeIO();
    await runChatTurn("hello", io, {
      conversation: stubConversation({ hello: CONVO_REPLY }),
    });
    const r = getSentinel()!;
    expect(r.reply).toBe(CONVO_REPLY);
    expect(r.handoff_id).toBeNull();
    expect(r.needs_approval).toBe(false);
    expect(r.ai_plan).toBeNull();
  });

  it("implementation intent — produces handoff_id", async () => {
    const { io, getSentinel } = makeIO();
    await runChatTurn(
      "add a hello function to src/util.ts",
      io,
      { conversation: stubConversation({ "add a hello function to src/util.ts": IMPL_REPLY }) },
    );
    const r = getSentinel()!;
    expect(r.reply).toBeTruthy();
    expect(r.handoff_id).toMatch(/^h_/);
    expect(r.needs_approval).toBe(false);
    expect(r.ai_plan).not.toBeNull();
    expect(r.action_proposal?.action).toBe("create_handoff");
  });

  it("release/approval_required message — needs_approval true, no auto-execute handoff", async () => {
    const { io, getSentinel } = makeIO();
    await runChatTurn(
      "commit and push",
      io,
      { conversation: stubConversation({ "commit and push": RELEASE_REPLY }) },
    );
    const r = getSentinel()!;
    expect(r.needs_approval).toBe(true);
    expect(r.action_proposal?.action).toBe("request_approval");
    // handoff should not have been created (proposal is blocked)
    expect(r.handoff_id).toBeNull();
  });

  it("empty message — emits empty reply sentinel", async () => {
    const { io, getSentinel } = makeIO();
    await runChatTurn("  ", io, { conversation: stubConversation({}) });
    const r = getSentinel()!;
    expect(r.reply).toBe("");
    expect(r.handoff_id).toBeNull();
  });

  it("conversation error — emits error reply, exit code 0", async () => {
    const { io, getSentinel, err } = makeIO();
    const brokenConversation: ConverseFn = async () => { throw new Error("provider down"); };
    const code = await runChatTurn("anything", io, {
      conversation: brokenConversation,
    });
    expect(code).toBe(0);
    const r = getSentinel()!;
    expect(r.reply).toContain("Error");
    expect(err.join("")).toContain("provider down");
  });
});
