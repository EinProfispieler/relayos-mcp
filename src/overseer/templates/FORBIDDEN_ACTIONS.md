# Forbidden Actions

- Do not implement real runtime activation/switching.
- Do not implement runtime migration.
- Do not create daemon/background agent behavior or a detached runner.
- Do not run parallel project/worktree orchestration without explicit approval.
- Do not make breaking changes to storage, envelope, or audit formats —
  no breaking format changes. Additive optional fields are permitted.
- Do not tag or create GitHub Releases unless explicitly instructed.
- Do not force-push, amend published commits, or use `--no-verify`.
- Do not commit, release, perform destructive file operations, run migrations,
  change production/server state, change credentials, or incur high-cost
  external API usage without explicit user approval.
