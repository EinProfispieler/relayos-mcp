# Operating Policy

- Human-supervised operation. Build mode is permitted only as a foreground,
  supervised, interruptible continuation loop (see below); no autonomous or
  background orchestration.
- Prefer small, verifiable changes with explicit safety checks.
- Preserve read-only defaults for overseer/runtime control-plane actions unless
  explicitly approved for a later stage.

## Step and build mode

**Allowed (build mode):**
- Foreground supervised continuation loop.
- Visible streaming progress.
- User can interrupt at any time.
- Stops at hard approval boundaries.
- Stops on test failure, uncertainty, or scope change.

**Still forbidden:**
- Daemon / background runners.
- Detached execution while the user is not watching.
- Parallel project/worktree orchestration without explicit approval.
- Autonomous commits, releases, destructive actions, production/server changes,
  credential changes, or high-cost external API usage.

## Release and git discipline

- Normal pre-v1.0 workflow: commit + push only.
- No tag or GitHub Release unless explicitly instructed.
- No force-push. No amending published commits. No `--no-verify`.

## Local data safety

Never stage or commit local runtime/coordination artifacts (`.relayos/overseer/`,
checkpoints, handoffs, reports, transcripts, scratch, audit logs).
