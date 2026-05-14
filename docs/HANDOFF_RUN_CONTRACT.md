# RelayOS Handoff Run Completion Contract (Future Design)

Status: Future design contract only. This document does not describe currently shipped runner/daemon behavior.

## 1) Scope and Status

This document defines a future contract for how RelayOS may detect handoff run completion and failure states for Rookie Mode and scoped overseer runtime workflows.

It is a design-direction contract, not an implementation claim. It does not imply current queue, runner, daemon, or runtime activation support.

## 2) Why Chat "Done" Is Insufficient

RelayOS should not rely only on UI text or chat replies such as "done" to mark work complete.

Natural-language completion messages can be ambiguous, incomplete, or detached from objective evidence. Future run lifecycle detection should require structured completion evidence so outcomes are auditable and reviewable.

## 3) Canonical Run States

Future run lifecycle should support these canonical states:

- queued
- assigned
- running
- waiting_for_agent
- completed
- needs_review
- approved
- rejected
- needs_changes
- blocked
- timeout
- failed
- cancelled
- stale
- unknown

These states are directional contract terms for future runtime behavior and should not be interpreted as currently implemented lifecycle transitions.

## 4) Future Structured Run Result Payload

Future completion reporting should produce a structured run result payload. Suggested fields:

- run_id
- status
- agent
- started_at
- completed_at
- summary
- files_changed
- tests_run
- test_result
- blockers
- needs_review
- requires_user_approval

Notes:

- `status` should map to canonical run states.
- `files_changed` should summarize file-scope impact without requiring raw transcript replay.
- `tests_run` and `test_result` should capture verification evidence when relevant.
- `requires_user_approval` should explicitly flag high-risk actions.

## 5) Completion Detection Methods (Preferred Order)

Future completion detection should prefer structured signals in this order:

1. Explicit MCP/CLI completion signal.
2. Result artifact (for example, `status.json` or equivalent run result file).
3. Heartbeat/progress notes (including local overseer timeline updates).
4. Subprocess exit code, when RelayOS is the process launcher in a future scoped runtime.
5. Git diff and test evidence checks.
6. Timeout/staleness watchdog fallback.

This order reduces false positives from chat text while preserving fallback paths when explicit structured signals are unavailable.

## 6) Minimal Evidence Expectations by State

Future runtime detection should require minimum evidence for terminal/critical states:

### completed

- Structured result payload with `status=completed`.
- Non-empty summary of what was done.
- Evidence references for file changes and/or no-change confirmation.
- Test evidence when tests were expected by scope.

### failed

- Structured result payload with `status=failed`.
- Failure summary and blocker detail.
- Error/evidence pointer (command/test/diff context) sufficient for review.

### blocked

- Structured result payload with `status=blocked`.
- Clear blocker reason and required external/user action.
- Explicit indication that scope execution could not continue safely.

### timeout

- Timeout/staleness marker with last known heartbeat/progress timestamp.
- Last known run state and pending step, if available.
- Recommendation for operator follow-up (review/retry/cancel).

### needs_review

- Structured result payload with `status=needs_review`.
- Review reason and concise summary of work/output.
- Evidence pointers (diff/tests/notes) enabling human decision.

## 7) Review and Approval Gates

High-risk actions must remain explicit human approval only:

- commit
- push
- tag
- release
- deletion
- schema changes
- runtime activation
- provider/API configuration

A run reaching `completed` or `needs_review` should not be interpreted as implicit approval for high-risk actions.

## 8) Relationship to Current Core

Current RelayOS Core already provides relevant building blocks:

- handoff envelopes
- audit/checkpoint/report tooling
- MCP overseer handshake/recent/note/context-pack surface
- local timeline notes for continuity evidence

Current Core does not yet implement full run-lifecycle orchestration, completion-state transitions, watchdogs, or automatic execution management.

## 9) Non-Goals for Current Slice

This contract does not implement or claim current support for:

- queue/runner/daemon behavior
- runtime activation or autonomous loop execution
- storage/envelope/audit schema changes
- automatic agent execution
- provider/network/API integration
- security sandbox guarantees

## Summary

RelayOS future run completion detection should be evidence-first, structured, and human-supervised. The contract should favor explicit machine-readable completion signals, use watchdog fallback when needed, and preserve strict approval gates for high-risk actions.
