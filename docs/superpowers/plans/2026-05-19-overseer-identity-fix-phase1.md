# Overseer Identity Fix (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the RelayOS Overseer reliably understand its own identity on every conversation turn by injecting a canonical role document and a fixed 4-layer context bundle into both CLI and API provider paths.

**Architecture:** Commit `1efdf10` already injects an inline identity block via `buildOverseerContext` in `src/conversation.ts`. Phase 1 extracts that identity into a tracked product source (`src/overseer/role.ts`), adds bundled policy templates, and restructures `buildOverseerContext` into `buildOverseerContextBundle` — a fixed 4-layer load (identity → policy → project → recent truth). It also renames the `relays` binary to `overseer` with `relays` kept as an alias. No storage-model changes (that is Phase 2); Layer 2/3 read the existing `.relayos/overseer/` directory.

**Tech Stack:** TypeScript (Node, ESM, `.js` import extensions), `vitest` test runner, POSIX `sh` bin scripts, `tsup` build.

**Spec:** `docs/superpowers/specs/2026-05-19-overseer-system-design.md` — this plan implements §15 "Phase 1" (and the parts of §3, §4, §6, §9.2 it depends on).

---

## Background an implementer needs

- `src/conversation.ts` (899 lines) is the conversation engine. Key existing functions:
  - `buildOverseerContext(projectRoot)` (lines ~801–857): builds the identity+context text block. Identity text is **hardcoded inline** in a `parts` array (lines ~821–838).
  - `loadOverseerFile(overseerDir, name, maxLines = 40)` (lines ~757–767): reads a file from `.relayos/overseer/`, truncates by **line count**, returns `null` if missing.
  - `loadOverseerJsonlTail(...)` (lines ~772–794): reads the last N JSONL records.
  - `buildScopedProviderInput(projectRoot, userMessage)` (lines ~859–899): CLI/`subscription_cli` provider path — calls `buildOverseerContext`, then appends an `=== OPERATING INSTRUCTIONS ===` block and `USER MESSAGE:`.
  - `runApiProvider(cfg, scope, messages, providerLabel)` (lines ~128–...): API provider path — calls `buildOverseerContext` (line ~144) to build the `systemPrompt`.
- Both provider paths already call `buildOverseerContext`. Phase 1 renames that function to `buildOverseerContextBundle`; both call sites must be updated in the same task or `tsc` fails.
- `.relayos/overseer/` already exists in this repo and contains runtime files: `OPERATING_POLICY.md`, `FORBIDDEN_ACTIONS.md`, `MODEL_POLICY.md`, `PROJECT_BRIEF.md`, `CURRENT_STATE.md`, `NEXT_ACTION.md`, JSONL logs. It is **gitignored** — never stage anything under `.relayos/`.
- `tests/conversation_provider_boundary.test.ts` exercises `handleConversation` with a fake provider that echoes `{{input}}`. Its assertions check the `=== OPERATING INSTRUCTIONS ===` block — Phase 1 does not change that block, so those tests stay green.
- `src/overseer.ts` is an unrelated existing **file**. Creating the `src/overseer/` **directory** alongside it is intentional and supported by Node/TS module resolution.
- Run the test suite with `npm test` (vitest). Typecheck with `npm run typecheck`.
- This repo's policy: commit only, never push/tag, never `--no-verify`. Per-task commits below are expected and authorized by plan approval.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `src/overseer/role.ts` | Exports `OVERSEER_ROLE_TEXT` — the canonical Overseer identity string. The single source of truth injected as context Layer 1. | Create |
| `docs/OVERSEER_ROLE.md` | Human-readable reference copy of the role document. | Create |
| `src/overseer/templates/OPERATING_POLICY.md` | Product policy template — operating policy with the §3 reconciled build-mode wording. | Create |
| `src/overseer/templates/FORBIDDEN_ACTIONS.md` | Product policy template — forbidden actions, with "no breaking format changes" refinement. | Create |
| `src/overseer/templates/MODEL_POLICY.md` | Product policy template — model selection policy. | Create |
| `src/conversation.ts` | `buildOverseerContext` → `buildOverseerContextBundle`: 4-layer load; `loadOverseerFile` switches to a byte cap. | Modify |
| `bin/overseer` | The primary RTUI/CLI launcher (renamed from `bin/relays`). | Rename |
| `bin/relays` | Thin forwarder to `bin/overseer` (transition alias). | Replace |
| `package.json` | Add `overseer` bin entry; keep `relays`. | Modify |
| `docs/OVERSEER_WORKFLOW.md` | Add a "Step and build mode" section reflecting §3. | Modify |
| `docs/OVERSEER.md` | Refine the "Non-goals" line to distinguish supervised build mode from a daemon. | Modify |
| `tests/overseer_role.test.ts` | Tests the role constant. | Create |
| `tests/overseer_templates.test.ts` | Tests the policy templates. | Create |
| `tests/overseer_context_bundle.test.ts` | Tests the 4-layer bundle via `handleConversation`. | Create |
| `tests/bin_overseer.test.ts` | Tests the bin entries and files. | Create |

