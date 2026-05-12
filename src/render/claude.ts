import type { Envelope, HandoffInput } from "../schema.js";
import {
  buildPromptPrefix,
  renderShellCommand,
  toRenderable,
  type RenderableHandoff,
} from "./shared.js";
import type { RenderedTargetPrompt } from "./codex.js";

function permissionModeFor(mode: RenderableHandoff["execution_mode"]): string {
  switch (mode) {
    case "read_only":
    case "plan":
    case "review":
      return "plan";
    case "patch":
    case "test":
      return "acceptEdits";
  }
}

export function renderClaudeTarget(
  input: Envelope | HandoffInput,
  opts: { workingDir?: string } = {},
): RenderedTargetPrompt {
  const h = toRenderable(input);
  const prompt = `${buildPromptPrefix(h)}\n`;

  const argv: string[] = ["claude", "-p", prompt];
  argv.push("--model", h.model);
  argv.push("--permission-mode", permissionModeFor(h.execution_mode));

  if (h.execution_mode === "read_only") {
    argv.push("--allowed-tools", "Read,Glob,Grep,WebFetch");
  }

  const workingDir = "working_dir" in input ? input.working_dir : opts.workingDir;
  if (workingDir) argv.push("--add-dir", workingDir);

  argv.push("--max-turns", "50");
  argv.push("--output-format", "text");

  const advisory_notes: string[] = [];
  advisory_notes.push(
    "advisory_only: claude CLI has no native effort flag; effort enforced via prompt only",
  );
  if (h.allowed_files.length > 0 || h.forbidden_files.length > 0) {
    advisory_notes.push(
      "advisory_only: claude CLI has no native per-file allowlist; allowed_files / forbidden_files enforced via prompt only",
    );
  }

  return {
    prompt,
    suggested_argv: argv,
    launch_command: renderShellCommand(argv),
    advisory_notes,
  };
}
