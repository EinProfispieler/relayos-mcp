import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSettingsWizard } from "../src/settings.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "relayos-settings-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeConfig(cwd: string, config: unknown): void {
  mkdirSync(join(cwd, ".relayos"), { recursive: true });
  writeFileSync(join(cwd, ".relayos/config.json"), JSON.stringify(config), "utf8");
}

function readConfig(cwd: string): any {
  return JSON.parse(readFileSync(join(cwd, ".relayos/config.json"), "utf8"));
}

async function runWizard(cwd: string, answers: string[]): Promise<string> {
  let stdout = "";
  let index = 0;
  await runSettingsWizard(cwd, {
    write: (text) => {
      stdout += text;
    },
    ask: async () => answers[index++] ?? "",
  });
  return stdout;
}

describe("settings wizard", () => {
  it("keeps timeout_ms from nested provider config when quick setup keeps defaults", async () => {
    const cwd = tempDir();
    writeConfig(cwd, {
      overseer: {
        provider: {
          name: "codex",
          kind: "subscription_cli",
          model: "gpt-5.5",
          effort: "high",
          execution_mode: "subscription_cli",
          command: "codex",
          args: ["exec", "{{input}}"],
          timeout_ms: 600000,
        },
      },
    });

    await runWizard(cwd, ["quick", "", "", ""]);

    expect(readConfig(cwd).overseer.timeout_ms).toBe(600000);
  });

  it("does not reset timeout_ms when selecting a Codex preset", async () => {
    const cwd = tempDir();
    writeConfig(cwd, {
      overseer: {
        provider: "codex",
        kind: "subscription_cli",
        model: "gpt-5.3-codex",
        effort: "medium",
        execution_mode: "subscription_cli",
        command: "codex",
        args: ["exec", "{{input}}"],
        timeout_ms: 900000,
      },
    });

    // "codex-plan" preset sets model to gpt-5.5 and preserves timeout_ms from existing config
    await runWizard(cwd, ["preset", "codex-plan"]);

    const config = readConfig(cwd);
    expect(config.overseer.model).toBe("gpt-5.5");
    expect(config.overseer.language).toBe("english");
    expect(config.overseer.timeout_ms).toBe(900000);
  });

  it("quick flow can persist language chinese", async () => {
    const cwd = tempDir();
    writeConfig(cwd, {
      overseer: {
        provider: "codex",
        kind: "subscription_cli",
        model: "gpt-5.3-codex",
        effort: "medium",
        execution_mode: "subscription_cli",
        command: "codex",
        args: ["exec", "{{input}}"],
        timeout_ms: 120000,
      },
    });

    // quick flow: flow=quick, ai=codex, mode=plan, timeout=default, language=chinese
    await runWizard(cwd, ["quick", "", "", "", "chinese"]);

    const config = readConfig(cwd);
    expect(config.overseer.language).toBe("chinese");
  });
});
