import { pathToFileURL } from "node:url";
import {
  CheckpointResolutionError,
  type Checkpoint,
  createCheckpoint,
  listCheckpoints,
  resolveCheckpoint,
} from "./checkpoint.js";
import {
  buildLaunchCommand,
  LaunchResolutionError,
  resolveHandoff,
} from "./launch.js";
import { evaluatePolicy, formatBannerLines } from "./policy.js";
import type { Envelope } from "./schema.js";
import { ensureStorage, resolveStorageLayout } from "./storage.js";

interface CliIO {
  stdout: { write: (chunk: string) => unknown };
  stderr: { write: (chunk: string) => unknown };
}

function usage(): string {
  return "usage: relayos [launch|policy|checkpoint] [--force] [args...]\n";
}

function checkpointUsage(): string {
  return "usage: relayos checkpoint <create|list|show> [args...]\n";
}

function isLaunchResolutionError(err: unknown): err is LaunchResolutionError {
  return err instanceof LaunchResolutionError;
}

function isCheckpointResolutionError(
  err: unknown,
): err is CheckpointResolutionError {
  return err instanceof CheckpointResolutionError;
}

function parseLaunchArgs(rest: string[]): { force: boolean; selector?: string } | null {
  let force = false;
  const positional: string[] = [];
  for (const arg of rest) {
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg.startsWith("-")) return null;
    positional.push(arg);
  }
  if (positional.length > 1) return null;
  return { force, selector: positional[0] };
}

function describeHandoff(env: Envelope): string {
  return `HANDOFF: ${env.id}  target=${env.target_agent}  mode=${env.execution_mode}`;
}

async function runLaunch(args: string[], io: CliIO): Promise<number> {
  const parsed = parseLaunchArgs(args);
  if (!parsed) {
    io.stderr.write(usage());
    return 1;
  }

  let envelope: Envelope;
  try {
    envelope = await resolveHandoff(parsed.selector);
  } catch (err) {
    const message = isLaunchResolutionError(err)
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
    io.stderr.write(`relayos launch: ${message}\n`);
    return 1;
  }

  const decision = evaluatePolicy(envelope);
  const banner = formatBannerLines(decision);
  for (const line of banner) io.stderr.write(`${line}\n`);

  if (decision.decision === "block" && !parsed.force) {
    io.stderr.write("# (re-run with --force to print the command anyway)\n");
    return 2;
  }

  io.stdout.write(`${buildLaunchCommand(envelope)}\n`);
  return 0;
}

async function runPolicy(args: string[], io: CliIO): Promise<number> {
  if (args.length > 1) {
    io.stderr.write(usage());
    return 1;
  }
  let envelope: Envelope;
  try {
    envelope = await resolveHandoff(args[0]);
  } catch (err) {
    const message = isLaunchResolutionError(err)
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
    io.stderr.write(`relayos policy: ${message}\n`);
    return 1;
  }

  const decision = evaluatePolicy(envelope);
  io.stdout.write(`DECISION: ${decision.decision.toUpperCase()}\n`);
  for (const finding of decision.findings) {
    io.stdout.write(`- ${finding.code}: ${finding.message}\n`);
  }
  io.stdout.write(`${describeHandoff(envelope)}\n`);
  return 0;
}

function parseCheckpointCreateArgs(
  rest: string[],
): { message: string | null } | null {
  let message: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--message" || arg === "-m") {
      const value = rest[i + 1];
      if (value === undefined) return null;
      message = value;
      i++;
      continue;
    }
    return null;
  }
  return { message };
}

function shortHead(head: string | null): string {
  if (!head) return "-------";
  return head.slice(0, 7);
}

