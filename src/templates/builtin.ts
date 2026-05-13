import type { Template } from "../schema.js";

export const BUILTIN_DEFAULTS = {
  source_agent: "claude" as const,
  forbidden_files: [".env*", "secrets/**", "**/node_modules/**"],
  constraints: [] as string[],
};

const REVIEW_OUTPUT = [
  "A bulleted list of findings, each with severity (info/warn/error) and file:line.",
];

const PLAN_OUTPUT = [
  "A step-by-step implementation plan with exact file paths and a verification command per step.",
];

const TEST_OUTPUT = [
  "Exit code of the test command.",
  "For each failure: test name plus first error line.",
];

const PATCH_OUTPUT = ["A unified diff.", "A one-paragraph summary of the change."];

export const BUILTIN_TEMPLATES: Record<string, Template> = {
  "codex-patch": {
    name: "codex-patch",
    description: "Codex writes a code patch (unified diff + summary).",
    target_agent: "codex",
    model: "gpt-5.5",
    effort: "high",
    execution_mode: "patch",
    allowed_files: [],
    forbidden_files: [...BUILTIN_DEFAULTS.forbidden_files],
    constraints: [],
    expected_output: [...PATCH_OUTPUT],
  },
  "codex-review": {
    name: "codex-review",
    description: "Codex reviews code read-only and reports findings.",
    target_agent: "codex",
    model: "gpt-5.5",
    effort: "medium",
    execution_mode: "review",
    allowed_files: [],
    forbidden_files: [...BUILTIN_DEFAULTS.forbidden_files],
    constraints: [],
    expected_output: [...REVIEW_OUTPUT],
  },
  "codex-test": {
    name: "codex-test",
    description: "Codex runs tests and reports the result.",
    target_agent: "codex",
    model: "gpt-5.5",
    effort: "medium",
    execution_mode: "test",
    allowed_files: [],
    forbidden_files: [...BUILTIN_DEFAULTS.forbidden_files],
    constraints: [],
    expected_output: [...TEST_OUTPUT],
  },
  "codex-plan": {
    name: "codex-plan",
    description: "Codex produces an implementation plan with file paths.",
    target_agent: "codex",
    model: "gpt-5.5",
    effort: "high",
    execution_mode: "plan",
    allowed_files: [],
    forbidden_files: [...BUILTIN_DEFAULTS.forbidden_files],
    constraints: [],
    expected_output: [...PLAN_OUTPUT],
  },
  "claude-review": {
    name: "claude-review",
    description: "Claude reviews code read-only and reports findings.",
    target_agent: "claude",
    model: "claude-opus-4-7",
    effort: "medium",
    execution_mode: "review",
    allowed_files: [],
    forbidden_files: [...BUILTIN_DEFAULTS.forbidden_files],
    constraints: [],
    expected_output: [...REVIEW_OUTPUT],
  },
  "claude-plan": {
    name: "claude-plan",
    description: "Claude produces an implementation plan with file paths.",
    target_agent: "claude",
    model: "claude-opus-4-7",
    effort: "high",
    execution_mode: "plan",
    allowed_files: [],
    forbidden_files: [...BUILTIN_DEFAULTS.forbidden_files],
    constraints: [],
    expected_output: [...PLAN_OUTPUT],
  },
};
