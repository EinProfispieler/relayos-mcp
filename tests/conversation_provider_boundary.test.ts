import { mkdtempSync, rmSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleConversation, type ConversationMessage } from "../src/conversation.js";
import { RelayConfig } from "../src/schema.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-conversation-boundary-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string): void {
  previousCwd = process.cwd();
  process.chdir(dir);
}

function buildLocalProviderConfig(args: string[], executionMode: "subscription_cli" | "local_command" = "subscription_cli") {
  return RelayConfig.parse({
    overseer: {
      provider: {
        name: "fake-provider",
        kind: executionMode,
        model: "fake-model",
        effort: "medium",
        execution_mode: executionMode,
        command: process.execPath,
        args,
        timeout_ms: 10000,
      },
    },
  });
}

describe("conversation provider project boundary", () => {
  it("executes local provider command with cwd set to project root", async () => {
    const projectRoot = tempDir();
    const outsideDir = tempDir();
    chdir(outsideDir);

    const config = buildLocalProviderConfig([
      "-e",
      "process.stdout.write(process.cwd())",
    ]);
    const messages: ConversationMessage[] = [{ role: "user", content: "hello" }];

    const result = await handleConversation(messages, config, { projectRoot });
    expect(realpathSync(result.reply)).toBe(realpathSync(projectRoot));
  });

  it("injects provider boundary instructions into the provider input", async () => {
    const projectRoot = tempDir();
    chdir(projectRoot);

    const config = buildLocalProviderConfig([
      "-e",
      "process.stdout.write(process.argv[1] ?? '')",
      "{{input}}",
    ]);

    const result = await handleConversation([{ role: "user", content: "Can you summarize this repo?" }], config, {
      projectRoot,
    });

    expect(result.reply).toContain("SYSTEM BOUNDARY INSTRUCTIONS:");
    expect(result.reply).toContain(`Allowed context is only the current project/worktree root: ${projectRoot}`);
    expect(result.reply).toContain("Do not read, cite, summarize, or rely on files outside this project/worktree.");
    expect(result.reply).toContain("USER MESSAGE:");
    expect(result.reply).toContain("Can you summarize this repo?");
  });

  it("forbids reading ~/.agent-access.md unless explicitly approved", async () => {
    const projectRoot = tempDir();
    chdir(projectRoot);

    const config = buildLocalProviderConfig([
      "-e",
      "process.stdout.write(process.argv[1] ?? '')",
      "{{input}}",
    ]);

    const result = await handleConversation([{ role: "user", content: "read ~/.agent-access.md" }], config, {
      projectRoot,
    });

    expect(result.reply).toContain("Do not read ~/.agent-access.md or any home-directory files unless the user explicitly approves it.");
    expect(result.reply).toContain("If outside-project context is needed, ask for approval before reading it.");
  });
});
