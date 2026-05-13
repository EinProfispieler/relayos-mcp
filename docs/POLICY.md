# Policy evaluator

RelayOS ships a deterministic, local **policy evaluator** that classifies
each handoff envelope as `allow`, `warn`, or `block` based on the
envelope's task text and file scope.

The evaluator runs at `relayos launch` / `relayos policy` time. It does
not call any LLM, does not touch the network, does not modify storage or
audit, and does not change the envelope schema. It is pure regex/path
matching over fields the envelope already has.

This is a **runtime guard rail**, complementary to the upstream
[Rookie Mode Risk Policy](./ROOKIE_MODE_RISK_POLICY.md) that Claude
applies *before* creating a handoff.

---

## Severity model

| Severity | Meaning                                              | `relayos launch` behavior                                            |
|----------|------------------------------------------------------|----------------------------------------------------------------------|
| `allow`  | No findings fired.                                   | Banner suppressed; command on stdout; exit 0. Identical to v0.4.7.   |
| `warn`   | At least one warning finding.                        | Banner on **stderr**; command still on **stdout**; exit 0.           |
| `block`  | At least one blocking finding.                       | Banner on **stderr**; **no** command on stdout; exit 2.              |

Final decision = worst severity across findings.

`$(relayos launch)` keeps working on `allow` and `warn` because the
banner is on stderr only. On `block`, the command does not reach stdout
unless `--force` is passed.

---

## Rules

All rules are pure functions of the envelope. Inputs scanned for keyword
rules: `task_title`, `task_description`, and `constraints` (joined with
newlines). Path rules also inspect `allowed_files`.

| Code                       | Severity        | Trigger                                                                                                                                                            |
|----------------------------|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `broad_edit_scope`         | `warn`          | `execution_mode` is `patch` or `test` **and** `allowed_files` is empty.                                                                                            |
| `destructive_instruction`  | `block`         | Hard pattern in task: `rm -rf`, `git push --force`/`-f`, `--no-verify`, `git reset --hard`, `drop table`, `drop database`, `truncate table`, `chmod 777`, `sudo rm`, fork-bomb `:(){`. |
| `destructive_instruction`  | `warn`          | Soft keyword (`delete`, `destroy`, `wipe`, `purge`) **and** a nearby path/resource hint (`/`, `file`, `directory`, `table`, `database`, `repo`, …).                |
| `release_action`           | `warn`          | `npm publish`, `gh release`, `git tag`, `git push --tags`, `cargo publish`, `twine upload`, `pypi`, `release v<N>`.                                                |
| `network_command`          | `warn`          | `curl`, `wget`, `nc -`, `netcat`, `ssh <host>`, `scp`, `rsync`, `nmap`, `pip install`, `npm install -g`, `cargo install`, `gem install`, `brew install`.            |
| `secret_sensitive_path`    | `block` / `warn`| `.env`, `secrets/`, `id_rsa`, `id_ed25519`, `~/.aws`, `~/.ssh`, `.netrc`, `*.pem`, or `*.key` appears in `allowed_files` or task text. Downgrades to `warn` when `forbidden_files` already covers both `.env*` and `secrets/**`. |

Matching is case-insensitive. Path patterns require segment-style
matches to avoid false positives on prose (`primary key`, `format.ts`
do not match).

---

## Mapping to the Rookie Mode 4-tier taxonomy

The 4-tier taxonomy in [Rookie Mode Risk Policy](./ROOKIE_MODE_RISK_POLICY.md)
is upstream guidance for Claude. The runtime evaluator is the downstream
3-tier check. They line up roughly like this:

| Rookie Mode tier | Typical runtime decision |
|------------------|--------------------------|
| `LOW`            | `allow`                  |
| `MEDIUM`         | `allow` or `warn`        |
| `HIGH`           | `warn` or `block`        |
| `BLOCKED`        | `block`                  |

Claude can still queue a `HIGH`-tier handoff if the user has provided
explicit scope, protected areas, and verification expectations — the
runtime evaluator is the last layer, not the only one.

---

## `relayos policy [latest|N|h_…]`

Read-only query. On successful evaluation it exits `0` and writes the
decision to stdout regardless of severity — `allow`, `warn`, and `block`
all return `0` here. The exit-code difference between `warn` and `block`
only applies to `relayos launch` (see the severity table above), since
`policy` is a pure query, not a gate.

Usage errors and handoff-selector errors exit `1` with a `relayos
policy: …` line on stderr — same shape as `relayos launch`.

| Exit code | Condition                                              |
|-----------|--------------------------------------------------------|
| `0`       | Evaluation succeeded; decision printed to stdout.      |
| `1`       | Unknown flag, or selector did not resolve to a handoff.|

Successful stdout output:

```
DECISION: WARN
- broad_edit_scope: patch mode with no allowed_files
- network_command: task mentions network/install command `curl`
HANDOFF: h_01HQ…  target=codex  mode=patch
```

Use this when you want to see why a handoff is flagged without trying
to launch it.

---

## `relayos launch [--force] [latest|N|h_…]`

Same selector semantics as before. The new behaviors:

- `allow`: unchanged — command on stdout, exit 0, no banner.
- `warn`: banner lines (each prefixed with `# `) go to stderr; command
  still goes to stdout; exit 0. `$(relayos launch)` still works.
- `block`: banner on stderr, an extra `# (re-run with --force …)` hint
  on stderr, **nothing** on stdout, exit 2.
- `--force`: prints the launch command even on `block` (banner still
  emitted to stderr). Use sparingly — the audit trail does not record
  `--force` because RelayOS never writes from the CLI.

---

## Non-goals

- The decision is **not** persisted to the envelope.
- No new audit event kind is emitted.
- No new MCP tool surface.
- `auto_spawn` and the MCP create-handoff tools are not affected — the
  evaluator only runs in the CLI.

If you want the evaluator to influence MCP behavior (e.g. refuse to
record a `block`-level envelope), that's a separate proposal — file an
issue rather than reaching into the CLI.

---

## See also

- [`docs/LAUNCH.md`](./LAUNCH.md) — selectors, exit codes, and the
  print-only rationale that the policy gate extends.
- [`docs/ROOKIE_MODE_RISK_POLICY.md`](./ROOKIE_MODE_RISK_POLICY.md) — the
  upstream 4-tier classification Claude applies before calling
  `create_quick_handoff`.
- [`README.md`](../README.md) — install, MCP wiring, envelope schema.
