import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readOverseerMemoryIndex } from "../src/tools/read_overseer_memory_index.js";

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
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-memory-index-tool-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

function writeOverseerFile(cwd: string, filename: string, content: string) {
  const dir = join(cwd, ".relayos", "overseer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, "utf8");
}

describe("read_overseer_memory_index", () => {
  it("returns stable shape with required category keys and read-only defaults", async () => {
    const cwd = tempDir();
    chdir(cwd);

    const result = await readOverseerMemoryIndex({});

    expect(result.tool).toBe("read_overseer_memory_index");
    expect(result.generated_live).toBe(true);
    expect(result.persisted).toBe(false);
    expect(Array.isArray(result.retrieval_priority)).toBe(true);
    expect(result.retrieval_priority).toEqual([
      "decisions",
      "summary",
      "handoff_results",
      "capabilities/doctor",
      "recent_notes",
      "docs_backlog",
    ]);
    expect(typeof result.record_counts.total).toBe("number");
    expect("project_state" in result.categories).toBe(true);
    expect("current_version_release_state" in result.categories).toBe(true);
    expect("workflow_rules" in result.categories).toBe(true);
    expect("product_decisions" in result.categories).toBe(true);
    expect("implementation_notes" in result.categories).toBe(true);
    expect("handoff_results" in result.categories).toBe(true);
    expect("blockers" in result.categories).toBe(true);
    expect("environment_recovery_policy" in result.categories).toBe(true);
    expect("capability_policy" in result.categories).toBe(true);
    expect("docs_backlog" in result.categories).toBe(true);
    expect("next_actions" in result.categories).toBe(true);
    expect("forbidden_actions" in result.categories).toBe(true);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("applies strict input validation", async () => {
    chdir(tempDir());
    await expect(readOverseerMemoryIndex({ limit: 0 })).rejects.toThrow();
    await expect(readOverseerMemoryIndex({ limit: 21 })).rejects.toThrow();
    await expect(readOverseerMemoryIndex({ limit: 2.5 })).rejects.toThrow();
    await expect(readOverseerMemoryIndex({ limit: "2" })).rejects.toThrow();
    await expect(readOverseerMemoryIndex({ limit: 2, bad: true })).rejects.toThrow();
  });

  it("prioritizes decisions over notes and maps handoff blockers and capability policy/forbidden actions", async () => {
    const cwd = tempDir();
    chdir(cwd);
    writeOverseerFile(
      cwd,
      "decisions.jsonl",
      `${JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", text: "Keep local-first." })}\n`,
    );
    writeOverseerFile(
      cwd,
      "timeline.jsonl",
      `${JSON.stringify({ ts: "2026-01-01T00:01:00.000Z", text: "Need follow-up implementation note." })}\n`,
    );
    writeOverseerFile(
      cwd,
      "handoff_results.jsonl",
      `${JSON.stringify({ ts: "2026-01-01T00:02:00.000Z", run_id: "run-1", status: "blocked", summary: "Waiting on review." })}\n`,
    );

    const result = await readOverseerMemoryIndex({ limit: 8 });

    expect(result.categories.product_decisions.length).toBeGreaterThan(0);
    expect(result.categories.implementation_notes.length).toBeGreaterThan(0);
    expect(result.categories.product_decisions[0]?.priority).toBeLessThan(
      result.categories.implementation_notes[0]?.priority ?? 999,
    );
    expect(
      result.categories.blockers.some((item) => item.text.includes("blocked")),
    ).toBe(true);
    expect(result.categories.capability_policy.length).toBeGreaterThan(0);
    expect(result.categories.forbidden_actions.length).toBeGreaterThan(0);
  });
});
