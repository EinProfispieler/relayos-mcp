import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
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
import { evaluateDiffRisk, formatDiffRisk, type DiffRiskDecision } from "./diff_risk.js";
import {
  gitBranch,
  gitDiff,
  gitHead,
  gitListUntracked,
  gitStatusShort,
  isGitRepo,
} from "./git.js";
import { listEnvelopes } from "./envelope.js";
import {
  appendBranchProgress,
  appendDecision,
  appendHandoffResult,
  appendNote,
  buildOverseerCapabilities,
  buildOverseerContextPack,
  buildOverseerDoctor,
  buildOverseerSummary,
  buildOverseerRunPreflight,
  type OverseerHandoffResultStatus,
  readHandoffResultsByRunId,
  readLatestHandoffResults,
  hasOverseerState,
  initContextFiles,
  readOverseerContextSnapshot,
  readOverseerHandshakeSnapshot,
  readActiveBrief,
  readBranchProgress,
  readLatestDecisions,
  readLatestNotes,
  readNextAction,
  readOverseerTextFile,
  resolveOverseerLayout,
  writeActiveBrief,
  writeNextAction,
} from "./overseer.js";
import { evaluatePolicy, formatBannerLines } from "./policy.js";
import type { Envelope } from "./schema.js";
import { ensureStorage, resolveStorageLayout } from "./storage.js";

interface CliIO {
  stdout: { write: (chunk: string) => unknown; isTTY?: boolean };
  stderr: { write: (chunk: string) => unknown };
}

function usage(): string {
  return "usage: relayos [banner|launch|policy|checkpoint|diff-risk|report|overseer] [--force] [args...]\n";
}

function checkpointUsage(): string {
  return "usage: relayos checkpoint <create|list|show|restore> [args...]\n";
}

const RELAYOS_LOGO_LINES = [
  "██████╗ ███████╗██╗      █████╗ ██╗   ██╗ ██████╗ ███████╗",
  "██╔══██╗██╔════╝██║     ██╔══██╗╚██╗ ██╔╝██╔═══██╗██╔════╝",
  "██████╔╝█████╗  ██║     ███████║ ╚████╔╝ ██║   ██║███████╗",
  "██╔══██╗██╔══╝  ██║     ██╔══██║  ╚██╔╝  ██║   ██║╚════██║",
  "██║  ██║███████╗███████╗██║  ██║   ██║   ╚██████╔╝███████║",
  "╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚══════╝",
] as const;

const RELAYOS_TAGLINE = "Local-first safety, audit, and handoff layer";

const RELAYOS_COMMANDS = [
  ["launch:", "relayos launch latest"],
  ["policy:", "relayos policy latest"],
  ["checkpoint:", "relayos checkpoint create"],
  ["diff-risk:", "relayos diff-risk"],
  ["report:", "relayos report"],
  ["overseer:", "relayos overseer brief"],
] as const;

function displayWidth(text: string): number {
  return Array.from(text).length;
}

function centerText(text: string, width: number): string {
  const padding = Math.max(0, Math.floor((width - displayWidth(text)) / 2));
  return `${" ".repeat(padding)}${text}`;
}

function colorize(enabled: boolean, code: string, text: string): string {
  return enabled ? `\u001B[${code}m${text}\u001B[0m` : text;
}

function shouldColorizeBanner(io: CliIO): boolean {
  return Boolean(io.stdout.isTTY) && !process.env.NO_COLOR && !process.env.CI;
}

function formatRelayOSBanner(io: CliIO): string {
  const color = shouldColorizeBanner(io);
  const logoWidth = RELAYOS_LOGO_LINES.reduce(
    (max, line) => Math.max(max, displayWidth(line)),
    0,
  );

  const lines: string[] = [];
  const logoCodes = ["94", "96", "94", "96", "94", "96"];
  for (let i = 0; i < RELAYOS_LOGO_LINES.length; i++) {
    lines.push(colorize(color, logoCodes[i]!, RELAYOS_LOGO_LINES[i]!));
  }
  lines.push("");
  lines.push(colorize(color, "1;97", centerText(RELAYOS_TAGLINE, logoWidth)));
  lines.push("");
  for (const [name, value] of RELAYOS_COMMANDS) {
    lines.push(`${colorize(color, "1;36", name.padEnd(11, " "))} ${value}`);
  }
  return lines.join("\n");
}

async function runBanner(args: string[], io: CliIO): Promise<number> {
  if (args.length > 0) {
    io.stderr.write("usage: relayos banner\n");
    return 1;
  }
  io.stdout.write(`${formatRelayOSBanner(io)}\n`);
  return 0;
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

function parseCheckpointRestoreArgs(
  rest: string[],
): { selector: string | undefined; dryRun: boolean } | null {
  let selector: string | undefined;
  let dryRun = false;
  for (const arg of rest) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (!selector && !arg.startsWith("--")) {
      selector = arg;
    } else {
      return null;
    }
  }
  return { selector, dryRun };
}

function formatCheckpointRestoreDryRun(c: Checkpoint): string {
  const sep = "─".repeat(44);
  const diffFileExists = existsSync(c.files.diff_path);
  const diffNote =
    c.counts.diff_bytes > 0
      ? `${c.counts.diff_bytes.toLocaleString()} bytes — patch available`
      : "0 bytes — no diff captured (tree was clean or not a git repo)";
  const diffTruncatedNote = c.counts.diff_truncated ? " [truncated]" : "";
  const untrackedNote =
    c.counts.untracked_lines > 0
      ? `${c.counts.untracked_lines} file(s) captured`
      : "none captured";

  const lines = [
    "CHECKPOINT RESTORE DRY-RUN",
    sep,
    `id:          ${c.id}`,
    `created_at:  ${c.created_at}`,
    `cwd:         ${c.cwd}`,
    `branch:      ${c.git.branch ?? "-"}`,
    `head:        ${c.git.head ?? "-"}`,
    `message:     ${c.message ?? "-"}`,
    "",
    "CAPTURED STATE",
    sep,
    `  status:    ${c.counts.status_lines} line(s)`,
    `  diff:      ${diffNote}${diffTruncatedNote}`,
    `  untracked: ${untrackedNote}`,
    `  diff file: ${diffFileExists ? c.files.diff_path : "(not found on disk)"}`,
    "",
    "WARNING: THIS IS A DRY-RUN — NO FILES HAVE BEEN MODIFIED",
    sep,
    "  --apply is not yet implemented; restore is plan-only.",
    "  To inspect the captured diff:",
    `    cat ${c.files.diff_path} | less`,
  ];
  return `${lines.join("\n")}\n`;
}

