import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStorageLayout, ensureStorage, type StorageLayout } from "../src/storage.js";

export async function tempLayout(): Promise<{ layout: StorageLayout; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "ahg-test-"));
  const layout = resolveStorageLayout({ HANDOFF_DIR: dir });
  await ensureStorage(layout);
  return {
    layout,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function sampleInput(overrides: Record<string, unknown> = {}) {
  return {
    source_agent: "claude",
    target_agent: "codex",
    model: "gpt-5-codex",
    effort: "high",
    execution_mode: "patch",
    task_title: "Replace string concat with template literals in api/util",
    task_description:
      "Refactor src/api/util/format.ts to use template literals; keep behavior identical.",
    allowed_files: ["src/api/util/**/*.ts", "tests/api/util/**"],
    forbidden_files: [".env*", "secrets/**"],
    constraints: ["No new dependencies", "Keep public API stable"],
    expected_output: "A unified diff and a one-paragraph summary of the change.",
    ...overrides,
  };
}
