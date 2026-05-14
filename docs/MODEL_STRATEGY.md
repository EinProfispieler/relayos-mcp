# RelayOS Model Strategy

RelayOS separates two concerns that most tools conflate: **what role an agent is playing** and **which model or provider executes that role**. The handoff envelope encodes both (`execution_mode` for role, `model` for provider choice), but the current built-in templates make opinionated defaults. This document explains the design intent, the current state, and the direction for a more flexible model-role selection system.

---

## Role templates vs. model/provider choice

A **role template** answers: *what is the agent being asked to do?*

| Role | `execution_mode` | Typical concern |
|---|---|---|
| `patch` | patch | Apply code changes within a defined scope |
| `review` | review | Read, critique, and suggest — no edits |
| `test` | test | Write or run tests; verify behaviour |
| `plan` | plan | Produce a plan or spec; no code |
| `read_only` | read_only | Observe and report only |

A **model/provider choice** answers: *which model runs this role?*

These are orthogonal. A `patch` handoff can target GPT-4.5, Claude Sonnet, a local model, or any other MCP-compatible agent. The envelope records both so the audit log is unambiguous — you can reconstruct exactly what ran, with which model, under what scope.

---

## Current built-in templates

The six built-in templates are **early, practical defaults** — not a final taxonomy. They reflect the two agents RelayOS first-party integrated (Codex CLI and Claude Code) and reasonable effort levels for common tasks.

| Template | target | mode | model | effort |
|---|---|---|---|---|
| `codex-patch` | codex | patch | `gpt-5.5` | high |
| `codex-review` | codex | review | `gpt-5.5` | medium |
| `codex-test` | codex | test | `gpt-5.5` | medium |
| `codex-plan` | codex | plan | `gpt-5.5` | high |
| `claude-review` | claude | review | `claude-opus-4-7` | medium |
| `claude-plan` | claude | plan | `claude-opus-4-7` | high |

These are starting points. Override any field via `overrides` at call time, or define project-specific templates in `.relayos/config.json`. The envelope format is provider-agnostic — `model` is a free string; RelayOS does not validate it against a registry.

---

## Provider landscape

RelayOS handoff envelopes are designed to work with any agent that can read an MCP tool result and act on it. Providers currently in scope or under consideration:

| Provider / model family | Agent surface | Notes |
|---|---|---|
| OpenAI GPT / Codex CLI | `codex` target | First-party integration; `codex exec` launch |
| Anthropic Claude (Sonnet, Opus) | `claude` target | First-party integration; `claude -p` launch |
| Google Gemini | TBD | MCP surface; envelope format compatible |
| GLM / Zhipu | TBD | Envelope-compatible; no first-party adapter yet |
| Cursor | TBD | IDE-embedded; possible future MCP registration |
| Local models (Ollama, llama.cpp) | TBD | No cloud dependency; lower cost; limited context |

Adding a new provider does not require changes to the RelayOS core. The operator defines a project template pointing at the new `target_agent` value and wires the launch command manually (or via a custom `render_*` call). The audit log records whatever strings were used.

---

## Selection criteria

When choosing a model for a role, the relevant axes are:

| Criterion | Relevance |
|---|---|
| **Quality** | Does the model reliably produce correct output for this role? (patch quality, review depth) |
| **Cost** | What is the per-token or per-call cost? Low-cost execution roles (test runs, docs) may not need top models. |
| **Latency** | How long does the round-trip take? Blocking workflows (plan → approve → patch) tolerate more; interactive loops do not. |
| **Context length** | Large diffs, full-repo reviews, or long audit trails need models with large context windows. |
| **Compliance / legal suitability** | Some roles (legal review, security audit, regulated-domain code) may require data residency or specific provider agreements. |
| **Risk level** | High-risk handoffs (touching auth, payment, secrets-adjacent code) warrant higher-quality, more conservative models. |

No single model is best across all axes. A high-effort `patch` on auth code warrants a frontier model with strong reasoning; a low-risk `test` run on a small utility file may cost-optimize to a smaller, faster model. RelayOS records the choice but does not enforce it — that judgment belongs to the operator.

---

## Future: model-role matrix

The long-term direction is a **dynamic model-role matrix**: a per-project or per-organization mapping that evaluates `(role, risk_level, file_scope)` → `(preferred_model, fallback_model, effort_cap)`.

Design sketch (not committed, no timeline):

```json
{
  "matrix": [
    { "role": "patch", "risk": "high",   "model": "claude-opus-4-7", "effort": "xhigh" },
    { "role": "patch", "risk": "normal", "model": "gpt-5.5",          "effort": "high"  },
    { "role": "review",                  "model": "claude-opus-4-7", "effort": "medium" },
    { "role": "test",                    "model": "gpt-5.5",          "effort": "medium" },
    { "role": "plan",                    "model": "claude-opus-4-7", "effort": "high"   }
  ]
}
```

The matrix would live in `.relayos/config.json` and be evaluated at `create_handoff_from_template` / `create_quick_handoff` time — still fully local, still operator-editable, still overridable per call. The `doctor` tool would surface any matrix validation warnings.

This is a design direction, not a shipped feature. The current template system is the recommended path.

---

## Non-goals

- RelayOS does not benchmark models or make hard claims about which model is best for any role.
- RelayOS does not call model provider APIs directly — it generates launch commands and records envelopes. The model interaction is entirely handled by the target agent CLI.
- No auto-selection without operator approval. If a matrix entry is selected, the operator still sees the resolved model in the handoff envelope before confirming launch.
- No telemetry or usage data leaves the machine.

---

## See also

- [`README.md`](../README.md) — install, MCP wiring, built-in templates table
- [`docs/REFERENCES.md`](REFERENCES.md) — RelayOS vs OpenSpec and Superpowers; interoperability ideas
- [`docs/ROOKIE_MODE.md`](ROOKIE_MODE.md) — the chat-only workflow and risk gate
- [`docs/WALKTHROUGH.md`](WALKTHROUGH.md) — solo developer end-to-end walkthrough