async function runCheckpointRestore(
  rest: string[],
  io: CliIO,
): Promise<number> {
  const parsed = parseCheckpointRestoreArgs(rest);
  if (!parsed) {
    io.stderr.write("usage: relayos checkpoint restore <id|latest|N> --dry-run\n");
    return 1;
  }
  if (!parsed.dryRun) {
    io.stderr.write(
      "relayos checkpoint restore: --dry-run is required; --apply is not yet implemented.\n" +
        "Run with --dry-run to preview the rollback plan without modifying any files.\n",
    );
    return 1;
  }
  const layout = resolveStorageLayout();
  await ensureStorage(layout);
  try {
    const checkpoint = await resolveCheckpoint(layout, parsed.selector);
    io.stdout.write(formatCheckpointRestoreDryRun(checkpoint));
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
  if (sub === "restore") return runCheckpointRestore(rest, io);
  io.stderr.write(checkpointUsage());
  return 1;
}

async function runDiffRisk(args: string[], io: CliIO): Promise<number> {
  if (args.length > 0) {
    io.stderr.write("usage: relayos diff-risk\n");
    return 1;
  }
  const cwd = process.cwd();
  const repo = await isGitRepo(cwd);
  if (!repo) {
    io.stderr.write(
      `# note: ${cwd} is not inside a git working tree; diff-risk is a no-op\n`,
    );
    const decision = evaluateDiffRisk({
      statusLines: [],
      diffText: "",
      untracked: [],
    });
    io.stdout.write(formatDiffRisk(decision));
    return 0;
  }
  const [statusRaw, diff, untracked] = await Promise.all([
    gitStatusShort(cwd),
    gitDiff(cwd),
    gitListUntracked(cwd),
  ]);
  const statusLines = statusRaw
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.length > 0);
  const decision = evaluateDiffRisk({
    statusLines,
    diffText: diff.text,
    untracked,
  });
  io.stdout.write(formatDiffRisk(decision));
  return 0;
}

function formatReportHandoff(envelope: import("./schema.js").Envelope | null, err: string | null): string {
  const lines: string[] = ["LATEST HANDOFF"];
  if (err) {
    lines.push(`  (${err})`);
  } else if (!envelope) {
    lines.push("  (no handoffs found)");
  } else {
    const title =
      envelope.task_title.length > 60
        ? `${envelope.task_title.slice(0, 57)}…`
        : envelope.task_title;
    lines.push(`  id:     ${envelope.id}`);
    lines.push(`  title:  ${title}`);
    lines.push(`  target: ${envelope.target_agent} (${envelope.execution_mode})   status: ${envelope.status}`);
  }
  return lines.join("\n");
}

function formatReportCheckpoint(checkpoint: Checkpoint | null): string {
  const lines: string[] = ["LATEST CHECKPOINT"];
  if (!checkpoint) {
    lines.push("  (no checkpoints found)");
  } else {
    const head = checkpoint.git.head ? checkpoint.git.head.slice(0, 7) : "-";
    const branch = checkpoint.git.branch ?? "(detached)";
    const dirty = checkpoint.git.dirty ? "yes" : "no";
    lines.push(`  id:     ${checkpoint.id}`);
    lines.push(
      `  branch: ${branch} @ ${head}   dirty: ${dirty}   diff: ${checkpoint.counts.diff_bytes.toLocaleString()} bytes`,
    );
    lines.push(`  taken:  ${checkpoint.created_at}`);
    if (checkpoint.message) lines.push(`  note:   ${checkpoint.message}`);
  }
  return lines.join("\n");
}

function formatReportDiffRisk(decision: DiffRiskDecision): string {
  const lines: string[] = ["DIFF-RISK"];
  lines.push(`  DECISION: ${decision.decision.toUpperCase()}`);
  for (const f of decision.findings) {
    lines.push(`  - ${f.code}: ${f.message}`);
  }
  lines.push(`  SUMMARY: ${decision.summary}`);
  return lines.join("\n");
}

function formatReportGit(git: {
  isRepo: boolean;
  branch: string | null;
  head: string | null;
  statusLines: string[];
}): string {
  const lines: string[] = ["GIT STATUS"];
  if (!git.isRepo) {
    lines.push("  (not inside a git working tree)");
  } else {
    const branch = git.branch ?? "(detached)";
    const head = git.head ? git.head.slice(0, 7) : "-";
    lines.push(`  branch: ${branch}   head: ${head}`);
    if (git.statusLines.length === 0) {
      lines.push("  (clean)");
    } else {
      for (const l of git.statusLines) {
        lines.push(`  ${l}`);
      }
    }
  }
  return lines.join("\n");
}

async function runReport(args: string[], io: CliIO): Promise<number> {
  if (args.length > 0) {
    io.stderr.write("usage: relayos report\n");
    return 1;
  }

  const cwd = process.cwd();
  const layout = resolveStorageLayout();

  const [envelopeResult, checkpointResult, isRepo] = await Promise.all([
    (async () => {
      try {
        const all = await listEnvelopes(layout);
        all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return { envelope: all[0] ?? null, error: null };
      } catch (err) {
        return {
          envelope: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })(),
    (async () => {
      try {
        const all = await listCheckpoints(layout);
        return all[0] ?? null;
      } catch {
        return null;
      }
    })(),
    isGitRepo(cwd),
  ]);

  let gitInfo: { isRepo: boolean; branch: string | null; head: string | null; statusLines: string[] };
  let diffRisk: DiffRiskDecision;

  if (isRepo) {
    const [branch, head, statusRaw, diff, untracked] = await Promise.all([
      gitBranch(cwd),
      gitHead(cwd),
      gitStatusShort(cwd),
      gitDiff(cwd),
      gitListUntracked(cwd),
    ]);
    const statusLines = statusRaw
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter((l) => l.length > 0);
    gitInfo = { isRepo: true, branch, head, statusLines };
    diffRisk = evaluateDiffRisk({ statusLines, diffText: diff.text, untracked });
  } else {
    gitInfo = { isRepo: false, branch: null, head: null, statusLines: [] };
    diffRisk = evaluateDiffRisk({ statusLines: [], diffText: "", untracked: [] });
  }

  const sep = "─".repeat(44);
  const sections = [
    `RELAYOS REPORT  ${new Date().toISOString()}`,
    sep,
    formatReportHandoff(envelopeResult.envelope, envelopeResult.error),
    "",
    formatReportCheckpoint(checkpointResult),
    "",
    formatReportDiffRisk(diffRisk),
    "",
    formatReportGit(gitInfo),
  ];
  io.stdout.write(`${sections.join("\n")}\n`);
  return 0;
}

const OVERSEER_SEP = "─".repeat(44);

function isPathInside(parentAbs: string, childAbs: string): boolean {
  const rel = relative(parentAbs, childAbs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function runGitCommand(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolveRun) => {
    execFile("git", args, { cwd, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolveRun({ ok: false, stdout: "" });
        return;
      }
      resolveRun({ ok: true, stdout });
    });
  });
}

async function appearsGitTrackedInSourceRepo(
  sourceRepoAbs: string,
  runtimePathAbs: string,
): Promise<boolean> {
  if (!(await isGitRepo(sourceRepoAbs))) return false;
  if (!isPathInside(sourceRepoAbs, runtimePathAbs)) return false;
  const relPath = relative(sourceRepoAbs, runtimePathAbs) || ".";
  const exact = await runGitCommand(sourceRepoAbs, [
    "ls-files",
    "--error-unmatch",
    "--",
    relPath,
  ]);
  if (exact.ok) return true;
  const subtree = await runGitCommand(sourceRepoAbs, ["ls-files", "--", relPath]);
  return subtree.ok && subtree.stdout.trim().length > 0;
}

interface OverseerActivateRuntimeArgs {
  dryRun: boolean;
  json: boolean;
  path: string;
  source: string;
}

function parseOverseerActivateRuntimeArgs(
  args: string[],
): OverseerActivateRuntimeArgs | null {
  let dryRun = false;
  let json = false;
  let path: string | null = null;
  let source: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--path") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return null;
      path = value;
      i++;
      continue;
    }
    if (arg === "--source") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return null;
      source = value;
      i++;
      continue;
    }
    return null;
  }

  if (!path) return null;
  return {
    dryRun,
    json,
    path,
    source: source ?? process.cwd(),
  };
}

