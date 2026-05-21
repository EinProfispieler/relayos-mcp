/**
 * Regression tests proving provider cooldown reads/writes use the
 * provided project root — never `process.cwd()` — so invocations from
 * `bin/` (or any non-root cwd) cannot leak `provider_cooldowns.json`
 * into `bin/.relayos/`.
 *
 * Same class of bug as the appendConversationLog fix in Batch 2:
 * previously `readProviderCooldowns` / `writeProviderCooldowns` used
 * `process.cwd()`, which silently wrote to `bin/.relayos/overseer/`
 * when invoked from the launcher's working directory.
 */
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleConversation,
  readProviderCooldowns,
  writeProviderCooldowns,
  type ConversationMessage,
} from "../src/conversation.js";
import { RelayConfig } from "../src/schema.js";

const COOLDOWN_PATH = [".relayos", "overseer", "provider_cooldowns.json"] as const;

function cooldownPath(root: string): string {
  return join(root, ...COOLDOWN_PATH);
}

/**
 * Provider that prints "usage limit reached" — matches
 * isUsageLimitFailure(), triggers setProviderCooldown().
 */
function usageLimitConfig() {
  return RelayConfig.parse({
    overseer: {
      provider: {
        name: "fake",
        kind: "subscription_cli",
        model: "fake-model",
        effort: "medium",
        execution_mode: "subscription_cli",
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('usage limit reached')",
          "{{input}}",
        ],
        timeout_ms: 10000,
      },
    },
  });
}

let projectRoot: string;
let originalCwd: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "cooldown-pr-"));
  await mkdir(join(projectRoot, "bin"), { recursive: true });
  originalCwd = process.cwd();
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(projectRoot, { recursive: true, force: true });
});

// ── Direct unit tests ────────────────────────────────────────────────

describe("readProviderCooldowns / writeProviderCooldowns require projectRoot", () => {
  it("readProviderCooldowns throws on empty projectRoot", async () => {
    await expect(readProviderCooldowns("")).rejects.toThrow(
      /projectRoot is required/,
    );
  });

  it("writeProviderCooldowns throws on empty projectRoot", async () => {
    await expect(
      writeProviderCooldowns({ providers: {} }, ""),
    ).rejects.toThrow(/projectRoot is required/);
  });

  it("readProviderCooldowns returns empty state when file is missing", async () => {
    const state = await readProviderCooldowns(projectRoot);
    expect(state.providers).toEqual({});
  });

  it("round-trips a cooldown entry to projectRoot, not cwd", async () => {
    process.chdir(join(projectRoot, "bin"));

    await writeProviderCooldowns(
      {
        providers: {
          "claude:claude-sonnet-4-6:api": {
            blocked_until: new Date(Date.now() + 60_000).toISOString(),
            reason: "usage limit reached",
            updated_at: new Date().toISOString(),
          },
        },
      },
      projectRoot,
    );

    // File exists at projectRoot
    expect(existsSync(cooldownPath(projectRoot))).toBe(true);
    // bin/.relayos/ must NOT exist
    expect(existsSync(join(projectRoot, "bin", ".relayos"))).toBe(false);

    // Read pulls the same state from projectRoot
    const read = await readProviderCooldowns(projectRoot);
    expect(read.providers["claude:claude-sonnet-4-6:api"]?.reason).toBe(
      "usage limit reached",
    );
  });

  it("reads from projectRoot, not cwd — different roots are isolated", async () => {
    const otherRoot = await mkdtemp(join(tmpdir(), "cooldown-other-"));
    try {
      await writeProviderCooldowns(
        {
          providers: {
            "x:y:z": {
              blocked_until: "2099-01-01T00:00:00.000Z",
              reason: "test",
              updated_at: "2099-01-01T00:00:00.000Z",
            },
          },
        },
        projectRoot,
      );

      // Other root sees empty state
      const otherState = await readProviderCooldowns(otherRoot);
      expect(otherState.providers).toEqual({});

      // Original root sees its own entry
      const projState = await readProviderCooldowns(projectRoot);
      expect(projState.providers["x:y:z"]?.reason).toBe("test");
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("tolerates malformed cooldown file (returns empty state)", async () => {
    const { writeFile, mkdir: mkdirP } = await import("node:fs/promises");
    await mkdirP(join(projectRoot, ".relayos", "overseer"), {
      recursive: true,
    });
    await writeFile(cooldownPath(projectRoot), "not valid json{{");

    const state = await readProviderCooldowns(projectRoot);
    expect(state.providers).toEqual({});
  });
});

// ── Integration tests through handleConversation ─────────────────────

describe("handleConversation routes cooldown writes through scope.projectRoot", () => {
  it("usage-limit response writes provider_cooldowns.json to projectRoot when cwd is bin/", async () => {
    process.chdir(join(projectRoot, "bin"));

    const messages: ConversationMessage[] = [{ role: "user", content: "ping" }];
    const result = await handleConversation(messages, usageLimitConfig(), {
      projectRoot,
    });

    // The reply propagates back so we know the provider executed
    expect(result.reply.toLowerCase()).toContain("usage limit reached");

    // Cooldown file must land in projectRoot, NOT in bin/.relayos/
    expect(existsSync(cooldownPath(projectRoot))).toBe(true);
    expect(existsSync(join(projectRoot, "bin", ".relayos"))).toBe(false);

    // And the cooldown entry references the fake provider
    const raw = await readFile(cooldownPath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as {
      providers: Record<string, { reason: string }>;
    };
    const entries = Object.values(parsed.providers);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!.reason).toBe("usage limit reached");
  });

  it("blocked-provider state is read from projectRoot, not cwd", async () => {
    // Pre-seed a cooldown that is still in effect
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await writeProviderCooldowns(
      {
        providers: {
          "fake:fake-model:subscription_cli": {
            blocked_until: futureIso,
            reason: "pre-existing block",
            updated_at: new Date().toISOString(),
          },
        },
      },
      projectRoot,
    );

    // Run from bin/ so process.cwd() points away from the project root
    process.chdir(join(projectRoot, "bin"));
    const messages: ConversationMessage[] = [{ role: "user", content: "ping" }];

    // handleConversation must read the pre-existing block from
    // projectRoot when classifying providers as active vs blocked.
    // (When all providers are blocked it falls through to the
    // original configs[] list and executes one; the usage-limit reply
    // then triggers a fresh setProviderCooldown — which itself must
    // also write to projectRoot.) Either way: bin/.relayos/ must
    // NEVER appear.
    await handleConversation(messages, usageLimitConfig(), { projectRoot });
    expect(existsSync(join(projectRoot, "bin", ".relayos"))).toBe(false);

    // Cooldown state remains readable from projectRoot. Exact value
    // may have been overwritten by the fresh usage-limit hit — what
    // matters is that the entry is still present and routed through
    // projectRoot, not lost to cwd.
    const state = await readProviderCooldowns(projectRoot);
    const entry = state.providers["fake:fake-model:subscription_cli"];
    expect(entry).toBeDefined();
    expect(entry!.reason.length).toBeGreaterThan(0);
  });
});