function quoteMessage(message: string | null): string {
  if (message === null || message.length === 0) return "";
  const escaped = message.replace(/"/g, '\\"');
  return ` "${escaped}"`;
}

function formatCheckpointCreated(c: Checkpoint): string {
  const lines: string[] = [];
  lines.push(`checkpoint ${c.id}`);
  lines.push(
    `  status:    ${c.files.status_path}   (${c.counts.status_lines} line${c.counts.status_lines === 1 ? "" : "s"})`,
  );
  const truncatedNote = c.counts.diff_truncated ? " [truncated]" : "";
  lines.push(
    `  diff:      ${c.files.diff_path}   (${c.counts.diff_bytes.toLocaleString()} bytes${truncatedNote})`,
  );
  lines.push(
    `  untracked: ${c.files.untracked_path}   (${c.counts.untracked_lines} line${c.counts.untracked_lines === 1 ? "" : "s"})`,
  );
  if (c.git.is_repo) {
    lines.push(
      `  HEAD:      ${shortHead(c.git.head)}   branch: ${c.git.branch ?? "-"}   dirty: ${c.git.dirty ? "yes" : "no"}`,
    );
  } else {
    lines.push(`  HEAD:      (not a git repo at ${c.cwd})`);
  }
  return `${lines.join("\n")}\n`;
}

function formatCheckpointRow(c: Checkpoint): string {
  if (c.git.is_repo) {
    const branch = c.git.branch ?? "-";
    const head = shortHead(c.git.head);
    const dirty = c.git.dirty ? "dirty" : "clean";
    return `${c.id}  ${c.created_at}  ${branch}@${head}  ${dirty}${quoteMessage(c.message)}`;
  }
  return `${c.id}  ${c.created_at}  (no git)${quoteMessage(c.message)}`;
}

function formatCheckpointShow(c: Checkpoint): string {
  const lines: string[] = [];
  lines.push(`id:         ${c.id}`);
  lines.push(`created_at: ${c.created_at}`);
  lines.push(`cwd:        ${c.cwd}`);
  lines.push(`is_repo:    ${c.git.is_repo}`);
  lines.push(`branch:     ${c.git.branch ?? "-"}`);
  lines.push(`head:       ${c.git.head ?? "-"}`);
  lines.push(`dirty:      ${c.git.dirty ? "yes" : "no"}`);
  lines.push(`message:    ${c.message ?? "-"}`);
  lines.push(`status:     ${c.files.status_path} (${c.counts.status_lines} lines)`);
  const truncatedNote = c.counts.diff_truncated ? " [truncated]" : "";
  lines.push(
    `diff:       ${c.files.diff_path} (${c.counts.diff_bytes.toLocaleString()} bytes${truncatedNote})`,
  );
  lines.push(
    `untracked:  ${c.files.untracked_path} (${c.counts.untracked_lines} lines)`,
  );
  lines.push("");
  lines.push(`# cat ${c.files.diff_path} | less   # to inspect the diff`);
  return `${lines.join("\n")}\n`;
}

async function runCheckpointCreate(
  rest: string[],
  io: CliIO,
): Promise<number> {
  const parsed = parseCheckpointCreateArgs(rest);
  if (!parsed) {
    io.stderr.write(
      "usage: relayos checkpoint create [--message <msg>]\n",
    );
    return 1;
  }
  const layout = resolveStorageLayout();
  await ensureStorage(layout);
  const checkpoint = await createCheckpoint(layout, {
    message: parsed.message,
  });
  io.stdout.write(formatCheckpointCreated(checkpoint));
  if (!checkpoint.git.is_repo) {
    io.stderr.write(
      `# note: ${checkpoint.cwd} is not inside a git working tree; status/diff/untracked files are empty\n`,
    );
  }
  return 0;
}

async function runCheckpointList(
  rest: string[],
  io: CliIO,
): Promise<number> {
  if (rest.length > 0) {
    io.stderr.write("usage: relayos checkpoint list\n");
    return 1;
  }
  const layout = resolveStorageLayout();
  await ensureStorage(layout);
  const items = await listCheckpoints(layout);
  if (items.length === 0) {
    io.stderr.write("relayos checkpoint: no checkpoints found\n");
    return 0;
  }
  for (const c of items) io.stdout.write(`${formatCheckpointRow(c)}\n`);
  return 0;
}

async function runCheckpointShow(
  rest: string[],
  io: CliIO,
): Promise<number> {
  if (rest.length > 1) {
    io.stderr.write(
      "usage: relayos checkpoint show <id|latest|N>\n",
    );
    return 1;
  }
  const layout = resolveStorageLayout();
  await ensureStorage(layout);
  try {
    const checkpoint = await resolveCheckpoint(layout, rest[0]);
    io.stdout.write(formatCheckpointShow(checkpoint));
    return 0;
  } catch (err) {
    const message = isCheckpointResolutionError(err)
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
    io.stderr.write(`relayos checkpoint: ${message}\n`);
    return 1;
  }
}

async function runCheckpoint(args: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "create") return runCheckpointCreate(rest, io);
  if (sub === "list") return runCheckpointList(rest, io);
  if (sub === "show") return runCheckpointShow(rest, io);
  io.stderr.write(checkpointUsage());
  return 1;
}

export async function runCli(
  argv = process.argv.slice(2),
  io: CliIO = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "--help" || command === "-h") {
    io.stdout.write(usage());
    return 0;
  }

  if (command === "launch") return runLaunch(rest, io);
  if (command === "policy") return runPolicy(rest, io);
  if (command === "checkpoint") return runCheckpoint(rest, io);

  io.stderr.write(usage());
  return 1;
}

const entrypoint = process.argv[1];
const isDirectInvocation =
  entrypoint !== undefined &&
  (import.meta.url === pathToFileURL(entrypoint).href ||
    entrypoint.endsWith("/dist/cli.js") ||
    entrypoint.endsWith("relayos"));

if (isDirectInvocation) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`[relayos] fatal: ${err?.stack ?? err}\n`);
      process.exitCode = 1;
    });
}
