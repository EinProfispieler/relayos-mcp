# Contributing to RelayOS

Thanks for your interest. Before you open a PR, please read this short guide —
v0.1.x is intentionally narrow, and PRs that fall outside its scope will be
closed without review.

---

## Scope of v0.1.x

RelayOS v0.1.x supports **only** Claude Code (`claude` CLI) and Codex CLI
(`codex` CLI). The goal is a small, sharp, auditable handoff control layer
between exactly those two agents — not a general multi-agent platform.

### Please do NOT submit PRs for any of the following yet

- Support for GLM, Cursor, Gemini, OpenCode, Windsurf, or any other agent.
- General multi-agent orchestration, agent-to-agent chat, or session-level
  coordination.
- UI, TUI, dashboard, or any visual interface.
- Cross-host transport (HTTP, SSE, WebSocket). RelayOS is stdio-only in v1.
- Expansions to the MCP tool list — the seven v1 tools are the entire surface.
  If you think a new tool is needed, open an issue first.
- Renaming, restructuring, or splitting the handoff envelope schema. The schema
  is intentionally explicit and minimal; new optional fields require prior
  discussion.

Those items are tracked under "Future Pro / Team" in the README and are
deliberately out of scope for this repository.

---

## Open an issue before large design changes

If your change touches any of the following, please open an issue first and
agree on the approach before opening a PR:

- The handoff envelope schema (`src/schema.ts`).
- The audit event vocabulary (the `AuditEventKind` enum).
- The on-disk storage layout (`$HANDOFF_DIR/audit.jsonl`,
  `$HANDOFF_DIR/envelopes/{id}.json`, log files).
- The MCP tool surface (names, inputs, return shapes).
- Native CLI flag mappings in `src/render/claude.ts` or `src/render/codex.ts`
  (especially anything that changes the safety posture, e.g. sandbox mode).
- The spawn flow in `src/spawn/index.ts`.

Small, well-scoped changes (bug fixes, typo fixes, additional test coverage,
clearer error messages) are welcome without a prior issue.

---

## Tests are required

Any change to the following must come with tests:

- **Schema** — `src/schema.ts` → `tests/schema.test.ts`
- **Storage / envelope** — `src/storage.ts`, `src/envelope.ts` → `tests/envelope.test.ts`
- **Audit log** — `src/audit.ts` → `tests/audit.test.ts`
- **Renderers** — `src/render/**` → `tests/render.test.ts`
- **Spawn behavior** — `src/spawn/**` → `tests/spawn.test.ts`
- **MCP tools** — `src/tools/**` and `src/index.ts` → `tests/tools.test.ts`

Run the full suite before pushing:

```bash
npm install
npm run typecheck
npm test
npm run build
```

All 43 tests should pass and `dist/index.js` should build cleanly. CI will
reject PRs that don't.

---

## Code style

- TypeScript strict mode (`tsconfig.json` is the source of truth).
- Prefer explicit types on exports; let inference do the rest.
- Keep modules small and single-purpose. The current `src/` layout reflects
  this — please don't fold unrelated concerns together.
- No new dependencies without a clear justification in the PR description.
- No comments that restate what the code does. Reserve comments for the
  non-obvious *why*.

---

## Security boundary (please read)

**RelayOS v0.1.x is advisory-first. It is not, and does not claim to be, a
hard filesystem sandbox.**

What that means in practice:

- `allowed_files` and `forbidden_files` are always injected into the target
  agent's prompt and always recorded in the audit log. They rely on the target
  agent honoring the instruction.
- Where the target CLI exposes a native flag that approximates the
  constraint (e.g. Codex's `--sandbox`, Claude's `--permission-mode`),
  RelayOS uses it as best-effort defense in depth. These are noted in the
  audit log when active.
- RelayOS does **not** intercept syscalls, sandbox file I/O, run targets in
  containers, or otherwise prevent a misbehaving (or malicious) target from
  reading or writing files outside its declared scope.

Treat the envelope as a structured, auditable record of *intent and scope*,
not as an enforcement boundary. If you have a use case that needs hard
isolation, run the target in a sandbox of your own choosing (container, jail,
seccomp, etc.) and use RelayOS to record the handoff inside it.

Security-relevant PRs are very welcome, but please open an issue first so we
can discuss the threat model before code is written.

---

## How to submit a PR

1. Fork and create a feature branch.
2. Make the smallest possible change for one logical unit of work.
3. Add or update tests in the appropriate `tests/*.test.ts` file.
4. Run `npm run typecheck && npm test && npm run build` locally; confirm green.
5. Open the PR with a description that explains the *why*, links any related
   issue, and notes any audit-log or schema impact.

Thank you for keeping v0.1.x small and sharp.