---

## Task 1: Canonical Overseer role document

**Files:**
- Create: `src/overseer/role.ts`
- Create: `docs/OVERSEER_ROLE.md`
- Test: `tests/overseer_role.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/overseer_role.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { OVERSEER_ROLE_TEXT } from "../src/overseer/role.js";

describe("OVERSEER_ROLE_TEXT", () => {
  it("is a non-empty identity string", () => {
    expect(typeof OVERSEER_ROLE_TEXT).toBe("string");
    expect(OVERSEER_ROLE_TEXT.trim().length).toBeGreaterThan(200);
  });

  it("names the Overseer and its coordinating role", () => {
    expect(OVERSEER_ROLE_TEXT).toContain("RelayOS Overseer");
    expect(OVERSEER_ROLE_TEXT).toContain("coordinator");
  });

  it("defines the core vocabulary", () => {
    for (const term of ["HANDOFF", "AUDIT", "CHECKPOINT", "EVENT LOG", "PROJECTED STATE"]) {
      expect(OVERSEER_ROLE_TEXT).toContain(term);
    }
  });

  it("defines step mode and build mode", () => {
    expect(OVERSEER_ROLE_TEXT).toContain("STEP MODE");
    expect(OVERSEER_ROLE_TEXT).toContain("BUILD MODE");
  });

  it("states the hard approval boundaries", () => {
    expect(OVERSEER_ROLE_TEXT).toContain("HARD APPROVAL BOUNDARY");
    expect(OVERSEER_ROLE_TEXT).toContain("explicit user approval");
    expect(OVERSEER_ROLE_TEXT).toContain("no background runner");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/overseer_role.test.ts`
Expected: FAIL — cannot resolve `../src/overseer/role.js`.

- [ ] **Step 3: Create the role module**

Create `src/overseer/role.ts`:

```typescript
/**
 * Canonical RelayOS Overseer identity.
 *
 * This is the single source of truth for who the Overseer is. It is injected
 * verbatim as context Layer 1 on every conversation turn (see
 * `buildOverseerContextBundle` in src/conversation.ts) so the configured
 * provider — any model — understands its role and vocabulary.
 *
 * `docs/OVERSEER_ROLE.md` is a human-readable copy kept in sync with this text.
 */
export const OVERSEER_ROLE_TEXT = [
  "=== RELAYOS OVERSEER — ROLE & IDENTITY ===",
  "You are the RelayOS Overseer: the persistent AI coordinator for one software",
  "project. You talk with the developer, understand intent, plan work, and",
  "delegate execution to AI coding agents through handoffs. You review the",
  "evidence those agents produce. In most sessions you do not write code",
  "yourself — your job is coordination, scoping, and review.",
  "",
  "GLOSSARY — answer questions about these accurately:",
  "- HANDOFF: a structured unit of delegated work, recorded as a HANDOFF",
  "  ENVELOPE — JSON with an id (h_…), the target agent, an execution mode, a",
  "  task description, allowed/forbidden files, constraints, and expected",
  "  output. Creating a handoff is safe and side-effect-free; it only runs when",
  "  the user approves it.",
  "- AUDIT / AUDIT LOG: the immutable, append-only history of what happened —",
  "  conversation turns, decisions, handoff results, verifications. It is the",
  "  ground truth used for review and rollback.",
  "- EVENT LOG: the append-only logs the engine writes automatically; the",
  "  audit log is built from them.",
  "- PROJECTED STATE: human-readable working-memory files (CURRENT_STATE, TODO,",
  "  DECISIONS, HANDOFFS) derived from the event logs.",
  "- CHECKPOINT: a saved snapshot of projected state, used to roll working",
  "  memory back. Rolling code back is Git's job, not a checkpoint's.",
  "- AGENTS: codex = implementation (patches, tests, refactors); claude =",
  "  review, planning, analysis, explanation, docs; overseer (you) =",
  "  coordinate, discuss, plan, create handoffs, record decisions.",
  "- EXECUTION MODE: patch | plan | review | test — what a handoff's agent may do.",
  "- STEP MODE (default): one handoff per turn; the user must approve each one",
  "  before it runs.",
  "- BUILD MODE (opt-in): after one approval you continue through the task",
  "  list — but only as a foreground, supervised, interruptible loop that the",
  "  user is watching.",
  "- HARD APPROVAL BOUNDARY: an action that always requires explicit user",
  "  approval, in any mode.",
  "",
  "OPERATING LOOP:",
  "read state -> plan -> create handoff -> (user approval) -> execute ->",
  "read result -> verify/test -> record -> refresh projected state -> next.",
  "",
  "HARD BOUNDARIES — never do any of these without explicit user approval, in",
  "any mode: commit, release, tag, push, merge, destructive file operations,",
  "migrations, production/server changes, credential changes, high-cost",
  "external API usage. Stop and hand control back to the user on a failed",
  "test or verification, on high uncertainty, or when the task's scope",
  "changes. Never run unattended: no daemon, no background runner, no detached",
  "execution while the user is not watching.",
].join("\n");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/overseer_role.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Create the human-readable reference doc**

Create `docs/OVERSEER_ROLE.md`:

```markdown
# RelayOS Overseer — Role & Identity

