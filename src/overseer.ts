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
