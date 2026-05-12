import { spawn as nodeSpawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import type { SpawnResult } from "../schema.js";
import {
  stdoutLogPath,
  stderrLogPath,
  type StorageLayout,
} from "../storage.js";

const execFile = promisify(execFileCb);

const TAIL_BYTES = 16 * 1024;

export interface CliDetectionResult {
  target_binary: string;
  found: boolean;
  resolved_path?: string;
}

export async function detectCli(binary: string): Promise<CliDetectionResult> {
  try {
    const { stdout } = await execFile("/usr/bin/env", ["which", binary]);
    const resolved = stdout.trim().split("\n")[0];
    if (!resolved) return { target_binary: binary, found: false };
    return { target_binary: binary, found: true, resolved_path: resolved };
  } catch {
    return { target_binary: binary, found: false };
  }
}

class Tail {
  private chunks: Buffer[] = [];
  private size = 0;
  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size - (this.chunks[0]?.length ?? 0) >= TAIL_BYTES) {
      const dropped = this.chunks.shift();
      if (!dropped) break;
      this.size -= dropped.length;
    }
  }
  toString(): string {
    const buf = Buffer.concat(this.chunks, this.size);
    if (buf.length <= TAIL_BYTES) return buf.toString("utf8");
    return buf.subarray(buf.length - TAIL_BYTES).toString("utf8");
  }
}

export interface SpawnOptions {
  layout: StorageLayout;
  handoffId: string;
  binary: string;
  argv: string[];
  workingDir?: string;
}

export async function runTarget(opts: SpawnOptions): Promise<SpawnResult> {
  const { layout, handoffId, binary, argv, workingDir } = opts;
  const startedAt = new Date();

  const stdoutFile = createWriteStream(stdoutLogPath(layout, handoffId));
  const stderrFile = createWriteStream(stderrLogPath(layout, handoffId));
  const stdoutTail = new Tail();
  const stderrTail = new Tail();

  return new Promise<SpawnResult>((resolve, reject) => {
    const child = nodeSpawn(binary, argv.slice(1), {
      cwd: workingDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutFile.write(chunk);
      stdoutTail.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrFile.write(chunk);
      stderrTail.push(chunk);
    });

    child.on("error", (err) => {
      stdoutFile.end();
      stderrFile.end();
      reject(err);
    });

    child.on("close", (code) => {
      stdoutFile.end();
      stderrFile.end();
      const finishedAt = new Date();
      resolve({
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        exit_code: code ?? -1,
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        stdout_tail: stdoutTail.toString(),
        stderr_tail: stderrTail.toString(),
      });
    });
  });
}