> **Canonical source:** `src/overseer/role.ts` (`OVERSEER_ROLE_TEXT`). The engine
> injects that constant as context Layer 1 on every conversation turn. This
> document is the human-readable copy — keep the two in sync when either changes.

You are the RelayOS Overseer: the persistent AI coordinator for one software
project. You talk with the developer, understand intent, plan work, and delegate
execution to AI coding agents through handoffs. You review the evidence those
agents produce. In most sessions you do not write code yourself — your job is
coordination, scoping, and review.

## Glossary

- **Handoff** — a structured unit of delegated work, recorded as a **handoff
  envelope**: JSON with an id (`h_…`), the target agent, an execution mode, a
  task description, allowed/forbidden files, constraints, and expected output.
  Creating a handoff is safe and side-effect-free; it runs only when the user
  approves it.
- **Audit / audit log** — the immutable, append-only history of what happened:
  conversation turns, decisions, handoff results, verifications. Ground truth
  for review and rollback.
- **Event log** — the append-only logs the engine writes automatically; the
  audit log is built from them.
- **Projected state** — human-readable working-memory files (`CURRENT_STATE`,
  `TODO`, `DECISIONS`, `HANDOFFS`) derived from the event logs.
- **Checkpoint** — a saved snapshot of projected state, used to roll working
  memory back. Rolling code back is Git's job.
- **Agents** — `codex` = implementation (patches, tests, refactors); `claude` =
  review, planning, analysis, explanation, docs; `overseer` (you) = coordinate,
  discuss, plan, create handoffs, record decisions.
- **Execution mode** — `patch | plan | review | test`: what a handoff's agent
  may do.
- **Step mode** (default) — one handoff per turn; the user approves each one.
- **Build mode** (opt-in) — after one approval you continue through the task
  list, but only as a foreground, supervised, interruptible loop the user is
  watching.
- **Hard approval boundary** — an action that always requires explicit user
  approval, in any mode.

## Operating loop

read state → plan → create handoff → (user approval) → execute → read result →
verify/test → record → refresh projected state → next.

## Hard boundaries

Never do any of these without explicit user approval, in any mode: commit,
release, tag, push, merge, destructive file operations, migrations,
production/server changes, credential changes, high-cost external API usage.

Stop and hand control back to the user on a failed test or verification, on high
uncertainty, or when the task's scope changes.

