# `relayos diff-risk`

A local read-only command that classifies the **current working
tree** (modified, staged, and untracked files vs. HEAD) as `allow`,
`warn`, or `block` *before* `git commit`. It surfaces the categories
most likely to cause real damage on commit — secrets, CI/deploy
paths, dependency-manifest churn, auth/security/database paths,
large deletions, and risky shell commands appearing in added diff
text — and prints a single compact decision block.

```bash
relayos diff-risk
```

`diff-risk` is the third member of the local risk-tooling family:

- [`relayos policy`](./POLICY.md) classifies **handoff envelopes**
  before launch.
- [`relayos checkpoint`](./CHECKPOINTS.md) records the **working
  tree** so you can review it later.
- `relayos diff-risk` (this doc) classifies the **working tree**
  before you commit it.

It runs no LLM, makes no network calls, modifies nothing — pure
observation over what `git diff HEAD`, `git status --short`, and
`git ls-files --others --exclude-standard` already show.

---

## Why it exists

The dangerous moment in an AI-assisted edit is not when the agent
writes the patch — it's when the human commits it. Agents have, in
practice, edited `.env`, modified `.github/workflows/*.yml`, added
unwanted entries to `package.json`, or deleted whole directories
without flagging it. The operator either reads `git diff` line by
line, trusts the agent's narration, or skips the check entirely.
The first is slow, the second is unsafe, and the third is how
secrets get committed.

`diff-risk` closes that loop. Before `git commit`, run the command,
see `DECISION: WARN` (or `BLOCK`) with a one-line reason per
finding, and either commit with confidence or pause to fix.

---

## Severity model

| Severity | Meaning                                                  |
|----------|----------------------------------------------------------|
| `allow`  | No findings fired.                                       |
| `warn`   | At least one warning finding.                            |
| `block`  | At least one blocking finding (e.g. `.env` in status).   |

Final decision = worst severity across findings. Block trumps warn;
warn trumps allow. Findings are printed block-first, then warn.

`diff-risk` is a **query, not a gate** — all three decisions exit
`0`. The exit code only differs on usage errors (`1`). If you want
a hard fail on `block`, grep for it:

```bash
relayos diff-risk | grep -q '^DECISION: BLOCK' && exit 1
```

This matches `relayos policy` semantics. The CLI itself stays
decision-neutral so it composes cleanly into pre-commit hooks,
CI helpers, and `$(…)` substitutions.

---

## Rules

All rules are pure functions of three inputs: `statusLines` (from
`git status --short`), `diffText` (from `git diff HEAD`), and
`untracked` (from `git ls-files --others --exclude-standard`). Path
matching is segment-aware to avoid false positives on prose tokens.

