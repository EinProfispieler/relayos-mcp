import { execSync } from "node:child_process";
import { basename, resolve } from "node:path";
import type { RuntimeView } from "../state/types.js";
import { loadProjectConfig } from "../../config.js";

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
  const { config } = loadProjectConfig({ cwd });
  const overseer = config.overseer;
  const providers = Array.isArray(overseer?.providers) ? overseer.providers : [];
  const primaryId = typeof overseer?.primary_provider === "string" ? overseer.primary_provider : "";
  const primary = providers.find((p) => p.id === primaryId) ?? null;
  const cfgModel =
    (primary?.model && primary.model.trim().length > 0 ? primary.model : null) ??
    (typeof overseer?.model === "string" && overseer.model.trim().length > 0 ? overseer.model : null);
  const rawEffort =
    (primary?.effort && primary.effort.trim().length > 0 ? primary.effort : null) ??
    (typeof overseer?.effort === "string" && overseer.effort.trim().length > 0 ? overseer.effort : null);
  const cfgEffort: "low" | "medium" | "high" | "xhigh" | "max" =
    rawEffort === "low" || rawEffort === "high" || rawEffort === "xhigh" || rawEffort === "max"
      ? rawEffort
      : "medium";
  return {
    projectDir,
    branch: branch || "(no branch)",
    model: process.env.RTUI_MODEL ?? cfgModel ?? "gpt-5.3-codex",
    effort: (process.env.RTUI_EFFORT as "low" | "medium" | "high" | "xhigh" | "max") ?? cfgEffort,
    isGitRepo,
  };
}