Never run unattended: no daemon, no background runner, no detached execution
while the user is not watching.
```

- [ ] **Step 6: Commit**

```bash
git add src/overseer/role.ts docs/OVERSEER_ROLE.md tests/overseer_role.test.ts
git commit -m "feat: add canonical OVERSEER_ROLE_TEXT identity constant"
```

---

## Task 2: Bundled product policy templates

**Files:**
- Create: `src/overseer/templates/OPERATING_POLICY.md`
- Create: `src/overseer/templates/FORBIDDEN_ACTIONS.md`
- Create: `src/overseer/templates/MODEL_POLICY.md`
- Test: `tests/overseer_templates.test.ts`

These are **product source of truth** for policy (spec §9.2). A project's runtime
`.relayos/overseer/*.md` copies are generated from them; the runtime copies are
not authoritative.

- [ ] **Step 1: Write the failing test**

Create `tests/overseer_templates.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATES = join(__dirname, "..", "src", "overseer", "templates");

function read(name: string): string {
  return readFileSync(join(TEMPLATES, name), "utf8");
}

describe("overseer policy templates", () => {
  it("OPERATING_POLICY allows supervised build-mode continuation", () => {
    const text = read("OPERATING_POLICY.md");
    expect(text).toContain("Foreground supervised continuation loop");
    expect(text).toContain("User can interrupt at any time");
  });

  it("OPERATING_POLICY still forbids daemons and detached runners", () => {
    const text = read("OPERATING_POLICY.md");
    expect(text).toContain("Daemon / background runners");
    expect(text).toContain("Detached execution while the user is not watching");
  });

  it("FORBIDDEN_ACTIONS permits additive optional fields", () => {
    const text = read("FORBIDDEN_ACTIONS.md");
    expect(text).toContain("no breaking format changes");
    expect(text).toContain("additive optional fields");
  });

  it("MODEL_POLICY names the model-selection priority", () => {
    const text = read("MODEL_POLICY.md");
    expect(text.trim().length).toBeGreaterThan(50);
    expect(text.toLowerCase()).toContain("effort");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/overseer_templates.test.ts`
Expected: FAIL — `ENOENT` reading `src/overseer/templates/OPERATING_POLICY.md`.

- [ ] **Step 3: Create `src/overseer/templates/OPERATING_POLICY.md`**

```markdown
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
```

- [ ] **Step 4: Create `src/overseer/templates/FORBIDDEN_ACTIONS.md`**

```markdown
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
```

- [ ] **Step 5: Create `src/overseer/templates/MODEL_POLICY.md`**

```markdown
# Model Policy

- Use `gpt-5.3-codex` with `medium` effort for narrow repo edits/tests/docs.
- Use `gpt-5.5` or stronger for architecture/release/security/product judgment.
- Prioritize correctness and safety over token saving.
- Choose `effort` to match task risk: escalate effort for auth, payment,
  secrets-adjacent, CI/CD, or storage-format work; never downgrade to save cost.
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/overseer_templates.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 7: Refresh this repo's local runtime policy copies (NOT committed)**

The dev repo's Overseer reads runtime copies from `.relayos/overseer/`. Refresh
them so this repo benefits immediately. `.relayos/` is gitignored — do **not**
stage these.

```bash
cp src/overseer/templates/OPERATING_POLICY.md  .relayos/overseer/OPERATING_POLICY.md
cp src/overseer/templates/FORBIDDEN_ACTIONS.md .relayos/overseer/FORBIDDEN_ACTIONS.md
cp src/overseer/templates/MODEL_POLICY.md      .relayos/overseer/MODEL_POLICY.md
git status --short .relayos/   # expect: no output (gitignored)
```

- [ ] **Step 8: Commit**

```bash
git add src/overseer/templates/ tests/overseer_templates.test.ts
git commit -m "feat: add bundled overseer policy templates with reconciled build-mode wording"
```

---

## Task 3: `buildOverseerContextBundle` — the 4-layer context load

**Files:**
- Modify: `src/conversation.ts` — `loadOverseerFile` (~lines 757–767), `buildOverseerContext` (~lines 801–857), call sites in `runApiProvider` (~line 144) and `buildScopedProviderInput` (~line 860).
- Test: `tests/overseer_context_bundle.test.ts`

The bundle is the fixed ordered load: **Layer 1** identity (`OVERSEER_ROLE_TEXT`),
**Layer 2** policy (`OPERATING_POLICY.md`, `FORBIDDEN_ACTIONS.md`,
`MODEL_POLICY.md`), **Layer 3** project (`PROJECT_BRIEF.md`, `CURRENT_STATE.md`,
`TODO.md`, `NEXT_ACTION.md`), **Layer 4** recent truth (decisions, timeline,
handoff results). Layers 2/3 read the existing `.relayos/overseer/` directory —
no storage-model change (that is Phase 2).

- [ ] **Step 1: Write the failing test**

Create `tests/overseer_context_bundle.test.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleConversation, type ConversationMessage } from "../src/conversation.js";
import { RelayConfig } from "../src/schema.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "relayos-bundle-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeOverseerFile(projectRoot: string, name: string, content: string): void {
  const dir = join(projectRoot, ".relayos", "overseer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, "utf8");
}

// Fake provider: a node -e script that echoes argv[1] (the {{input}}), so the
// reply equals the full scoped provider input — bundle included.
function echoConfig() {
  return RelayConfig.parse({
    overseer: {
      provider: {
        name: "fake", kind: "subscription_cli", model: "fake-model",
        effort: "medium", execution_mode: "subscription_cli",
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.argv[1] ?? '')", "{{input}}"],
        timeout_ms: 10000,
      },
    },
  });
}

async function turn(projectRoot: string): Promise<string> {
  const messages: ConversationMessage[] = [{ role: "user", content: "hello" }];
  const result = await handleConversation(messages, echoConfig(), { projectRoot });
  return result.reply;
}

describe("buildOverseerContextBundle (4-layer)", () => {
  it("Layer 1 — always injects the Overseer identity", async () => {
    const reply = await turn(tempProject());
    expect(reply).toContain("RELAYOS OVERSEER — ROLE & IDENTITY");
    expect(reply).toContain("HANDOFF");
  });

  it("Layer 2 — includes policy files when present", async () => {
    const root = tempProject();
    writeOverseerFile(root, "OPERATING_POLICY.md", "POLICY-MARKER-A");
    writeOverseerFile(root, "FORBIDDEN_ACTIONS.md", "FORBIDDEN-MARKER-B");
    const reply = await turn(root);
    expect(reply).toContain("=== OPERATING POLICY ===");
    expect(reply).toContain("POLICY-MARKER-A");
    expect(reply).toContain("=== FORBIDDEN ACTIONS ===");
    expect(reply).toContain("FORBIDDEN-MARKER-B");
  });

  it("Layer 2 — omits policy sections gracefully when files are absent", async () => {
    const reply = await turn(tempProject());
    expect(reply).not.toContain("=== OPERATING POLICY ===");
    expect(reply).toContain("RELAYOS OVERSEER — ROLE & IDENTITY"); // identity still present
  });

  it("Layer 3 — includes TODO and NEXT_ACTION when present", async () => {
    const root = tempProject();
    writeOverseerFile(root, "TODO.md", "TODO-MARKER-C");
    writeOverseerFile(root, "NEXT_ACTION.md", "NEXT-MARKER-D");
    const reply = await turn(root);
    expect(reply).toContain("=== TODO ===");
    expect(reply).toContain("TODO-MARKER-C");
    expect(reply).toContain("=== NEXT ACTION ===");
    expect(reply).toContain("NEXT-MARKER-D");
  });

  it("layer order — identity precedes policy precedes project", async () => {
    const root = tempProject();
    writeOverseerFile(root, "OPERATING_POLICY.md", "POLICY-MARKER-A");
    writeOverseerFile(root, "PROJECT_BRIEF.md", "BRIEF-MARKER-E");
    const reply = await turn(root);
    const idIdx = reply.indexOf("RELAYOS OVERSEER — ROLE & IDENTITY");
    const policyIdx = reply.indexOf("=== OPERATING POLICY ===");
    const briefIdx = reply.indexOf("=== PROJECT BRIEF ===");
    expect(idIdx).toBeGreaterThanOrEqual(0);
    expect(policyIdx).toBeGreaterThan(idIdx);
    expect(briefIdx).toBeGreaterThan(policyIdx);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/overseer_context_bundle.test.ts`
Expected: FAIL — replies lack `=== OPERATING POLICY ===` / `=== TODO ===` and the
identity header still reads `IDENTITY & CONTEXT`, not `ROLE & IDENTITY`.

- [ ] **Step 3: Change `loadOverseerFile` to a byte cap**

In `src/conversation.ts`, replace the `loadOverseerFile` function **and its doc
comment** (~lines 753–767) with this — it now caps by character count (a soft
byte bound, spec §6.2) instead of line count:

```typescript
/**
 * Load a text file from the overseer dir, capping at `maxChars` characters
 * (a soft byte bound). Returns null when the file is missing or unreadable.
 */
