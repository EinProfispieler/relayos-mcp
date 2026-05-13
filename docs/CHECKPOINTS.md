# `relayos checkpoint`

A local-first record of the working tree just before a risky AI-assisted
change. `relayos checkpoint create` snapshots git HEAD, branch,
`git status --short`, `git diff`, and the untracked file list into
RelayOS storage and prints a checkpoint id. `list` and `show` let you
inspect snapshots later. Restore is intentionally **not** implemented in
this release — only its safety design is documented (see below).

```bash
relayos checkpoint create                   # snapshot the current tree
relayos checkpoint create --message "pre-codex review"
relayos checkpoint list                     # newest-first table
relayos checkpoint show latest              # metadata for the newest
relayos checkpoint show c_01HR…             # by id
relayos checkpoint show 2                   # by 1-based index
```

Checkpoint creation is **read-only against the working tree**: no
`git add`, no `git stash`, no commits, no tags, no pushes, no config
writes — only observation via `git rev-parse`, `git status`, `git diff`,
and `git ls-files`. The output files live under `$HANDOFF_DIR`
(default `~/.claude/handoff/`).

---

## Why checkpoints exist

When you let Codex (or Claude) apply a patch and the result is wrong, the
question "what state was the tree in before that?" is harder to answer
than it should be.

**Terminal output is not an audit source of truth.** Scrollback gets
truncated, multiplexers drop history, an accidental `⌘K` wipes a
session. Even if your terminal kept everything, you'd be reconstructing a
working tree from chat narration — that is not deterministic. A
checkpoint is a small artifact stream on disk you control: a status
snapshot, the exact diff, the untracked file list, and a header that
ties them together. It exists independently of any chat session.

**Checkpoint files are local evidence for rollback and review.** They
let you answer two questions deterministically:

1. *What did the tree look like at the moment I ran `checkpoint create`?*
2. *What changed between then and now?* — `diff` the current state
   against the recorded `.diff` and the recorded `.status` snapshot.

That is the foundation for a future `restore` command, but you do not
need restore to get value out of this today. A captured diff is enough
to hand-roll a `git apply --check` or `git apply -R` against any prior
state, with no parsing required.

Checkpoint is **not** a substitute for commits. It is the layer
underneath: a timestamped, immutable record of a moment that you can
take whether or not you intend to commit, and whether or not the tree is
clean.

---

## What gets captured

| Field                  | Source command                                     |
|------------------------|----------------------------------------------------|
| `git.head`             | `git rev-parse HEAD`                               |
| `git.branch`           | `git rev-parse --abbrev-ref HEAD` (null if detached)|
| `git.is_repo`          | `git rev-parse --is-inside-work-tree`              |
| `.status`              | `git status --short`                               |
| `.diff`                | `git diff --no-color HEAD`                         |
| `.untracked`           | `git ls-files --others --exclude-standard`         |
| `git.dirty`            | `true` if status has any line OR untracked is non-empty |
| `cwd`                  | the directory `checkpoint create` ran in           |
| `created_at`           | ISO-8601 timestamp at capture time                 |
| `message`              | optional `--message`/`-m` string, or `null`        |

A checkpoint is **always** recorded, even outside a git repo. In that
case `git.is_repo` is `false`, `git.head` and `git.branch` are `null`,
and the `.status` / `.diff` / `.untracked` files are written empty. The
CLI prints a one-line note to stderr but still exits 0 — you still have
a timestamped artifact.

Diff captures are capped at 32 MB. If `git diff` exceeds the cap, the
checkpoint records whatever was captured and sets
`counts.diff_truncated: true` rather than failing.

---

## Storage layout

```
$HANDOFF_DIR/                    # default: ~/.claude/handoff/
├── audit.jsonl                  # handoff audit log (unchanged)
├── envelopes/
│   └── h_01HQ….json             # handoffs (unchanged)
└── checkpoints/                 # ← new artifact stream
    ├── c_01HR….json             # metadata
    ├── c_01HR….diff             # git diff --no-color HEAD
    ├── c_01HR….status           # git status --short
    └── c_01HR….untracked        # newline-separated paths
```

Each checkpoint is four sibling files. The `.json` stays small and
indexable for `list`; the `.diff` keeps the heavy payload as a plain
text file so you can `cat`/`less`/`git apply --check` it without
parsing JSON.

`Checkpoint` metadata shape (`c_….json`):

```json
{
  "id": "c_01HR…",
  "created_at": "2026-05-14T10:14:22Z",
  "cwd": "/Users/you/your-repo",
  "git": {
    "is_repo": true,
    "head": "dc80449…",
    "branch": "main",
    "dirty": true
  },
  "files": {
    "status_path": "/.../checkpoints/c_01HR….status",
    "diff_path":   "/.../checkpoints/c_01HR….diff",
    "untracked_path": "/.../checkpoints/c_01HR….untracked"
  },
  "counts": {
    "status_lines": 7,
    "diff_bytes": 12834,
    "untracked_lines": 2,
    "diff_truncated": false
  },
  "message": null
}
```

