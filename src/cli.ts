import { existsSync } from "node:fs";
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
  appendNote,
  hasOverseerState,
  initContextFiles,
  readActiveBrief,
  readBranchProgress,
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
  stdout: { write: (chunk: string) => unknown };
  stderr: { write: (chunk: string) => unknown };
}

function usage(): string {
  return "usage: relayos [banner|launch|policy|checkpoint|diff-risk|report|overseer] [--force] [args...]\n";
}

function checkpointUsage(): string {
  return "usage: relayos checkpoint <create|list|show|restore> [args...]\n";
}

function formatRelayOSBanner(): string {
  return [
    " ____  _____ _        _ __   __ ___  ____  ",
    "|  _ \\| ____| |      / \\\\ \\ / // _ \\/ ___| ",
    "| |_) |  _| | |     / _ \\\\ V /| | | \\___ \\ ",
    "|  _ <| |___| |___ / ___ \\| | | |_| |___) |",
    "|_| \\_\\_____|_____/_/   \\_\\_|  \\___/|____/ ",
    "",
    "Local-first safety, audit, and handoff layer",
    "",
    "  launch:     relayos launch latest",
    "  policy:     relayos policy latest",
    "  checkpoint: relayos checkpoint create",
    "  diff-risk:  relayos diff-risk",
    "  report:     relayos report",
    "  overseer:   relayos overseer brief",
    "",
    "Optional shell aliases are user-managed; see docs/SHELL_ALIASES.md.",
  ].join("\n");
}

async function runBanner(args: string[], io: CliIO): Promise<number> {
  if (args.length > 0) {
    io.stderr.write("usage: relayos banner\n");
    return 1;
  }
  io.stdout.write(`${formatRelayOSBanner()}\n`);
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

async function runOverseerStatus(_args: string[], io: CliIO): Promise<number> {
  const layout = resolveOverseerLayout(process.cwd());
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
  if (args.length > 0) {
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
  if (sub === "note") return runOverseerNote(rest, io);
  if (sub === "next") return runOverseerNext(rest, io);
  if (sub === "brief") return runOverseerBrief(rest, io);
  if (sub === "init-context") return runOverseerInitContext(rest, io);
  if (sub === "branch") return runOverseerBranch(rest, io);
  if (sub === "progress") return runOverseerProgress(rest, io);
  io.stderr.write(
    "usage: relayos overseer <status|note|next|brief|init-context|branch|progress> [args...]\n",
  );
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