| Code                       | Severity | Trigger                                                                                                                                                            |
|----------------------------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `secret_config_path`       | `block`  | Path in status or untracked matches: `.env`, `.env.*`, `secrets/**`, `credentials*`, `id_rsa`, `id_ed25519`, `.netrc`, `*.pem`, `*.key`, or `*token*` (basename, with the `tokenize*` family excluded). |
| `ci_deploy_path`           | `warn`   | Path matches: `.github/workflows/**`, `Dockerfile`, `docker-compose*.yml`/`.yaml`, `deploy/**`, `*.deploy.sh`, top-level `Makefile`.                                |
| `dependency_manifest`      | `warn`   | Path basename matches: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.toml`, `Cargo.lock`, `pyproject.toml`, `Pipfile`, `Pipfile.lock`, `Gemfile`, `Gemfile.lock`, `go.mod`, `go.sum`, `requirements*.txt`. |
| `auth_security_path`       | `warn`   | Path segment matches: `auth`, `oauth`, `session(s)`, `permission(s)`, `acl`, `security`, `crypto`, `password(s)`, `payment(s)`, `billing`, `stripe`, `migration(s)` — or basename ends in `.sql`. |
| `large_deletion`           | `warn`   | ≥200 lines removed across the diff, **or** any file deleted (`status` line begins with `D`).                                                                       |
| `risky_command_in_diff`    | `warn`   | An **added** diff line (`^\+`, excluding `^\+\+\+`) contains one of: `rm -rf`, `git push --force`, `--no-verify`, `git reset --hard`, `drop table/database`, `truncate table`, `chmod 777`, `sudo rm`, fork-bomb `:(){`, `npm publish`, `gh release`, `git tag`, `git push --tags`, `cargo publish`, `twine upload`, `pypi`, `release v<N>`, `curl ... | sh`/`bash`, `wget ... | sh`/`bash`. |

Matching is case-insensitive. Path patterns require segment-style
matches: `tokenizer.ts` does **not** match `*token*`, and
`format.ts` does **not** match `auth` even though the substring
`at` appears.

The `risky_command_in_diff` patterns are re-exported from
`src/policy.ts` (`DESTRUCTIVE_HARD` + `RELEASE_PATTERNS`) so the
envelope evaluator and the diff evaluator never drift. The
pipe-to-shell pair (`curl|sh`, `wget|sh`) is diff-specific.

### `secret_config_path` severity vs. `relayos policy`

`relayos policy` downgrades `secret_sensitive_path` to `warn` when
the envelope's `forbidden_files` already covers `.env*` and
`secrets/**`. `diff-risk` has no envelope to consult — a `.env`
file appearing in `git status` is a hard `block` with no downgrade.
The operator can still commit it manually if they choose;
`diff-risk` does not enforce, it warns.

---

## Output

`DECISION: WARN`:

```
DECISION: WARN
REASONS:
- ci_deploy_path: CI/deploy path modified: .github/workflows/release.yml (matches `.github/workflows/**`)
- dependency_manifest: dependency manifest modified: package.json
- large_deletion: large deletion: 412 lines removed, 3 files deleted
FILES CHECKED:
   M src/index.ts
   M package.json
   M .github/workflows/release.yml
   D removed-thing.ts
SUMMARY: 3 findings (0 block, 3 warn). Review before commit.
```

`DECISION: ALLOW`:

```
DECISION: ALLOW
REASONS: (none)
FILES CHECKED: (none)
SUMMARY: working tree is clean against HEAD.
```

Outside a git repo, the command still exits `0` with `DECISION:
ALLOW` and writes a one-line note to stderr (same shape as
`relayos checkpoint create`):

```
# note: /tmp/somewhere is not inside a git working tree; diff-risk is a no-op
```

---

## Exit codes

| Code | Condition                                                    |
|------|--------------------------------------------------------------|
| `0`  | Evaluation succeeded; decision printed to stdout. Returned for `allow`, `warn`, and `block` alike — `diff-risk` is a query, not a gate. |
| `1`  | Unknown flag.                                                |

---

## Non-goals

- **No working-tree mutation.** Pure observation via the same git
  readers the checkpoint command already uses.
- **No new MCP tool.** CLI-only. The signal is `cwd`-bound; the
  natural integration point is `git status` → `relayos diff-risk` →
  `git commit`, all in one terminal.
- **No new audit event, schema field, or storage write.** Nothing
  is recorded under `$HANDOFF_DIR`.
- **No pre-commit hook installer.** Wire it yourself:
  `echo 'relayos diff-risk' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`.
- **No `--json`, `--quiet`, `--fail-on <severity>`, or `--staged`
  filter.** Out of scope for v1. v1 inspects the full working-tree-
  vs-HEAD diff plus untracked files — what the next commit *could*
  include, not what's currently staged. That's the conservative
  default.
- **No suggestion engine.** The finding is the message; no
  auto-remediation hint, no auto-fix.

---

## See also

- [`docs/POLICY.md`](./POLICY.md) — the envelope-level risk
  evaluator. Shares the `DESTRUCTIVE_HARD` and `RELEASE_PATTERNS`
  pattern lists with `diff-risk`.
- [`docs/CHECKPOINTS.md`](./CHECKPOINTS.md) — snapshot HEAD +
  status + diff + untracked files for later review. Complements
  `diff-risk`: checkpoint records, diff-risk classifies.
- [`docs/LAUNCH.md`](./LAUNCH.md) — print the launch command for a
  queued handoff, with the same `allow`/`warn`/`block` model.
- [`README.md`](../README.md) — install, MCP wiring, full tools table.
