import type { Envelope, HandoffInput } from "../schema.js";
import {
  buildPromptPrefix,
  renderShellCommand,
  toRenderable,
  type RenderableHandoff,
} from "./shared.js";

export interface RenderedTargetPrompt {
  prompt: string;
  suggested_argv: string[];
  launch_command: string;
  advisory_notes: string[];
}

function sandboxForMode(mode: RenderableHandoff["execution_mode"]): string {
  switch (mode) {
    case "patch":
    case "test":
      return "workspace-write";
    case "read_only":
    case "plan":
    case "review":
      return "read-only";
  }
}

export function renderCodexTarget(
  input: Envelope | HandoffInput,
  opts: { workingDir?: string } = {},
): RenderedTargetPrompt {
  const h = toRenderable(input);
  const prompt = `${buildPromptPrefix(h)}\n`;

  const argv: string[] = ["codex", "exec"];
  argv.push("--model", h.model);
  argv.push("-c", `model_reasoning_effort=${h.effort}`);
  argv.push("--sandbox", sandboxForMode(h.execution_mode));

  const workingDir = "working_dir" in input ? input.working_dir : opts.workingDir;
  if (workingDir) argv.push("--cd", workingDir);

  argv.push("--skip-git-repo-check");
  argv.push(prompt);

  const advisory_notes: string[] = [];
  if (h.allowed_files.length > 0 || h.forbidden_files.length > 0) {
    advisory_notes.push(
      "advisory_only: codex has no native per-file allowlist; allowed_files / forbidden_files enforced via prompt only",
    );
  }
  if (h.execution_mode === "plan") {
    advisory_notes.push(
      "advisory_only: codex has no native 'plan' mode; using --sandbox read-only and prompt instruction to produce a plan",
    );
  }
  if (h.execution_mode === "review") {
    advisory_notes.push(
      "advisory_only: codex has no native 'review' mode; using --sandbox read-only and prompt instruction to review",
    );
  }
  if (h.execution_mode === "test") {
    advisory_notes.push(
      "advisory_only: codex has no native 'test' mode; using --sandbox workspace-write and prompt instruction to run tests",
    );
  }

  return {
    prompt,
    suggested_argv: argv,
    launch_command: renderShellCommand(argv),
    advisory_notes,
  };
}
