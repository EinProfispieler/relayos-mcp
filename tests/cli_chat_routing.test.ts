import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runChatSingleInput } from "../src/cli.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-chat-routing-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

async function runChatStdin(input: string): Promise<string> {
  let stdout = "";
  await runChatSingleInput(input, {
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: () => {} },
  });
  return stdout;
}

describe("relayos chat routing", () => {
  it("routes non-slash input to conversation mode (no ROUTE/AI PLAN/ACTION PROPOSAL)", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const out = await runChatStdin("what can you do in this project\n");
    expect(out).toContain("provider-not-configured:");
    expect(out).not.toContain("ROUTE");
    expect(out).not.toContain("AI PLAN");
    expect(out).not.toContain("ACTION PROPOSAL");
  });

  it("does not create task records for non-slash input", async () => {
    const cwd = tempDir();
    chdir(cwd);
    await runChatStdin("tell me about this project\n");
    expect(existsSync(join(cwd, ".relayos", "overseer", "tasks.jsonl"))).toBe(false);
  });

  it("supports slash commands in stdin mode", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const help = await runChatStdin("/help\n");
    expect(help).toContain("Slash commands");
    expect(help).toContain("/status");
    expect(help).toContain("/run");
    expect(help).toContain("/settings");
    expect(help).toContain("/exit");

    const status = await runChatStdin("/status\n");
    expect(status).toContain("supported in interactive mode");

    const tasks = await runChatStdin("/tasks\n");
    expect(tasks).toContain("supported in interactive mode");

    const run = await runChatStdin("/run\n");
    expect(run).toContain("supported in interactive mode");

    const settings = await runChatStdin("/settings\n");
    expect(settings).toContain("interactive-only");

    const exit = await runChatStdin("/exit\n");
    expect(exit).toContain("session closed");
  });

  it("returns provider-not-configured message when no AI provider is configured", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const out = await runChatStdin("hello\n");
    expect(out).toContain("provider-not-configured:");
    const logPath = join(cwd, ".relayos", "overseer", "conversation_log.jsonl");
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf8")).toContain("\"role\":\"user\"");
  });

  it("returns provider-configured-but-not-executable when provider config is present", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const cfgDir = join(cwd, ".relayos");
    rmSync(cfgDir, { recursive: true, force: true });
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        overseer: {
          provider: "chatgpt",
          kind: "subscription",
          model: "gpt-5.5-thinking",
          effort: "high",
          execution_mode: "plan",
        },
      }),
      "utf8",
    );
    const out = await runChatStdin("hello\n");
    expect(out).toContain("provider-configured-but-not-executable:");
    expect(out).toContain("chatgpt/gpt-5.5-thinking [subscription]");
  });
});
