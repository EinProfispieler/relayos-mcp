import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleConversation, type ConversationMessage } from "../src/conversation.js";
import { RelayConfig } from "../src/schema.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "relayos-bundle-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeOverseerFile(projectRoot: string, name: string, content: string): void {
  const dir = join(projectRoot, ".relayos", "overseer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, "utf8");
}

// Fake provider: a node -e script that echoes argv[1] (the {{input}}), so the
// reply equals the full scoped provider input — bundle included.
function echoConfig() {
  return RelayConfig.parse({
    overseer: {
      provider: {
        name: "fake", kind: "subscription_cli", model: "fake-model",
        effort: "medium", execution_mode: "subscription_cli",
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.argv[1] ?? '')", "{{input}}"],
        timeout_ms: 10000,
      },
    },
  });
}

async function turn(projectRoot: string): Promise<string> {
  const messages: ConversationMessage[] = [{ role: "user", content: "hello" }];
  const result = await handleConversation(messages, echoConfig(), { projectRoot });
  return result.reply;
}

describe("buildOverseerContextBundle (4-layer)", () => {
  it("Layer 1 — always injects the Overseer identity", async () => {
    const reply = await turn(tempProject());
    expect(reply).toContain("RELAYOS OVERSEER — ROLE & IDENTITY");
    expect(reply).toContain("HANDOFF");
  });

  it("Layer 2 — includes policy files when present", async () => {
    const root = tempProject();
    writeOverseerFile(root, "OPERATING_POLICY.md", "POLICY-MARKER-A");
    writeOverseerFile(root, "FORBIDDEN_ACTIONS.md", "FORBIDDEN-MARKER-B");
    const reply = await turn(root);
    expect(reply).toContain("=== OPERATING POLICY ===");
    expect(reply).toContain("POLICY-MARKER-A");
    expect(reply).toContain("=== FORBIDDEN ACTIONS ===");
    expect(reply).toContain("FORBIDDEN-MARKER-B");
  });

  it("Layer 2 — omits policy sections gracefully when files are absent", async () => {
    const reply = await turn(tempProject());
    expect(reply).not.toContain("=== OPERATING POLICY ===");
    expect(reply).toContain("RELAYOS OVERSEER — ROLE & IDENTITY"); // identity still present
  });

  it("Layer 3 — includes TODO and NEXT_ACTION when present", async () => {
    const root = tempProject();
    writeOverseerFile(root, "TODO.md", "TODO-MARKER-C");
    writeOverseerFile(root, "NEXT_ACTION.md", "NEXT-MARKER-D");
    const reply = await turn(root);
    expect(reply).toContain("=== TODO ===");
    expect(reply).toContain("TODO-MARKER-C");
    expect(reply).toContain("=== NEXT ACTION ===");
    expect(reply).toContain("NEXT-MARKER-D");
  });

  it("layer order — identity precedes policy precedes project", async () => {
    const root = tempProject();
    writeOverseerFile(root, "OPERATING_POLICY.md", "POLICY-MARKER-A");
    writeOverseerFile(root, "PROJECT_BRIEF.md", "BRIEF-MARKER-E");
    const reply = await turn(root);
    const idIdx = reply.indexOf("RELAYOS OVERSEER — ROLE & IDENTITY");
    const policyIdx = reply.indexOf("=== OPERATING POLICY ===");
    const briefIdx = reply.indexOf("=== PROJECT BRIEF ===");
    expect(idIdx).toBeGreaterThanOrEqual(0);
    expect(policyIdx).toBeGreaterThan(idIdx);
    expect(briefIdx).toBeGreaterThan(policyIdx);
  });
});
