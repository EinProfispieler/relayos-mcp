import { execFile } from "node:child_process";

const GIT_MAX_BUFFER = 32 * 1024 * 1024;

export interface GitRunResult {
  ok: boolean;
  stdout: string;
  truncated: boolean;
  error?: string;
}

interface RunOpts {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

function run(args: string[], opts: RunOpts): Promise<GitRunResult> {
  return new Promise((resolveRun) => {
    execFile(
      "git",
      args,
      {
        cwd: opts.cwd,
        env: opts.env,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveRun({ ok: true, stdout, truncated: false });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        const truncated = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        const message = truncated
          ? `git ${args[0]} output exceeded ${GIT_MAX_BUFFER} bytes`
          : (stderr && stderr.toString().trim()) || error.message;
        resolveRun({
          ok: truncated,
          stdout: truncated ? stdout : "",
          truncated,
          error: message,
        });
      },
    );
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await run(["rev-parse", "--is-inside-work-tree"], { cwd });
  return result.ok && result.stdout.trim() === "true";
}

export async function gitHead(cwd: string): Promise<string | null> {
  const result = await run(["rev-parse", "HEAD"], { cwd });
  if (!result.ok) return null;
  const head = result.stdout.trim();
  return head.length > 0 ? head : null;
}

export async function gitBranch(cwd: string): Promise<string | null> {
  const result = await run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  if (!result.ok) return null;
  const branch = result.stdout.trim();
  if (branch.length === 0 || branch === "HEAD") return null;
  return branch;
}

export async function gitStatusShort(cwd: string): Promise<string> {
  const result = await run(["status", "--short"], { cwd });
  return result.ok ? result.stdout : "";
}

export interface GitDiffResult {
  text: string;
  truncated: boolean;
}

export async function gitDiff(cwd: string): Promise<GitDiffResult> {
  const result = await run(["diff", "--no-color", "HEAD"], { cwd });
  if (result.ok) {
    return { text: result.stdout, truncated: result.truncated };
  }
  return { text: "", truncated: false };
}

export async function gitListUntracked(cwd: string): Promise<string[]> {
  const result = await run(
    ["ls-files", "--others", "--exclude-standard"],
    { cwd },
  );
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
