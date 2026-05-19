# Model Policy

- Use `gpt-5.3-codex` with `medium` effort for narrow repo edits/tests/docs.
- Use `gpt-5.5` or stronger for architecture/release/security/product judgment.
- Prioritize correctness and safety over token saving.
- Choose `effort` to match task risk: escalate effort for auth, payment,
  secrets-adjacent, CI/CD, or storage-format work; never downgrade to save cost.
