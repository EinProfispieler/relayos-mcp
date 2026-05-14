# RelayOS References

Conceptual context for RelayOS: what it borrows from adjacent tools, where it diverges, and where future interoperability could make sense.

---

## OpenSpec

OpenSpec is a spec-driven development workflow. It structures AI-assisted work as a pipeline of proposals, tasks, and specs — each step produces a small, reviewable artifact before any code is written. The operator reviews and approves at each gate, so the AI never runs ahead of the plan.

**Useful ideas RelayOS may borrow:**

- **Proposal/task/spec separation.** Breaking intent into a proposal (why), a task (what), and a spec (how) reduces ambiguity at handoff time. RelayOS handoff envelopes already encode a subset of this (`task_title`, `task_description`, `expected_output`, `constraints`), but a more structured pre-handoff spec artifact could improve traceability.
- **Change intent as a first-class artifact.** OpenSpec treats the intent behind a change as something worth recording, not just the diff. RelayOS records the envelope (intent) alongside the checkpoint (state) and the audit log (events) — the combination approaches this, but the intent artifact is not yet human-readable in isolation.
- **Structured review gates.** OpenSpec's proposal review step maps naturally to a RelayOS policy gate: both ask "is this safe to proceed?" before the agent acts.

**Where RelayOS differs:**

OpenSpec is a planning and spec workflow — it structures how work gets proposed, scoped, and approved. RelayOS operates one layer down: it is a local control and evidence layer. Once a task is approved and handed off, RelayOS takes over: it enforces policy, snapshots state, classifies diff risk, and provides a recovery path. The two tools are complementary rather than competing.

---

## Superpowers (obra/superpowers)

Superpowers is an agent methodology framework distributed as Claude skills. It gives Claude reusable, structured approaches for common development workflows: brainstorming, planning, TDD, debugging, frontend design, and more. Each skill encodes a tested methodology that Claude can invoke at session start or on demand.

**Useful ideas RelayOS may borrow:**

- **Reusable agent methods.** Superpowers skills are small, composable methodologies that agents invoke explicitly. RelayOS templates serve a similar role for *task routing* (which model, effort, scope), but a methodology layer — "how should Codex approach this patch?" — is currently out of scope. This could become a `methodology` field in the handoff envelope or a companion skill library.
- **Session startup context.** Superpowers encourages agents to load relevant skills before responding. RelayOS's `overseer brief` command is the local-first equivalent: it gives a fresh Claude or Codex worker full project context (state, policy, forbidden actions, active branch) at session start without relying on chat history.
- **Role-specific workflows.** Superpowers differentiates workflows by role (architect, reviewer, implementer). RelayOS templates differentiate by execution mode (`plan`, `patch`, `review`, `test`) and target agent (Claude, Codex), which partially maps to this idea.

**Where RelayOS differs:**

Superpowers teaches agents how to work — it shapes agent behavior through methodology. RelayOS constrains, records, checks, and recovers AI-assisted work — it shapes the operator's control of agents. Superpowers is agent-internal; RelayOS is operator-external. A useful mental model: Superpowers is the agent's training; RelayOS is the safety harness around the agent.

---

## RelayOS positioning

RelayOS is a **local-first AI-assisted development control layer**. It sits between the human operator and the AI agents, enforcing policy and preserving evidence without any cloud dependency, background runner, or account requirement.

### Core / Solo (shipped)

| Feature | Purpose |
|---|---|
| Handoff envelopes | Validated task envelopes with model, effort, scope, constraints |
| Templates + quick handoff | Six built-in templates; one-shot handoff from a task string |
| `relayos launch` | Print-only: the exact `codex exec` / `claude -p` command |
| Rookie Mode risk gate | Chat-only workflow with allow/warn/block gates before launch |
| Policy gates | Envelope-level allow/warn/block before any agent runs |
| `relayos checkpoint` | Snapshot HEAD + status + diff + untracked before risky changes |
| `relayos checkpoint restore --dry-run` | Read-only rollback plan from a checkpoint; `--apply` reserved |
| `relayos diff-risk` | Classify the working tree before `git commit` |
| `relayos report` | Compact evidence snapshot: handoff + checkpoint + diff-risk + git |
| `relayos overseer` | Local coordination workspace: notes, next-action, branch/progress context, startup brief |

### Team / Enterprise (future, not in this repo)

These require a server component and are out of scope for the OSS core. No timeline is set.

- Internal web panel / dashboard
- Audit timeline with visual evidence review
- Rollback center (revert to last checkpoint)
- Approval queue (human-in-the-loop gate before launch)
- Risk dashboard (aggregate diff-risk + policy across agents)
- Policy management UI
- Agent registry
- Multi-repo support

---

## Future interoperability ideas

These are design sketches, not commitments. No dependencies will be added without an explicit product decision.

**OpenSpec interoperability:**
- RelayOS could optionally read an OpenSpec-style proposal or task file from the project and surface its fields (intent, scope, acceptance criteria) as a pre-populated handoff envelope. The operator would still review and approve before launch.
- The `overseer init-context` scaffold could include a `planned/` directory with stub proposal/task templates compatible with OpenSpec conventions.

**Superpowers interoperability:**
- RelayOS Rookie Mode flows could optionally map to named Superpowers skills, so the orchestrator agent can invoke the right methodology alongside the right handoff template.
- A `methodology` field could be added to the handoff envelope (additive, optional) and used by the Codex AGENTS.md or Claude subagent prompt to select the appropriate Superpowers workflow.
- The `overseer brief` output is already structurally similar to a Superpowers session-start skill — a future `--format skills` flag could emit output compatible with the Superpowers skill loader.

In all cases, the guiding constraint remains: RelayOS is local-first, additive, and does not auto-execute. Any interoperability is opt-in and operator-approved.

---

## See also

- [`docs/ROOKIE_MODE.md`](ROOKIE_MODE.md) — the chat-only workflow and risk gate
- [`docs/CHECKPOINTS.md`](CHECKPOINTS.md) — checkpoint capture and restore dry-run
- [`docs/DIFF_RISK.md`](DIFF_RISK.md) — working-tree risk classification
- [`docs/OVERSEER.md`](OVERSEER.md) — local coordination workspace and startup brief
- [`README.md`](../README.md) — install, MCP wiring, full tools table
