import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface OverseerLayout {
  dir: string;
  timelinePath: string;
  nextActionPath: string;
}

export function resolveOverseerLayout(cwd: string): OverseerLayout {
  const dir = join(cwd, ".relayos", "overseer");
  return {
    dir,
    timelinePath: join(dir, "timeline.jsonl"),
    nextActionPath: join(dir, "next_action.md"),
  };
}

export async function ensureOverseerDir(layout: OverseerLayout): Promise<void> {
  await mkdir(layout.dir, { recursive: true });
}

export interface OverseerNote {
  ts: string;
  text: string;
}

export async function appendNote(layout: OverseerLayout, text: string): Promise<void> {
  await ensureOverseerDir(layout);
  const entry: OverseerNote = { ts: new Date().toISOString(), text };
  await appendFile(layout.timelinePath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readLatestNotes(
  layout: OverseerLayout,
  limit = 5,
): Promise<OverseerNote[]> {
  if (!existsSync(layout.timelinePath)) return [];
  const raw = await readFile(layout.timelinePath, "utf8");
  const notes: OverseerNote[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      notes.push(JSON.parse(line) as OverseerNote);
    } catch {
      // skip malformed lines
    }
  }
  return notes.slice(-limit);
}

export async function writeNextAction(layout: OverseerLayout, text: string): Promise<void> {
  await ensureOverseerDir(layout);
  await writeFile(layout.nextActionPath, `${text}\n`, "utf8");
}

export async function readNextAction(layout: OverseerLayout): Promise<string | null> {
  if (!existsSync(layout.nextActionPath)) return null;
  const content = await readFile(layout.nextActionPath, "utf8");
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasOverseerState(layout: OverseerLayout): boolean {
  return existsSync(layout.timelinePath) || existsSync(layout.nextActionPath);
}

export async function readOverseerTextFile(
  layout: OverseerLayout,
  filename: string,
): Promise<string | null> {
  const filePath = join(layout.dir, filename);
  if (!existsSync(filePath)) return null;
  const content = await readFile(filePath, "utf8");
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Branch / progress helpers

export interface BranchPaths {
  briefPath: string;
  progressPath: string;
  dir: string;
}

export function resolveBranchPaths(layout: OverseerLayout): BranchPaths {
  const dir = join(layout.dir, "branches", "active");
  return {
    dir,
    briefPath: join(dir, "brief.md"),
    progressPath: join(dir, "progress.md"),
  };
}

export async function writeActiveBrief(
  layout: OverseerLayout,
  name: string,
): Promise<void> {
  const { dir, briefPath } = resolveBranchPaths(layout);
  await mkdir(dir, { recursive: true });
  await writeFile(briefPath, `${name}\n`, "utf8");
}

export async function readActiveBrief(
  layout: OverseerLayout,
): Promise<string | null> {
  const { briefPath } = resolveBranchPaths(layout);
  if (!existsSync(briefPath)) return null;
  const content = await readFile(briefPath, "utf8");
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function appendBranchProgress(
  layout: OverseerLayout,
  text: string,
): Promise<void> {
  const { dir, progressPath } = resolveBranchPaths(layout);
  await mkdir(dir, { recursive: true });
  const entry = `[${new Date().toISOString()}] ${text}`;
  await appendFile(progressPath, `${entry}\n`, "utf8");
}

export async function readBranchProgress(
  layout: OverseerLayout,
): Promise<string | null> {
  const { progressPath } = resolveBranchPaths(layout);
  if (!existsSync(progressPath)) return null;
  const content = await readFile(progressPath, "utf8");
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// init-context stub content

const STUB_CONTENTS: Record<string, string> = {
  "project_brief.md": "# Project Brief\n\n(fill in: what the project is and its Core/Solo direction)\n",
  "current.md": "# Current State\n\nAs of (date):\n\n## Latest commit anchor\n\n`(hash)` — (message)\n\n## Completed features\n\n- (list)\n\n## In progress / pending\n\n(none)\n",
  "release_policy.md": "# Release Policy\n\nNormal workflow: commit + push only. No tag or GitHub Release unless explicitly instructed.\n",
  "forbidden_actions.md": "# Forbidden Actions\n\n1. No git tag.\n2. No GitHub Release.\n3. No committing .relayos/overseer/ files.\n4. No force-push to main.\n5. No amending published commits.\n6. No skipping hooks (--no-verify).\n",
  "product_direction.md": "# Product Direction\n\n## Guiding principle\n\n(fill in)\n\n## Near-term\n\n| Feature | Status |\n|---|---|\n| (feature) | (status) |\n\n## Future (out of scope for OSS core)\n\n- (list)\n",
  "branches/active/brief.md": "# Active Branch\n\n(fill in: current task or branch name)\n",
  "branches/active/progress.md": "",
  "planned/enterprise_server.md": "# Planned: Enterprise Server\n\nRequires a server component. Out of scope for OSS core. No timeline set.\n",
  "planned/web_panel.md": "# Planned: Web Panel / Dashboard\n\nRequires a server component. Out of scope for OSS core. No timeline set.\n",
};

export async function initContextFiles(layout: OverseerLayout): Promise<string[]> {
  const created: string[] = [];
  for (const [relPath, stub] of Object.entries(STUB_CONTENTS)) {
    const fullPath = join(layout.dir, relPath);
    if (existsSync(fullPath)) continue;
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, stub, "utf8");
    created.push(relPath);
  }
  return created;
}