async function loadOverseerFile(overseerDir: string, name: string, maxChars: number): Promise<string | null> {
  try {
    const content = (await readFile(join(overseerDir, name), "utf8")).trim();
    return content.length > maxChars
      ? content.slice(0, maxChars) + "\n[…truncated]"
      : content;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Replace `buildOverseerContext` with `buildOverseerContextBundle`**

In `src/conversation.ts`, replace the `buildOverseerContext` function **and its
doc comment** (~lines 796–857) with:

```typescript
/**
 * Build the fixed 4-layer Overseer context bundle prepended to every
 * conversation turn:
 *   Layer 1 — identity (OVERSEER_ROLE_TEXT, a tracked product constant)
 *   Layer 2 — policy   (OPERATING_POLICY / FORBIDDEN_ACTIONS / MODEL_POLICY)
 *   Layer 3 — project  (PROJECT_BRIEF / CURRENT_STATE / TODO / NEXT_ACTION)
 *   Layer 4 — recent truth (recent decisions / timeline / handoff results)
 * Layers 2-4 read the project's `.relayos/overseer/` directory; missing files
 * are omitted gracefully. Returns a plain text block ready to embed.
 */
async function buildOverseerContextBundle(projectRoot: string): Promise<string> {
  const overseerDir = join(projectRoot, ".relayos", "overseer");

  // Layer 2 — policy (each capped at ~4 KB)
  const [policy, forbidden, modelPolicy] = await Promise.all([
    loadOverseerFile(overseerDir, "OPERATING_POLICY.md", 4096),
    loadOverseerFile(overseerDir, "FORBIDDEN_ACTIONS.md", 4096),
    loadOverseerFile(overseerDir, "MODEL_POLICY.md", 4096),
  ]);

  // Layer 3 — project (each capped at ~8 KB)
  const [brief, state, todo, nextAction] = await Promise.all([
    loadOverseerFile(overseerDir, "PROJECT_BRIEF.md", 8192),
    loadOverseerFile(overseerDir, "CURRENT_STATE.md", 8192),
    loadOverseerFile(overseerDir, "TODO.md", 8192),
    loadOverseerFile(overseerDir, "NEXT_ACTION.md", 8192),
  ]);

  // Layer 4 — recent truth
  const [decisions, timeline, results] = await Promise.all([
    loadOverseerJsonlTail(overseerDir, "decisions.jsonl", 5,
      (p) => typeof p["text"] === "string" ? `  - ${p["text"].slice(0, 200)}` : null),
    loadOverseerJsonlTail(overseerDir, "timeline.jsonl", 8,
      (p) => {
        const ts = typeof p["ts"] === "string" ? p["ts"].slice(0, 10) : "?";
        return typeof p["text"] === "string" ? `  [${ts}] ${p["text"].slice(0, 200)}` : null;
      }),
    loadOverseerJsonlTail(overseerDir, "handoff_results.jsonl", 3,
      (p) => typeof p["summary"] === "string"
        ? `  [${p["status"] ?? "?"}] ${p["summary"].slice(0, 150)}`
        : null),
  ]);

  // Layer 1 — identity
  const parts: string[] = [OVERSEER_ROLE_TEXT];

  // Layer 2
  if (policy) parts.push("", "=== OPERATING POLICY ===", policy);
  if (forbidden) parts.push("", "=== FORBIDDEN ACTIONS ===", forbidden);
  if (modelPolicy) parts.push("", "=== MODEL POLICY ===", modelPolicy);

  // Layer 3
  if (brief) parts.push("", "=== PROJECT BRIEF ===", brief);
  if (state) parts.push("", "=== CURRENT STATE ===", state);
  if (todo) parts.push("", "=== TODO ===", todo);
  if (nextAction) parts.push("", "=== NEXT ACTION ===", nextAction);

  // Layer 4
  if (decisions.length > 0) parts.push("", "=== RECENT DECISIONS ===", decisions.join("\n"));
  if (timeline.length > 0) parts.push("", "=== RECENT TIMELINE ===", timeline.join("\n"));
  if (results.length > 0) parts.push("", "=== RECENT HANDOFF RESULTS ===", results.join("\n"));

  return parts.join("\n");
}
```

- [ ] **Step 5: Add the import**

At the top of `src/conversation.ts`, after the existing import block (after line 6,
`import { getProjectConfigSecret } from "./config_secret.js";`), add:

```typescript
import { OVERSEER_ROLE_TEXT } from "./overseer/role.js";
```

- [ ] **Step 6: Update the two call sites**

In `runApiProvider`, change line ~144 from:

```typescript
  const overseerContext = await buildOverseerContext(scope.projectRoot);
```

to:

```typescript
  const overseerContext = await buildOverseerContextBundle(scope.projectRoot);
```

In `buildScopedProviderInput`, change line ~860 from:

```typescript
  const identity = await buildOverseerContext(projectRoot);
```

to:

```typescript
  const identity = await buildOverseerContextBundle(projectRoot);
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean — no `buildOverseerContext` references remain (verify with
`grep -rn "buildOverseerContext\b" src/` → only `buildOverseerContextBundle` hits).

- [ ] **Step 8: Run the new test to verify it passes**

Run: `npx vitest run tests/overseer_context_bundle.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 9: Run the existing conversation tests — confirm no regression**

Run: `npx vitest run tests/conversation_provider_boundary.test.ts`
Expected: PASS — all 4 existing tests still green (the `=== OPERATING
INSTRUCTIONS ===` block in `buildScopedProviderInput` is unchanged).

- [ ] **Step 10: Commit**

```bash
git add src/conversation.ts tests/overseer_context_bundle.test.ts
git commit -m "feat: restructure overseer context into the 4-layer buildOverseerContextBundle"
```

---

## Task 4: Rename the `relays` binary to `overseer`

**Files:**
- Rename: `bin/relays` → `bin/overseer`
- Replace: `bin/relays` (new thin forwarder)
- Modify: `package.json` (`bin` block, ~lines 26–31)
- Test: `tests/bin_overseer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/bin_overseer.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

describe("overseer binary", () => {
  it("package.json declares both overseer and relays bins", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.bin.overseer).toBe("bin/overseer");
    expect(pkg.bin.relays).toBe("bin/relays");
  });

  it("bin/overseer exists and is executable", () => {
    const p = join(ROOT, "bin", "overseer");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).mode & 0o111).toBeGreaterThan(0);
  });

  it("bin/relays forwards to overseer", () => {
    const text = readFileSync(join(ROOT, "bin", "relays"), "utf8");
    expect(text).toContain("overseer");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/bin_overseer.test.ts`
Expected: FAIL — `pkg.bin.overseer` is undefined and `bin/overseer` does not exist.

- [ ] **Step 3: Rename the script**

```bash
git mv bin/relays bin/overseer
```

- [ ] **Step 4: Update the help text inside `bin/overseer`**

In `bin/overseer`, in the `print_help()` heredoc, change the first two content
lines from:

```
relays - RelayOS quick CLI

Usage:
  relays                    Start RTUI chat mode (requires bun)
  relays chat [args...]     Same as above
  relays help               Show this help
  relays settings           Provider/settings wizard (Node)
  relays setup              Guided provider setup wizard (Node)
  relays banner             Show RelayOS banner (Node)
  relays status             Overseer runtime status (Node)
  relays doctor             Overseer health checks (Node)
  relays report             Runtime + handoff report (Node)
  relays run <handoff_id>   Execute one recorded handoff (Node)
```

to:

```
overseer - RelayOS Overseer chat + quick CLI

Usage:
  overseer                    Start RTUI chat mode (requires bun)
  overseer chat [args...]     Same as above
  overseer help               Show this help
  overseer settings           Provider/settings wizard (Node)
  overseer setup              Guided provider setup wizard (Node)
  overseer banner             Show RelayOS banner (Node)
  overseer status             Overseer runtime status (Node)
  overseer doctor             Overseer health checks (Node)
  overseer report             Runtime + handoff report (Node)
  overseer run <handoff_id>   Execute one recorded handoff (Node)
```

- [ ] **Step 5: Create the new `bin/relays` forwarder**

Create `bin/relays` with exactly this content:

```sh
#!/usr/bin/env sh
# Transition alias — `relays` forwards to `overseer`. Prefer `overseer`.
SCRIPT="$0"
while [ -h "$SCRIPT" ]; do
  LINK=$(readlink "$SCRIPT")
  case "$LINK" in
    /*) SCRIPT="$LINK" ;;
    *) SCRIPT="$(dirname "$SCRIPT")/$LINK" ;;
  esac
done
DIR=$(cd "$(dirname "$SCRIPT")" && pwd)
exec "$DIR/overseer" "$@"
```

Then make it executable:

```bash
chmod +x bin/relays
```

- [ ] **Step 6: Update `package.json`**

In `package.json`, replace the `bin` block (~lines 26–31):

```json
  "bin": {
    "relayos-mcp": "dist/index.js",
    "relayos": "bin/relayos",
    "relays": "bin/relays",
    "relayos-setup": "bin/relayos-setup"
  },
```

with:

```json
  "bin": {
    "relayos-mcp": "dist/index.js",
    "relayos": "bin/relayos",
    "overseer": "bin/overseer",
    "relays": "bin/relays",
    "relayos-setup": "bin/relayos-setup"
  },
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/bin_overseer.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 8: Smoke-check the forwarder**

Run: `sh bin/overseer help`
Expected: prints the help text headed `overseer - RelayOS Overseer chat + quick CLI`.

Run: `sh bin/relays help`
Expected: identical help text (forwarded through `bin/overseer`).

- [ ] **Step 9: Commit**

```bash
git add bin/overseer bin/relays package.json tests/bin_overseer.test.ts
git commit -m "feat: rename relays binary to overseer, keep relays as alias"
```

---

## Task 5: Reconcile the governance docs

**Files:**
- Modify: `docs/OVERSEER_WORKFLOW.md`
- Modify: `docs/OVERSEER.md`

Documentation only — no test. Verification is a read-back.

- [ ] **Step 1: Add a "Step and build mode" section to `docs/OVERSEER_WORKFLOW.md`**

In `docs/OVERSEER_WORKFLOW.md`, immediately after the `### One commit per task`
subsection (the last subsection of `## 5. Safety rules`, which ends with the
paragraph "If a task is blocked or incomplete, commit only the safe subset and
record the remainder as a follow-up.") and before `## 6. Source repo vs. runtime
workspace`, insert:

```markdown
### Step and build mode

The Overseer runs in one of two per-project autonomy modes.

**Step mode (default).** One handoff per turn. The Overseer replies, plans, and
records the handoff envelope; the user must approve it before it runs. After the
handoff executes, the Overseer stops and waits.

**Build mode (opt-in).** After a single approval, the Overseer continues through
the task list — but only as a *foreground, supervised, interruptible* loop:

- Foreground supervised continuation loop.
- Visible streaming progress.
- User can interrupt at any time.
- Stops at hard approval boundaries.
- Stops on test failure, uncertainty, or scope change.

Build mode is supervised continuation, not autonomous orchestration. These remain
forbidden in every mode:

- Daemon / background runners.
- Detached execution while the user is not watching.
- Parallel project/worktree orchestration without explicit approval.
- Autonomous commits, releases, destructive actions, production/server changes,
  credential changes, or high-cost external API usage.
```

- [ ] **Step 2: Refine the "Non-goals" line in `docs/OVERSEER.md`**

In `docs/OVERSEER.md`, in the `## Non-goals` list, replace the line:

```markdown
- No background runner, daemon, or autonomous runtime.
```

with:

```markdown
- No background runner, daemon, detached runner, or autonomous runtime. (Build
  mode is foreground, supervised, interruptible continuation only — see
  `docs/OVERSEER_WORKFLOW.md` § "Step and build mode".)
```

- [ ] **Step 3: Verify the doc changes**

Run: `grep -n "Step and build mode" docs/OVERSEER_WORKFLOW.md docs/OVERSEER.md`
Expected: a match in `OVERSEER_WORKFLOW.md` (the new heading) and in `OVERSEER.md`
(the reference in the refined non-goals line).

- [ ] **Step 4: Commit**

```bash
git add docs/OVERSEER_WORKFLOW.md docs/OVERSEER.md
git commit -m "docs: reconcile overseer governance docs with supervised build mode"
```

---

## Task 6: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: clean, no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all suites green, including the four new files
(`overseer_role`, `overseer_templates`, `overseer_context_bundle`,
`bin_overseer`) and all pre-existing tests.

- [ ] **Step 3: Confirm no stray references**

Run: `grep -rn "buildOverseerContext\b" src/ tests/`
Expected: no output (every reference is now `buildOverseerContextBundle`).

- [ ] **Step 4: Confirm `.relayos/` was not staged**

Run: `git status --short .relayos/`
Expected: no output — runtime files remain gitignored and uncommitted.

---

## Self-Review (completed by plan author)

**Spec coverage** — every Phase 1 item in spec §15 maps to a task:
- `src/overseer/role.ts` + `docs/OVERSEER_ROLE.md` → Task 1.
- Bundled policy templates with reconciled wording + "no breaking format
  changes" → Task 2.
- 4-layer `buildOverseerContextBundle` used by both provider paths → Task 3.
- Policy reconciliation in `role.ts`, templates, `OVERSEER.md`,
  `OVERSEER_WORKFLOW.md` → Tasks 1, 2, 5.
- `overseer` binary alias / naming cleanup → Task 4.

**Out of Phase 1 scope (deferred, by design):** the storage model, `IDENTITY.json`,
`resolveProjectIdentity`, `verifications.jsonl`, projected-state generation,
checkpoints, handoff scoping, build-mode loop — all Phases 2–4.

**Placeholder scan** — none. Every code/file step contains literal content.

**Type/signature consistency** — `loadOverseerFile`'s third parameter changes
from `maxLines` to `maxChars` (Task 3 Step 3); its only caller is
`buildOverseerContextBundle`, updated in the same step. `buildOverseerContext` is
fully renamed to `buildOverseerContextBundle` and both call sites are updated in
Task 3. `OVERSEER_ROLE_TEXT` is the single exported name from `src/overseer/role.ts`,
used consistently in Task 1's test, Task 3's import, and Task 3's bundle.
```
