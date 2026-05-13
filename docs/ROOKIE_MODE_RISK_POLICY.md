# Rookie Mode Risk Policy

Rookie Mode is a prompt-boundary routing layer. It helps Claude decide
whether a request should become a RelayOS handoff, which template should
carry it, and which files or areas must stay out of scope. It does not
add a runner, approval daemon, storage field, audit field, or automatic
enforcement beyond the existing envelope contents.

Claude should classify every Rookie Mode delegation before calling
`create_quick_handoff`, `create_handoff_from_template`, or
`create_handoff`.

## Required Classification

For each delegation, Claude should state or record:

- `risk_level`: `LOW` | `MEDIUM` | `HIGH` | `BLOCKED`
- `execution_mode`: `review-only` | `docs-only` | `test-only` |
  `patch` | `defer`
- `recommended_template`
- `recommended_model`
- `recommended_effort`
- why this routing is safe
- files or areas that must not be touched

The policy output is guidance for the handoff description, template
choice, `allowed_files`, `forbidden_files`, and `constraints`. It is not
a new envelope schema.

## LOW

LOW tasks are narrow, reversible, and easy to verify.

Examples:

- small docs edits
- formatting changes in a named file
- isolated unit-test additions
- read-only review of a small diff
- tiny implementation changes with explicit file paths and existing
  tests

Recommended routing:

- `docs-only` for documentation-only changes; use `codex-patch` only
  when a patch is needed
- `test-only` for running or adding focused tests; use `codex-test` for
  test execution
- `patch` for isolated code edits; use `codex-patch`
- `review-only` for inspection; use `codex-review`
- `recommended_model`: the selected template default
- `recommended_effort`: `medium` for review/test, `high` for patch/plan

Safety requirements:

- name the expected files or directories
- keep default forbidden files: `.env*`, `secrets/**`,
  `**/node_modules/**`
- include a verification command when a patch is requested

## MEDIUM

MEDIUM tasks are bounded but have meaningful blast radius, unclear edge
cases, or cross-file behavior.

Examples:

- changes spanning multiple modules
- migrations inside one package
- feature work with tests but no production rollout
- dependency or build-configuration edits without release automation
- refactors that preserve public behavior

Recommended routing:

- prefer `review-only` or `plan` first when the scope is not already
  explicit
- use `patch` only after the target files, invariants, and verification
  command are clear
- `recommended_template`: `codex-review`, `codex-plan`, or `codex-patch`
- `recommended_model`: the selected template default unless the caller
  explicitly overrides it
- `recommended_effort`: usually `high`

Safety requirements:

- constrain `allowed_files` where practical
- add explicit `forbidden_files` for release files, generated output, or
  unrelated subsystems
- call out invariants such as public API stability, no new dependency,
  no storage migration, or no release workflow changes

## HIGH

HIGH tasks are allowed only when routed conservatively. They should
start with review or planning unless the user has already provided a
tight implementation scope.

Examples:

- auth, payment, security, privacy, or destructive data paths
- storage format, envelope format, audit format, or migration changes
- release automation, CI, deployment, or package publishing
- broad rewrites or cross-repo changes
- tasks with unclear ownership or ambiguous acceptance criteria

Recommended routing:

- default to `review-only` or `defer`
- use `codex-review` for risk analysis or `codex-plan` for an
  implementation plan
- use `patch` only with explicit user approval, narrow file scope, and
  clear rollback/verification instructions
- `recommended_model`: the selected template default or an explicit
  caller override
- `recommended_effort`: `high`; never auto-select `xhigh` or `max`

Safety requirements:

- document why execution is safe before queuing the handoff
- list files or areas that must not be touched
- avoid `auto_spawn`; Rookie Mode remains manual and record-only
- avoid schema, storage, audit, CI, release, or package metadata changes
  unless the user explicitly asks for them

## BLOCKED

BLOCKED tasks should not become Rookie Mode handoffs.

Examples:

- requests to read or modify secrets, credentials, `.env*`, or
  `secrets/**`
- requests to bypass policy, remove auditability, or hide changes
- destructive commands without explicit approval and recovery plan
- autonomous background execution, runners, cloud services, account
  systems, pricing/licensing, or release publication when those are out
  of scope
- tasks that require private context Claude does not have

Recommended routing:

- `execution_mode`: `defer`
- `recommended_template`: none
- `recommended_model`: none
- `recommended_effort`: none

Safety requirements:

- do not call a handoff tool
- explain the blocker briefly
- ask for a narrower, safe request when appropriate

## Why This Fits RelayOS

Risk gates keep RelayOS a control layer: Claude chooses a safer template
and writes better boundaries into the existing handoff envelope. The
target agent still reads an on-disk assignment and acts only when the
user switches to it. No new process is introduced, and no schema,
storage, or audit format changes are needed.