async function runOverseerActivateRuntime(
  args: string[],
  io: CliIO,
): Promise<number> {
  const parsed = parseOverseerActivateRuntimeArgs(args);
  if (!parsed) {
    io.stderr.write(
      "usage: relayos overseer activate-runtime --dry-run --path <runtime-path> [--source <source-repo-path>] [--json]\n",
    );
    return 1;
  }
  if (!parsed.dryRun) {
    io.stderr.write(
      "relayos overseer activate-runtime: --dry-run is required; activation is not implemented.\n" +
        "Run with --dry-run to preview checks without modifying any files.\n",
    );
    return 1;
  }

  const cwd = process.cwd();
  const sourceRepo = resolve(parsed.source);
  const runtimePath = resolve(parsed.path);
  const runtimePathExists = existsSync(runtimePath);
  const runtimePathInsideSourceRepo = isPathInside(sourceRepo, runtimePath);
  const runtimePathGitTracked = await appearsGitTrackedInSourceRepo(sourceRepo, runtimePath);
  const sourceOverseerStateExists = existsSync(join(sourceRepo, ".relayos", "overseer"));
  const relayosRuntimeHomeRaw = process.env.RELAYOS_RUNTIME_HOME;
  const relayosRuntimeHomeSet = relayosRuntimeHomeRaw !== undefined;
  const relayosRuntimeHome = relayosRuntimeHomeSet ? relayosRuntimeHomeRaw : null;
  const relayosRuntimeHomeMatchesPath =
    relayosRuntimeHomeSet && resolve(relayosRuntimeHomeRaw!) === runtimePath;

  const warnings: string[] = [];
  const blocks: string[] = [];

  if (runtimePathInsideSourceRepo) {
    blocks.push("Proposed runtime workspace path is inside the source repo.");
  }
  if (runtimePathGitTracked) {
    blocks.push("Proposed runtime workspace path appears git-tracked.");
  }
  if (!runtimePathExists) {
    warnings.push("Proposed runtime workspace path does not exist.");
  }
  if (relayosRuntimeHomeSet && !relayosRuntimeHomeMatchesPath) {
    warnings.push("RELAYOS_RUNTIME_HOME is set and does not match --path.");
  }

  const decision = blocks.length > 0 ? "block" : warnings.length > 0 ? "warn" : "allow";
  const notes = [
    "Dry-run only: no files were written, moved, or deleted.",
    "Runtime workspace switching is not active.",
    "Current `.relayos/` resolution behavior is unchanged.",
  ];

  if (parsed.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          decision,
          sourceRepo,
          runtimePath,
          runtimePathExists,
          runtimePathInsideSourceRepo,
          runtimePathGitTracked,
          sourceOverseerStateExists,
          relayosRuntimeHomeSet,
          relayosRuntimeHome,
          relayosRuntimeHomeMatchesPath,
          runtimeWorkspaceSwitchingActive: false,
          wroteFiles: false,
          createdDirectories: false,
          warnings,
          blocks,
          notes,
        },
        null,
        2,
      )}\n`,
    );
    return decision === "block" ? 2 : 0;
  }

  const lines = [
    "OVERSEER RUNTIME ACTIVATION DRY-RUN",
    OVERSEER_SEP,
    `cwd: ${cwd}`,
    `source repo: ${sourceRepo}`,
    `proposed runtime path: ${runtimePath}`,
    relayosRuntimeHomeSet
      ? `RELAYOS_RUNTIME_HOME: set (${relayosRuntimeHome})`
      : "RELAYOS_RUNTIME_HOME: not set",
    "",
    "CHECKS",
    OVERSEER_SEP,
    `  runtime path exists: ${runtimePathExists ? "yes" : "no"}`,
    `  runtime path inside source repo: ${runtimePathInsideSourceRepo ? "yes" : "no"}`,
    `  runtime path appears git-tracked: ${runtimePathGitTracked ? "yes" : "no"}`,
    `  source .relayos/overseer exists: ${sourceOverseerStateExists ? "yes" : "no"}`,
    `  RELAYOS_RUNTIME_HOME matches --path: ${relayosRuntimeHomeSet ? (relayosRuntimeHomeMatchesPath ? "yes" : "no") : "n/a (RELAYOS_RUNTIME_HOME not set)"}`,
    "",
    "WARNINGS",
    OVERSEER_SEP,
    ...(warnings.length > 0 ? warnings.map((w) => `  - ${w}`) : ["  (none)"]),
    "",
    "BLOCKS",
    OVERSEER_SEP,
    ...(blocks.length > 0 ? blocks.map((b) => `  - ${b}`) : ["  (none)"]),
    "",
    "FINAL DECISION",
    OVERSEER_SEP,
    `  decision: ${decision.toUpperCase()}`,
    "  no files were written; runtime switching is not active.",
  ];
  io.stdout.write(`${lines.join("\n")}\n`);
  return decision === "block" ? 2 : 0;
}

async function runOverseerStatus(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer status\n");
    return 1;
  }

  const layout = resolveOverseerLayout(process.cwd());

  if (wantsJson) {
    const cwd = process.cwd();
    const [
      project,
      currentState,
      nextAction,
      activeBranch,
      branchProgress,
      recentNotes,
      latestCommit,
    ] = await Promise.all([
      readOverseerTextFile(layout, "project_brief.md"),
      readOverseerTextFile(layout, "current.md"),
      readNextAction(layout),
      readActiveBrief(layout),
      readBranchProgress(layout),
      readLatestNotes(layout, 5),
      isGitRepo(cwd).then(async (isRepo) => {
        if (!isRepo) return null;
        const [head, branch] = await Promise.all([gitHead(cwd), gitBranch(cwd)]);
        return head ? `${head.slice(0, 7)} @ ${branch ?? "(detached)"}` : null;
      }),
    ]);

    const branchProgressEntries =
      branchProgress === null
        ? []
        : branchProgress
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
    const notes = recentNotes.map((n) => `[${n.ts}] ${n.text}`);

    io.stdout.write(
      `${JSON.stringify(
        {
          project,
          currentState,
          nextAction,
          activeBranch,
          branchProgress: branchProgressEntries,
          latestCommit,
          notes,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines: string[] = ["OVERSEER STATUS", OVERSEER_SEP];

  if (!hasOverseerState(layout)) {
    lines.push(
      "(no overseer state — use `relayos overseer note` or `relayos overseer next` to begin)",
    );
    io.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  const [nextAction, notes] = await Promise.all([
    readNextAction(layout),
    readLatestNotes(layout, 5),
  ]);

  lines.push("NEXT ACTION");
  if (nextAction) {
    lines.push(`  ${nextAction}`);
  } else {
    lines.push("  (none — use `relayos overseer next <text>` to set one)");
  }

  lines.push("");
  lines.push("RECENT NOTES");
  if (notes.length === 0) {
    lines.push("  (none — use `relayos overseer note <text>` to add one)");
  } else {
    for (const n of notes) {
      lines.push(`  [${n.ts}] ${n.text}`);
    }
  }

  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerContext(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer context\n");
    return 1;
  }

  const context = await readOverseerContextSnapshot(process.cwd());

  if (wantsJson) {
    io.stdout.write(
      `${JSON.stringify(
        {
          ...context,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines = [
    "OVERSEER CONTEXT",
    OVERSEER_SEP,
    `  workspace: ${context.workspace_path}`,
    `  status: ${context.ok ? "complete" : "incomplete"}`,
    `  gitignored: ${context.gitignored === null ? "unknown (not a git repo)" : context.gitignored ? "yes" : "no"}`,
    "",
    "CANONICAL FILES",
    OVERSEER_SEP,
    ...context.files.map((f) => `  ${f.exists ? "[x]" : "[ ]"} ${f.name}`),
  ];
  if (context.missing.length > 0) {
    lines.push("", "MISSING", OVERSEER_SEP, ...context.missing.map((m) => `  - ${m}`));
  }
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerHandshake(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer handshake\n");
    return 1;
  }

  const handshake = await readOverseerHandshakeSnapshot(process.cwd());

  if (wantsJson) {
    io.stdout.write(`${JSON.stringify(handshake, null, 2)}\n`);
    return 0;
  }

  const lines = [
    "OVERSEER HANDSHAKE",
    OVERSEER_SEP,
    `  protocol: ${handshake.protocol}`,
    `  session_role: ${handshake.session_role}`,
    `  repo path: ${handshake.repo_path}`,
    `  workspace path: ${handshake.workspace_path}`,
    `  context status: ${handshake.context_complete ? "complete" : "incomplete"}`,
    "  must-read files:",
    ...handshake.must_read.map((p) => `    - ${p}`),
    `  next action source: ${handshake.next_action_source}`,
    "  forbidden actions:",
    ...handshake.forbidden_actions.map((a) => `    - ${a}`),
    "  requires explicit user approval for:",
    ...handshake.requires_explicit_user_approval_for.map((a) => `    - ${a}`),
    "  notes:",
    ...handshake.notes.map((n) => `    - ${n}`),
  ];
  if (handshake.missing.length > 0) {
    lines.push("  missing:", ...handshake.missing.map((m) => `    - ${m}`));
  }
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

function firstContentLine(text: string | null): string | null {
  if (!text) return null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return line;
  }
  return null;
}

async function runOverseerRecent(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer recent\n");
    return 1;
  }

  const cwd = process.cwd();
  const layout = resolveOverseerLayout(cwd);
  const [projectBrief, currentState, nextAction, activeBranch, isRepo] = await Promise.all([
    readOverseerTextFile(layout, "project_brief.md"),
    readOverseerTextFile(layout, "current.md"),
    readNextAction(layout),
    readActiveBrief(layout),
    isGitRepo(cwd),
  ]);
  const [head, branch] = isRepo ? await Promise.all([gitHead(cwd), gitBranch(cwd)]) : [null, null];
  const commitInfo = head ? `${head.slice(0, 7)} @ ${branch ?? "(detached)"}` : null;
  const currentAnchorMatch = currentState?.match(/`([0-9a-f]{7,40})`/i) ?? null;
  const currentAnchor = currentAnchorMatch?.[1] ?? null;
  const runtimeHome = process.env.RELAYOS_RUNTIME_HOME;
  const runtimeHomeSet = runtimeHome !== undefined;
  const project = firstContentLine(projectBrief);
  const stateAnchor = currentAnchor ?? commitInfo ?? null;
  const warnings: string[] = [];
  if (!projectBrief) warnings.push("project brief not available");
  if (!currentState) warnings.push("current state not available");
  if (!activeBranch) warnings.push("active branch/task not available");
  if (!nextAction) warnings.push("next action not available");

  if (wantsJson) {
    io.stdout.write(
      `${JSON.stringify(
        {
          project,
          currentState: {
            anchor: stateAnchor,
            raw: currentState,
          },
          activeBranch,
          nextAction,
          mode: {
            current: "serial",
            default: "serial",
            writeTasks: "serial",
          },
          runtime: {
            relayosRuntimeHomeSet: runtimeHomeSet,
            relayosRuntimeHome: runtimeHomeSet ? runtimeHome : null,
            runtimeWorkspaceSwitchingActive: false,
            currentRelayosResolution: "cwd",
            posture: runtimeHomeSet
              ? "switching inactive; RELAYOS_RUNTIME_HOME set and inspect-only"
              : "switching inactive; RELAYOS_RUNTIME_HOME not set (inspect-only)",
          },
          warnings,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines = [
    "OVERSEER RECENT",
    OVERSEER_SEP,
    `project: ${project ?? "not available"}`,
    `state anchor: ${stateAnchor ?? "not available"}`,
    `active branch/task: ${activeBranch ?? "not available"}`,
    `next action: ${nextAction ?? "not available"}`,
    "mode: serial (default)",
    runtimeHome
      ? `runtime posture: switching inactive; RELAYOS_RUNTIME_HOME set (${runtimeHome}) and inspect-only`
      : "runtime posture: switching inactive; RELAYOS_RUNTIME_HOME not set (inspect-only)",
  ];
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

function parseOverseerContextPackArgs(
  args: string[],
): { wantsJson: boolean; limit: number } | null {
  let wantsJson = false;
  let limit = 8;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") {
      wantsJson = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = args[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return null;
      limit = parsed;
      i++;
      continue;
    }
    return null;
  }
  return { wantsJson, limit };
}

async function runOverseerContextPack(args: string[], io: CliIO): Promise<number> {
  const parsed = parseOverseerContextPackArgs(args);
  if (!parsed) {
    io.stderr.write("usage: relayos overseer context-pack [--json] [--limit <1-20>]\n");
    return 1;
  }

  const pack = await buildOverseerContextPack(process.cwd(), parsed.limit);

  if (parsed.wantsJson) {
    io.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
    return 0;
  }

  const lines = [
    "OVERSEER CONTEXT PACK",
    OVERSEER_SEP,
    `  protocol: ${pack.protocol}`,
    `  context status: ${pack.context_complete ? "complete" : "incomplete"}`,
    `  workspace: ${pack.workspace_path}`,
    `  project summary: ${pack.project_summary ?? "not available"}`,
    `  current state: ${pack.current_state ?? "not available"}`,
    `  next action: ${pack.next_action ?? "not available"}`,
    `  model policy: ${pack.model_policy ?? "not available"}`,
    `  recent notes (${pack.notes_count}/${pack.limit}):`,
    ...(pack.recent_notes.length > 0
      ? pack.recent_notes.map((n) => `    - [${n.ts}] ${n.text}`)
      : ["    - (none)"]),
    `  recent decisions (${pack.decisions_count}/${pack.limit}):`,
    ...(pack.recent_decisions.length > 0
      ? pack.recent_decisions.map((d) => `    - [${d.ts}] ${d.text}`)
      : ["    - (none)"]),
    `  recent handoff results (${pack.handoff_results_count}/${pack.limit}):`,
    ...(pack.recent_handoff_results.length > 0
      ? pack.recent_handoff_results.map((r) => `    - [${r.ts}] ${r.run_id} ${r.status}: ${r.summary}`)
      : ["    - (none)"]),
    "  forbidden actions:",
    ...pack.forbidden_actions.map((a) => `    - ${a}`),
    "  recommended prompt:",
    `    ${pack.recommended_prompt}`,
    "  evidence links:",
    ...pack.evidence_links.map((p) => `    - ${p}`),
  ];
  if (pack.missing.length > 0) {
    lines.push("  missing:", ...pack.missing.map((m) => `    - ${m}`));
  }
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerRunPreflight(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer run-preflight [--json]\n");
    return 1;
  }

  const preflight = await buildOverseerRunPreflight(process.cwd());

  if (wantsJson) {
    io.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
    return 0;
  }

  const lines = [
    "OVERSEER RUN PREFLIGHT",
    OVERSEER_SEP,
    `  workspace: ${preflight.workspace_path}`,
    `  context status: ${preflight.context_complete ? "complete" : "incomplete"}`,
    `  has next action: ${preflight.checks[1]?.status === "pass" ? "yes" : "no"}`,
    `  has current state: ${preflight.checks[2]?.status === "pass" ? "yes" : "no"}`,
    `  has model policy: ${preflight.checks[3]?.status === "pass" ? "yes" : "no"}`,
    `  has forbidden actions: ${preflight.checks[4]?.status === "pass" ? "yes" : "no"}`,
    `  recent notes count: ${preflight.recent_notes_count}`,
    `  runtime active: ${preflight.runtime_active ? "yes" : "no"}`,
    `  runner active: ${preflight.runner_active ? "yes" : "no"}`,
    `  queue active: ${preflight.queue_active ? "yes" : "no"}`,
    `  ready for future run: ${preflight.ready_for_future_run ? "yes" : "no"}`,
    "  notes:",
    ...preflight.notes.map((n) => `    - ${n}`),
  ];
  if (preflight.missing.length > 0) {
    lines.push("  missing:", ...preflight.missing.map((m) => `    - ${m}`));
  }
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerCapabilities(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer capabilities [--json]\n");
    return 1;
  }

  const capabilities = await buildOverseerCapabilities(process.cwd());

  if (wantsJson) {
    io.stdout.write(`${JSON.stringify(capabilities, null, 2)}\n`);
    return 0;
  }

  const lines = [
    "OVERSEER CAPABILITIES",
    OVERSEER_SEP,
    `  workspace: ${capabilities.workspace_path}`,
    `  policy version: ${capabilities.capability_policy_version}`,
    "  allowed by default:",
    ...capabilities.allowed_by_default.map((item) => `    - ${item}`),
    "  requires explicit approval:",
    ...capabilities.requires_explicit_approval.map((item) => `    - ${item}`),
    "  forbidden:",
    ...capabilities.forbidden.map((item) => `    - ${item}`),
    "  detected surfaces:",
    ...capabilities.detected_surfaces.map((item) => `    - ${item}`),
    "  notes:",
    ...capabilities.notes.map((item) => `    - ${item}`),
  ];
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerSummary(args: string[], io: CliIO): Promise<number> {
  const parsed = parseOverseerContextPackArgs(args);
  if (!parsed) {
    io.stderr.write("usage: relayos overseer summary [--json] [--limit <1-20>]\n");
    return 1;
  }

  const summary = await buildOverseerSummary(process.cwd(), parsed.limit);

  if (parsed.wantsJson) {
    io.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }

  const lines = [
    "OVERSEER SESSION SUMMARY",
    OVERSEER_SEP,
    "  Context:",
    `    - protocol: ${summary.protocol}`,
    `    - context status: ${summary.context_complete ? "complete" : "incomplete"}`,
    `    - workspace: ${summary.workspace_path}`,
    "  Current state:",
    `    - project summary: ${summary.project_summary ?? "not available"}`,
    `    - current state: ${summary.current_state ?? "not available"}`,
    "  Next action:",
    `    - ${summary.next_action ?? "not available"}`,
    `  Recent decisions (${summary.decisions_count}/${summary.limit}):`,
    ...(summary.recent_decisions.length > 0
      ? summary.recent_decisions.map((d) => `    - [${d.ts}] ${d.text}`)
      : ["    - (none)"]),
    `  Recent handoff results (${summary.handoff_results_count}/${summary.limit}):`,
    ...(summary.recent_handoff_results.length > 0
      ? summary.recent_handoff_results.map((r) => `    - [${r.ts}] ${r.run_id} ${r.status}: ${r.summary}`)
      : ["    - (none)"]),
    `  Recent notes (${summary.notes_count}/${summary.limit}):`,
    ...(summary.recent_notes.length > 0
      ? summary.recent_notes.map((n) => `    - [${n.ts}] ${n.text}`)
      : ["    - (none)"]),
    "  Run preflight:",
    `    - ready for future run: ${summary.run_preflight.ready_for_future_run ? "yes" : "no"}`,
    `    - context status: ${summary.run_preflight.context_complete ? "complete" : "incomplete"}`,
    "  Recommended next safe action:",
    `    - ${summary.recommended_next_action_prompt}`,
    "  Notes:",
    ...summary.notes.map((n) => `    - ${n}`),
  ];
  if (summary.missing.length > 0) {
    lines.push("  Missing:", ...summary.missing.map((m) => `    - ${m}`));
  }
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerDoctor(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer doctor [--json]\n");
    return 1;
  }

  const cwd = process.cwd();
  const result = await buildOverseerDoctor(cwd);

  if (wantsJson) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  const lines = [
    "OVERSEER DOCTOR",
    OVERSEER_SEP,
    `  version: ${result.version}`,
    `  cwd: ${cwd}`,
    `  workspace: ${result.workspace_path}`,
    `  context: ${result.context_complete ? "complete" : "incomplete"}`,
    `  recent notes: ${result.recent_notes_count}`,
    `  recent decisions: ${result.recent_decisions_count}`,
    `  handoff results evidence: ${result.handoff_results_available ? "available" : "not available"} (${result.recent_handoff_results_count})`,
    `  run preflight ready: ${result.run_preflight_ready ? "yes" : "no"}`,
    `  tracked .relayos/overseer files: ${result.tracked_local_state_files.length}`,
    `  stale build possible: ${result.stale_build_possible ? "yes" : "no"}`,
    "",
    "CHECKS",
    OVERSEER_SEP,
    ...result.checks.map((check) => `  [${check.status}] ${check.name}: ${check.detail}`),
  ];
  if (result.missing.length > 0) {
    lines.push("", "MISSING", OVERSEER_SEP, ...result.missing.map((m) => `  - ${m}`));
  }
  if (result.tracked_local_state_files.length > 0) {
    lines.push(
      "",
      "TRACKED LOCAL STATE FILES",
      OVERSEER_SEP,
      ...result.tracked_local_state_files.map((path) => `  - ${path}`),
    );
  }
  lines.push("", `NEXT ACTION: ${result.recommended_next_action}`);
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerNote(args: string[], io: CliIO): Promise<number> {
  if (args.length === 0) {
    io.stderr.write("usage: relayos overseer note <text>\n");
    return 1;
  }
  const text = args.join(" ");
  const layout = resolveOverseerLayout(process.cwd());
  await appendNote(layout, text);
  io.stdout.write(`note recorded: ${text}\n`);
  return 0;
}

function parseOverseerDecisionsArgs(
  args: string[],
): { wantsJson: boolean; limit: number } | null {
  let wantsJson = false;
  let limit = 8;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") {
      wantsJson = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = args[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return null;
      limit = parsed;
      i++;
      continue;
    }
    return null;
  }
  return { wantsJson, limit };
}

async function runOverseerDecision(args: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "add") {
    if (rest.length === 0) {
      io.stderr.write("usage: relayos overseer decision add <text>\n");
      return 1;
    }
    const text = rest.join(" ");
    const layout = resolveOverseerLayout(process.cwd());
    await appendDecision(layout, text);
    io.stdout.write(`decision recorded: ${text}\n`);
    return 0;
  }
  io.stderr.write("usage: relayos overseer decision add <text>\n");
  return 1;
}

const HANDOFF_RESULT_STATUSES: OverseerHandoffResultStatus[] = [
  "completed",
  "failed",
  "blocked",
  "needs_review",
];

interface OverseerHandoffResultAddArgs {
  runId: string;
  status: OverseerHandoffResultStatus;
  summary: string;
  testsRun: string[];
  testResult: string | null;
  blockers: string[];
  needsReview: boolean;
  requiresUserApproval: boolean;
}

function parseOverseerHandoffResultAddArgs(
  args: string[],
): OverseerHandoffResultAddArgs | null {
  let runId: string | null = null;
  let status: OverseerHandoffResultStatus | null = null;
  let summary: string | null = null;
  const testsRun: string[] = [];
  let testResult: string | null = null;
  const blockers: string[] = [];
  let needsReview = false;
  let requiresUserApproval = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--run-id") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return null;
      runId = value;
      i++;
      continue;
    }
    if (arg === "--status") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return null;
      if (!HANDOFF_RESULT_STATUSES.includes(value as OverseerHandoffResultStatus)) return null;
      status = value as OverseerHandoffResultStatus;
      i++;
      continue;
    }
    if (arg === "--summary") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return null;
      summary = value;
      i++;
      continue;
    }
    if (arg === "--tests-run") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return null;
      testsRun.push(value);
      i++;
      continue;
    }
    if (arg === "--test-result") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return null;
      testResult = value;
      i++;
      continue;
    }
    if (arg === "--blocker") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return null;
      blockers.push(value);
      i++;
      continue;
    }
    if (arg === "--needs-review") {
      needsReview = true;
      continue;
    }
    if (arg === "--requires-user-approval") {
      requiresUserApproval = true;
      continue;
    }
    return null;
  }

  if (!runId || runId.trim().length === 0) return null;
  if (!status) return null;
  if (!summary || summary.trim().length === 0) return null;
  return {
    runId: runId.trim(),
    status,
    summary: summary.trim(),
    testsRun,
    testResult: testResult ? testResult.trim() : null,
    blockers,
    needsReview,
    requiresUserApproval,
  };
}

function parseOverseerHandoffResultsArgs(
  args: string[],
): { wantsJson: boolean; limit: number } | null {
  let wantsJson = false;
  let limit = 8;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") {
      wantsJson = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = args[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return null;
      limit = parsed;
      i++;
      continue;
    }
    return null;
  }
  return { wantsJson, limit };
}

