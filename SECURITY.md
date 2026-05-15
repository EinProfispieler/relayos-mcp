# Security Policy

## Scope and posture

**RelayOS v0.1.x is advisory-first. It is not a security boundary.**

RelayOS records and renders structured handoff envelopes between Claude Code
and Codex CLI. It does not sandbox the target agent, intercept its file I/O,
restrict its network access, or otherwise constrain what the target can do
once it has been launched.

In particular:

- `allowed_files` and `forbidden_files` are **always injected into the target
  agent's prompt** and **always recorded in the audit log**. They depend on
  the target agent honoring the instruction. A misbehaving, prompt-injected,
  or otherwise compromised target can ignore them.
- Native CLI restrictions (Codex's `--sandbox`, Claude's `--permission-mode`,
  `--allowed-tools`, etc.) are applied **best-effort, only when the target
  CLI directly supports them**. They are defense in depth, not a guarantee.
  Their exact behavior is determined by the target CLI, not by RelayOS.
- RelayOS does **not** run the target inside a container, jail, seccomp
  profile, chroot, or any other isolation primitive. The target inherits the
  environment of the process that ran the MCP server.
- The audit log is for accountability and reconstruction. It is **not** a
  prevention mechanism.

**Do not treat RelayOS v0.1.x as a security boundary.** If you need hard
isolation for a handoff, run the target inside a sandbox of your own choosing
(container, VM, jail, seccomp, etc.) and use RelayOS to record the handoff
metadata inside it.

## Secrets handling — please read

The handoff envelope, the JSONL audit log, captured stdout/stderr log files,
and any GitHub issue or bug report attached to them are **plain text on disk
or in public infrastructure**. Do not put secrets into any of them.

Specifically, do not include in `task_description`, `expected_output`,
`constraints`, `allowed_files`, `forbidden_files`, `audit_metadata.tags`, the
working-directory contents the spawned target prints to stdout, or any issue
filed against RelayOS:

- API keys, OAuth tokens, session tokens, JWTs
- Database connection strings or passwords
- Private keys, certificates, SSH keys
- Personally identifying information about real users
- Customer data, internal hostnames, internal URLs, or any other
  confidential business data

If you need to point a handoff at a file that contains secrets, **reference
the path in `forbidden_files`** so the target is instructed never to read or
echo it. Even then, treat that as advice to the target, not enforcement.

If you discover that a secret has been written to your local
`$HANDOFF_DIR/` (default `~/.claude/handoff/`), rotate the secret and delete
the relevant envelope and log files. The on-disk format is documented in the
README so you can grep and clean up confidently.

## Privacy boundary (current Core)

RelayOS Core is local-first. Current Core does not provide cloud sync and does not include telemetry by default.

RelayOS Core does not collect or transmit to a RelayOS-operated service by default:

- source code
- prompts
- AI outputs
- diffs
- file paths
- Git remote URLs
- API keys
- command output

If future paid/cloud/enterprise services are introduced, they will require separate notice and explicit consent.

## Reporting a vulnerability

There is no private security mailing address for this project yet.

If you believe you have found a security-relevant issue in RelayOS, please
**open a minimal GitHub issue** that:

- Describes the class of issue and the affected file or behavior.
- **Does not include any secrets, real credentials, real customer data, or
  production audit logs.** Sanitize any pasted excerpts.
- **Does not include a working exploit payload** if the issue could be used
  to compromise other users running RelayOS. A high-level description is
  enough to start the conversation.

We will follow up in the issue thread and, if a private channel becomes
appropriate, ask you to move there. A private security contact will be added
to this file once one exists.

Thank you for helping keep RelayOS safe.

## Legal note

This document is informational and not legal advice. Review with qualified counsel before commercial launch.
