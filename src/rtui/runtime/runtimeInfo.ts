import { execSync } from "node:child_process";
import { basename, resolve } from "node:path";
import type { RuntimeView } from "../state/types.js";

function safeGit(args: string[]): string {
  try {
    return execSync(`git ${args.join(" ")}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

export function getRuntimeView(): RuntimeView {
  const cwd = process.cwd();
  const projectDir = basename(resolve(cwd));
  const branch = safeGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const isGitRepo = branch.length > 0;
  return {
    projectDir,
    branch: branch || "(no branch)",
    model: process.env.RTUI_MODEL ?? "gpt-5.3-codex",
    effort: (process.env.RTUI_EFFORT as "low" | "medium" | "high") ?? "medium",
    isGitRepo,
  };
}