function parseOverseerHandoffResultShowArgs(
  args: string[],
): { wantsJson: boolean; runId: string } | null {
  let wantsJson = false;
  let runId: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") {
      wantsJson = true;
      continue;
    }
    if (arg === "--run-id") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return null;
      runId = value;
      i++;
      continue;
    }
    return null;
  }
  if (!runId || runId.trim().length === 0) return null;
  return { wantsJson, runId: runId.trim() };
}

async function runOverseerHandoffResult(args: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "add") {
    const parsed = parseOverseerHandoffResultAddArgs(rest);
    if (!parsed) {
      io.stderr.write(
        "usage: relayos overseer handoff-result add --run-id <id> --status <completed|failed|blocked|needs_review> --summary <text> [--tests-run <text> ...] [--test-result <text>] [--blocker <text> ...] [--needs-review] [--requires-user-approval]\n",
      );
      return 1;
    }
    const layout = resolveOverseerLayout(process.cwd());
    await appendHandoffResult(layout, {
      run_id: parsed.runId,
      status: parsed.status,
      summary: parsed.summary,
      tests_run: parsed.testsRun.length > 0 ? parsed.testsRun : undefined,
      test_result: parsed.testResult ?? undefined,
      blockers: parsed.blockers.length > 0 ? parsed.blockers : undefined,
      needs_review: parsed.needsReview ? true : undefined,
      requires_user_approval: parsed.requiresUserApproval ? true : undefined,
    });
    io.stdout.write(`handoff result recorded: run_id=${parsed.runId} status=${parsed.status}\n`);
    return 0;
  }
  if (sub === "show") {
    const parsed = parseOverseerHandoffResultShowArgs(rest);
    if (!parsed) {
      io.stderr.write("usage: relayos overseer handoff-result show --run-id <id> [--json]\n");
      return 1;
    }
    const layout = resolveOverseerLayout(process.cwd());
    const results = await readHandoffResultsByRunId(layout, parsed.runId);
    if (parsed.wantsJson) {
      io.stdout.write(
        `${JSON.stringify(
          {
            tool: "overseer_handoff_result",
            workspace_path: layout.dir,
            run_id: parsed.runId,
            results_count: results.length,
            results,
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }
    const lines = [
      "OVERSEER HANDOFF RESULT",
      OVERSEER_SEP,
      `  workspace: ${layout.dir}`,
      `  run_id: ${parsed.runId}`,
      `  results (${results.length}):`,
      ...(results.length > 0
        ? results.map((r) => `    - [${r.ts}] ${r.status}: ${r.summary}`)
        : ["    - (none)"]),
    ];
    io.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }
  io.stderr.write(
    "usage: relayos overseer handoff-result <add|show> [args...]\n",
  );
  return 1;
}

async function runOverseerHandoffResults(args: string[], io: CliIO): Promise<number> {
  const parsed = parseOverseerHandoffResultsArgs(args);
  if (!parsed) {
    io.stderr.write("usage: relayos overseer handoff-results [--json] [--limit <1-20>]\n");
    return 1;
  }
  const layout = resolveOverseerLayout(process.cwd());
  const results = await readLatestHandoffResults(layout, parsed.limit);

  if (parsed.wantsJson) {
    io.stdout.write(
      `${JSON.stringify(
        {
          tool: "overseer_handoff_results",
          workspace_path: layout.dir,
          results_count: results.length,
          limit: parsed.limit,
          results,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines = [
    "OVERSEER HANDOFF RESULTS",
    OVERSEER_SEP,
    `  workspace: ${layout.dir}`,
    `  results (${results.length}/${parsed.limit}):`,
    ...(results.length > 0
      ? results.map((r) => `    - [${r.ts}] ${r.run_id} ${r.status}: ${r.summary}`)
      : ["    - (none)"]),
  ];
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerDecisions(args: string[], io: CliIO): Promise<number> {
  const parsed = parseOverseerDecisionsArgs(args);
  if (!parsed) {
    io.stderr.write("usage: relayos overseer decisions [--json] [--limit <1-20>]\n");
    return 1;
  }
  const layout = resolveOverseerLayout(process.cwd());
  const decisions = await readLatestDecisions(layout, parsed.limit);

  if (parsed.wantsJson) {
    io.stdout.write(
      `${JSON.stringify(
        {
          tool: "overseer_decisions",
          workspace_path: layout.dir,
          decisions_count: decisions.length,
          limit: parsed.limit,
          decisions,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines = [
    "OVERSEER DECISIONS",
    OVERSEER_SEP,
    `  workspace: ${layout.dir}`,
    `  decisions (${decisions.length}/${parsed.limit}):`,
    ...(decisions.length > 0
      ? decisions.map((d) => `    - [${d.ts}] ${d.text}`)
      : ["    - (none)"]),
  ];
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerNext(args: string[], io: CliIO): Promise<number> {
  const layout = resolveOverseerLayout(process.cwd());
  if (args.length === 0) {
    const current = await readNextAction(layout);
    if (current) {
      io.stdout.write(`${current}\n`);
    } else {
      io.stdout.write("(no next action set — use `relayos overseer next <text>` to set one)\n");
    }
    return 0;
  }
  const text = args.join(" ");
  await writeNextAction(layout, text);
  io.stdout.write(`next action set: ${text}\n`);
  return 0;
}

async function runOverseerBrief(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer brief\n");
    return 1;
  }
  const cwd = process.cwd();
  const layout = resolveOverseerLayout(cwd);
  const MISSING = "(missing — file not found in .relayos/overseer/)";
  const sep = OVERSEER_SEP;

  const [
    projectBrief,
    currentState,
    releasePolicy,
    forbiddenActions,
    productDirection,
    nextAction,
    activeBranch,
    branchProgress,
    commitInfo,
  ] = await Promise.all([
    readOverseerTextFile(layout, "project_brief.md"),
    readOverseerTextFile(layout, "current.md"),
    readOverseerTextFile(layout, "release_policy.md"),
    readOverseerTextFile(layout, "forbidden_actions.md"),
    readOverseerTextFile(layout, "product_direction.md"),
    readNextAction(layout),
    readActiveBrief(layout),
    readBranchProgress(layout),
    isGitRepo(cwd).then(async (isRepo) => {
      if (!isRepo) return null;
      const [head, branch] = await Promise.all([gitHead(cwd), gitBranch(cwd)]);
      return head ? `${head.slice(0, 7)} @ ${branch ?? "(detached)"}` : null;
    }),
  ]);

  if (wantsJson) {
    const branchProgressEntries =
      branchProgress === null
        ? []
        : branchProgress
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
    io.stdout.write(
      `${JSON.stringify(
        {
          project: projectBrief,
          currentState,
          releasePolicy,
          forbiddenActions,
          productDirection,
          nextAction,
          activeBranch,
          branchProgress: branchProgressEntries,
          latestCommit: commitInfo,
          notes: [
            "Missing sections are returned as null or empty arrays.",
            "Current brief data resolves from local `.relayos/` state relative to the current working directory.",
            "No runtime workspace switching is active in this release.",
          ],
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  function section(title: string, content: string | null): string {
    return [title, sep, content ?? MISSING].join("\n");
  }

  const parts = [
    `RELAYOS OVERSEER BRIEF  ${new Date().toISOString()}`,
    sep,
    "",
    section("PROJECT", projectBrief),
    "",
    section("CURRENT STATE", currentState),
    "",
    section("RELEASE POLICY", releasePolicy),
    "",
    section("FORBIDDEN ACTIONS", forbiddenActions),
    "",
    section("PRODUCT DIRECTION", productDirection),
    "",
    "NEXT ACTION",
    sep,
    nextAction ? `  ${nextAction}` : "  (not set)",
  ];

  if (activeBranch !== null) {
    parts.push(
      "",
      "ACTIVE BRANCH",
      sep,
      `  ${activeBranch}`,
    );
    if (branchProgress !== null) {
      parts.push(
        "",
        "BRANCH PROGRESS",
        sep,
        ...branchProgress.split("\n").map((l) => `  ${l}`),
      );
    }
  }

  parts.push(
    "",
    "LATEST COMMIT",
    sep,
    commitInfo ? `  ${commitInfo}` : "  (not available — not inside a git repo)",
    "",
    "LOCAL DATA SAFETY",
    sep,
    "  Do not commit .relayos/overseer/ files, checkpoints, audit logs,",
    "  handoff envelopes, transcripts, or private scratch to git.",
    "  Handoff storage defaults to ~/.claude/handoff/ (outside repo).",
    "  .relayos/overseer/ is gitignored in the project repo.",
  );

  io.stdout.write(`${parts.join("\n")}\n`);
  return 0;
}

async function runOverseerStart(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer start\n");
    return 1;
  }

  const notes = [
    "Serial mode is the current/default mode.",
    "Parallel mode is future/opt-in and is not automatically enabled.",
    "Overseer start does not launch Codex/Claude sub-runs.",
    "Runtime workspace switching is not active yet.",
  ];

  if (wantsJson) {
    io.stdout.write(
      `${JSON.stringify(
        {
          startupMode: "overseer",
          currentMode: "serial",
          defaultMode: "serial",
          parallelModeAvailable: false,
          parallelModeEnabled: false,
          runtimeWorkspaceSwitchingActive: false,
          startsSubruns: false,
          createsBranchesOrWorktrees: false,
          writesRuntimeState: false,
          notes,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  io.stdout.write(`${formatRelayOSBanner(io)}\n\n`);
  io.stdout.write("OVERSEER STARTUP MODE\n");
  io.stdout.write(`${OVERSEER_SEP}\n`);
  io.stdout.write("  Serial mode is the default in this release.\n");
  io.stdout.write("  Write tasks are processed one at a time.\n");
  io.stdout.write("  Parallel mode is future/opt-in and is not automatically enabled.\n\n");
  return runOverseerBrief([], io);
}

async function runOverseerMode(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer mode\n");
    return 1;
  }

  const notes = [
    "Serial mode is the current/default mode.",
    "Write tasks are processed one at a time.",
    "Parallel mode is future/opt-in and is not automatically enabled.",
  ];

  if (wantsJson) {
    io.stdout.write(
      `${JSON.stringify(
        {
          currentMode: "serial",
          defaultMode: "serial",
          parallelModeAvailable: false,
          parallelModeEnabled: false,
          writeTasks: "serial",
          notes,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines = [
    "OVERSEER MODE",
    OVERSEER_SEP,
    "  Current/default mode: serial.",
    "  Write tasks are processed one at a time.",
    "  Parallel mode is future/opt-in and is not automatically enabled.",
  ];
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerEnv(args: string[], io: CliIO): Promise<number> {
  const wantsJson = args.length === 1 && args[0] === "--json";
  if (args.length > 1 || (args.length === 1 && !wantsJson)) {
    io.stderr.write("usage: relayos overseer env\n");
    return 1;
  }

  const cwd = process.cwd();
  const runtimeHome = process.env.RELAYOS_RUNTIME_HOME;
  const runtimeHomeSet = runtimeHome !== undefined;
  const runtimeHomeValue = runtimeHomeSet ? runtimeHome : null;
  const runtimeWorkspaceConfigured = runtimeHomeSet;
  const runtimeWorkspaceSwitchingActive = false;
  const currentRelayosResolution = "cwd" as const;
  const notes = [
    "RELAYOS_RUNTIME_HOME is detected for inspection only in this release.",
    "Runtime workspace switching is not active yet.",
    "RelayOS still resolves `.relayos/` relative to the current working directory unless/until future runtime switching is explicitly implemented.",
    "Production runtime state should stay outside the RelayOS source repo.",
  ];

  if (wantsJson) {
    io.stdout.write(
      `${JSON.stringify(
        {
          cwd,
          relayosRuntimeHomeSet: runtimeHomeSet,
          relayosRuntimeHome: runtimeHomeValue,
          runtimeWorkspaceConfigured,
          runtimeWorkspaceSwitchingActive,
          currentRelayosResolution,
          notes,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const runtimeHomeLine = runtimeHomeSet
    ? `  RELAYOS_RUNTIME_HOME: configured (${runtimeHome})`
    : "  RELAYOS_RUNTIME_HOME: not set";
  const runtimeWorkspaceLine = runtimeWorkspaceConfigured
    ? "  Runtime workspace: value detected for inspection only."
    : "  Runtime workspace: not configured (RELAYOS_RUNTIME_HOME is not set).";
  const switchingLine = "  Runtime workspace switching: not active yet.";
  const behaviorLine = runtimeHomeSet
    ? "  Current behavior: RelayOS still resolves `.relayos/` relative to the current working directory unless/until future runtime switching is explicitly implemented."
    : "  Current behavior: `.relayos/` paths resolve relative to the current working directory.";

  const lines = [
    "OVERSEER ENVIRONMENT",
    OVERSEER_SEP,
    `  Current working directory: ${cwd}`,
    runtimeHomeLine,
    runtimeWorkspaceLine,
    switchingLine,
    behaviorLine,
    "  RELAYOS_RUNTIME_HOME support is inspection-only in this release.",
    "  Production runtime state should stay outside the RelayOS source repo.",
  ];
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runOverseerInitContext(_args: string[], io: CliIO): Promise<number> {
  const layout = resolveOverseerLayout(process.cwd());
  const created = await initContextFiles(layout);
  if (created.length === 0) {
    io.stdout.write("overseer context already complete — no files created\n");
  } else {
    for (const f of created) {
      io.stdout.write(`created: .relayos/overseer/${f}\n`);
    }
  }
  return 0;
}

async function runOverseerBranch(args: string[], io: CliIO): Promise<number> {
  if (args.length === 0) {
    io.stderr.write("usage: relayos overseer branch <name>\n");
    return 1;
  }
  const name = args.join(" ");
  const layout = resolveOverseerLayout(process.cwd());
  await writeActiveBrief(layout, name);
  io.stdout.write(`active branch set: ${name}\n`);
  return 0;
}

async function runOverseerProgress(args: string[], io: CliIO): Promise<number> {
  const layout = resolveOverseerLayout(process.cwd());
  if (args.length === 0) {
    const progress = await readBranchProgress(layout);
    if (progress) {
      io.stdout.write(`${progress}\n`);
    } else {
      io.stdout.write(
        "(no branch progress recorded — use `relayos overseer progress <text>` to add an entry)\n",
      );
    }
    return 0;
  }
  const text = args.join(" ");
  await appendBranchProgress(layout, text);
  io.stdout.write(`progress recorded: ${text}\n`);
  return 0;
}

async function runOverseer(args: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "status") return runOverseerStatus(rest, io);
  if (sub === "context") return runOverseerContext(rest, io);
  if (sub === "handshake") return runOverseerHandshake(rest, io);
  if (sub === "recent") return runOverseerRecent(rest, io);
  if (sub === "context-pack") return runOverseerContextPack(rest, io);
  if (sub === "run-preflight") return runOverseerRunPreflight(rest, io);
  if (sub === "capabilities") return runOverseerCapabilities(rest, io);
  if (sub === "summary") return runOverseerSummary(rest, io);
  if (sub === "doctor") return runOverseerDoctor(rest, io);
  if (sub === "note") return runOverseerNote(rest, io);
  if (sub === "decision") return runOverseerDecision(rest, io);
  if (sub === "decisions") return runOverseerDecisions(rest, io);
  if (sub === "handoff-result") return runOverseerHandoffResult(rest, io);
  if (sub === "handoff-results") return runOverseerHandoffResults(rest, io);
  if (sub === "next") return runOverseerNext(rest, io);
  if (sub === "start") return runOverseerStart(rest, io);
  if (sub === "mode") return runOverseerMode(rest, io);
  if (sub === "env") return runOverseerEnv(rest, io);
  if (sub === "activate-runtime") return runOverseerActivateRuntime(rest, io);
  if (sub === "runtime-check") {
    return runOverseerActivateRuntime(["--dry-run", ...rest], io);
  }
  if (sub === "brief") return runOverseerBrief(rest, io);
  if (sub === "init-context") return runOverseerInitContext(rest, io);
  if (sub === "branch") return runOverseerBranch(rest, io);
  if (sub === "progress") return runOverseerProgress(rest, io);
  io.stderr.write(
    "usage: relayos overseer <status|context|handshake|recent|context-pack|run-preflight|capabilities|summary|doctor|note|decision|decisions|handoff-result|handoff-results|next|start|mode|env|activate-runtime|runtime-check|brief|init-context|branch|progress> [args...]\n",
  );
  return 1;
}

export async function runCli(
  argv = process.argv.slice(2),
  io: CliIO = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined) return runBanner([], io);

  if (command === "--help" || command === "-h") {
    io.stdout.write(usage());
    return 0;
  }

  if (command === "banner") return runBanner(rest, io);
  if (command === "launch") return runLaunch(rest, io);
  if (command === "policy") return runPolicy(rest, io);
  if (command === "checkpoint") return runCheckpoint(rest, io);
  if (command === "diff-risk") return runDiffRisk(rest, io);
  if (command === "report") return runReport(rest, io);
  if (command === "overseer") return runOverseer(rest, io);

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