Checkpoints are **independent of the handoff audit log**. Capturing a
checkpoint does not append to `audit.jsonl`; running a handoff does not
write a checkpoint. They are two parallel artifact streams that you can
correlate by timestamp.

---

## CLI surface

### `checkpoint create [--message <msg>]`

Captures the current tree. Writes four files and prints a summary on
stdout:

```
checkpoint c_01HR…
  status:    /Users/.../c_01HR….status   (7 lines)
  diff:      /Users/.../c_01HR….diff     (12,834 bytes)
  untracked: /Users/.../c_01HR….untracked (2 lines)
  HEAD:      dc80449   branch: main   dirty: yes
```

`--message <msg>` (or `-m <msg>`) attaches a freeform note to the
metadata. Use it to record why you took the snapshot — "pre-codex
review", "before manual revert", "baseline for v0.6 rebase".

Outside a git repo, the four files are still written (empty), and a
one-line note goes to stderr:

```
# note: /tmp/somewhere is not inside a git working tree; status/diff/untracked files are empty
```

Exit code is `0` on success, `1` for unknown flags.

### `checkpoint list`

Newest-first table of all recorded checkpoints:

```
c_01HR…  2026-05-14T10:14:22Z  main@dc80449  dirty   "pre-codex review"
c_01HQ…  2026-05-13T18:02:11Z  main@1cdb555  clean
```

When no checkpoints exist, exits `0` and writes
`relayos checkpoint: no checkpoints found` to stderr (helpful note, not
an error).

### `checkpoint show <id|latest|N>`

Prints the metadata block plus the saved paths:

```
id:         c_01HR…
created_at: 2026-05-14T10:14:22Z
cwd:        /Users/you/your-repo
is_repo:    true
branch:     main
head:       dc80449…
dirty:      yes
message:    -
status:     /.../c_01HR….status (7 lines)
diff:       /.../c_01HR….diff (12,834 bytes)
untracked:  /.../c_01HR….untracked (2 lines)

# cat /.../c_01HR….diff | less   # to inspect the diff
```

Selector semantics mirror `relayos launch`:

| Selector              | Meaning                                                |
|-----------------------|--------------------------------------------------------|
| *(none)* / `latest`   | Newest checkpoint.                                     |
| `N` (positive int)    | The Nth newest checkpoint (1-based).                   |
| `c_…`                 | Exact checkpoint id.                                   |

`show` deliberately does **not** dump the diff inline — diffs can be
megabytes. The hint shows you the path to `cat`/`less` it yourself.

### Errors

| Exit code | Condition                                | Message                                                         |
|-----------|------------------------------------------|-----------------------------------------------------------------|
| `1`       | No checkpoint with that id               | `relayos checkpoint: checkpoint <id> was not found`             |
| `1`       | `N` is past the end of the list          | `relayos checkpoint: checkpoint selection N is out of range; …` |
| `0`       | `list` called with empty storage         | note on stderr (`relayos checkpoint: no checkpoints found`) — not an error |
| `1`       | Unknown subcommand or flag               | `usage: relayos checkpoint <create|list|show> [args...]`        |

---

## Designed restore semantics (not implemented in this release)

`relayos checkpoint restore <id>` is reserved as a future command. The
shape is documented now so the on-disk format is forward-compatible and
so it is clear what restore will and will not do when it ships.

**Restore will be dry-run by default.** With no flags, `restore` will
print exactly which files would change and which untracked files would
be removed, and exit `0` without touching the working tree. That output
is the same kind of artifact as the original capture: a deterministic,
inspectable preview.

**Explicit flags will be required to mutate.** Two separate gates:

- `--apply` — actually mutate the working tree. Without it, restore is
  print-only.
- `--allow-dirty` — required if the current working tree has
  uncommitted changes that conflict with the restore. Without it,
  restore refuses and exits non-zero, so you do not accidentally
  overwrite in-progress work.

Restore is being deferred to a follow-up release on purpose: this
release is scoped entirely to capture and record. The blast radius of
"we wrote bad files to your repo" is exactly zero while restore is
absent.

---

## Non-goals

- No cloud, accounts, UI/TUI, background runner, or auto-execute.
- No change to the handoff envelope schema.
- No change to `audit.jsonl` format. Checkpoint creation is **not**
  logged as a handoff audit event — checkpoints are an independent
  artifact stream.
- No MCP tool. Checkpoint is CLI-only. An MCP surface can come later if
  the operator workflow demands it.
- No git mutation. Pure observation: no `add`, no `stash`, no commits,
  no config writes.
- No automatic capture before handoffs. Capture is always an explicit
  operator action — the point is that you decide when a moment is worth
  recording.

---

## See also

- [`docs/LAUNCH.md`](./LAUNCH.md) — print the launch command for a queued handoff.
- [`docs/POLICY.md`](./POLICY.md) — the policy gate that runs on every `relayos launch`.
- [`docs/ROOKIE_MODE.md`](./ROOKIE_MODE.md) — the supported chat-only handoff workflow.
- [`README.md`](../README.md) — install, MCP wiring, full tools table.
