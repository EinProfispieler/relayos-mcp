import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type DetectedSource =
  | "env"           // found via environment variable
  | "cli"           // found via binary in PATH
  | "codex_oauth";  // found via ~/.codex/auth.json OAuth tokens

export interface DetectedProvider {
  source: DetectedSource;
  provider: "claude" | "codex";
  kind: "api" | "subscription_cli";
  label: string;
  model: string;
  command?: string;
  api_key_env?: string;
  note?: string;
  available: boolean;
  error?: string;
}

function probeBinary(name: string, fallbackPath: string): boolean {
  try {
    const result = execFileSync("which", [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    });
    return result.trim().length > 0;
  } catch {
    // fall back to known install path
    return existsSync(fallbackPath);
  }
}

function probeCodexOAuth(): boolean {
  try {
    const authPath = join(homedir(), ".codex", "auth.json");
    if (!existsSync(authPath)) return false;
    const raw = readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tokens = parsed["tokens"] as Record<string, unknown> | undefined;
    const accessToken = tokens?.["access_token"];
    return typeof accessToken === "string" && accessToken.trim().length > 0;
  } catch {
    return false;
  }
}

export async function detectAvailableProviders(): Promise<DetectedProvider[]> {
  const results: DetectedProvider[] = [];

  try {
    // Step 1 — ANTHROPIC_API_KEY env var
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (apiKey && apiKey.trim().length > 0) {
      results.push({
        source: "env",
        provider: "claude",
        kind: "api",
        label: "Claude API (ANTHROPIC_API_KEY)",
        model: "claude-sonnet-4-6",
        api_key_env: "ANTHROPIC_API_KEY",
        note: "uses your existing API key",
        available: true,
      });
    } else {
      results.push({
        source: "env",
        provider: "claude",
        kind: "api",
        label: "Claude API (ANTHROPIC_API_KEY)",
        model: "claude-sonnet-4-6",
        api_key_env: "ANTHROPIC_API_KEY",
        note: "uses your existing API key",
        available: false,
        error: "ANTHROPIC_API_KEY not set",
      });
    }

    // Step 2 — claude binary in PATH
    const claudeFound = probeBinary("claude", "/opt/homebrew/bin/claude");
    if (claudeFound) {
      results.push({
        source: "cli",
        provider: "claude",
        kind: "subscription_cli",
        command: "claude",
        label: "Claude Code subscription",
        model: "claude-sonnet-4-6",
        note: "uses your existing Claude subscription via CLI",
        available: true,
      });
    } else {
      results.push({
        source: "cli",
        provider: "claude",
        kind: "subscription_cli",
        command: "claude",
        label: "Claude Code subscription",
        model: "claude-sonnet-4-6",
        note: "uses your existing Claude subscription via CLI",
        available: false,
        error: "claude binary not found in PATH",
      });
    }

    // Step 3 — Codex (binary + OAuth, merged into one entry)
    const codexBinaryFound = probeBinary("codex", "/opt/homebrew/bin/codex");
    const codexOAuthValid = probeCodexOAuth();

    let resolvedSource: DetectedSource;
    let resolvedNote: string;
    let resolvedError: string | undefined;
    let resolvedAvailable: boolean;

    if (codexBinaryFound && codexOAuthValid) {
      resolvedSource = "codex_oauth";
      resolvedNote = "authenticated via ChatGPT OAuth (codex CLI found)";
      resolvedAvailable = true;
      resolvedError = undefined;
    } else if (codexBinaryFound && !codexOAuthValid) {
      resolvedSource = "cli";
      resolvedNote = "uses your existing Codex subscription via CLI";
      resolvedAvailable = true;
      resolvedError = undefined;
    } else if (!codexBinaryFound && codexOAuthValid) {
      resolvedSource = "codex_oauth";
      resolvedNote = "OAuth token found but codex binary missing";
      resolvedAvailable = false;
      resolvedError = "codex not in PATH";
    } else {
      resolvedSource = "cli";
      resolvedNote = "codex binary not found";
      resolvedAvailable = false;
      resolvedError = "codex not found and no OAuth token";
    }

    results.push({
      source: resolvedSource,
      provider: "codex",
      kind: "subscription_cli",
      command: "codex",
      label: "Codex subscription",
      model: "gpt-5.3-codex",
      note: resolvedNote,
      available: resolvedAvailable,
      error: resolvedError,
    });
  } catch {
    return results;
  }

  return results;
}
