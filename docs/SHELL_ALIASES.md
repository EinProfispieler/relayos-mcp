# Optional Shell Aliases

RelayOS ships one binary: `relayos`. It does not modify Claude Code,
Codex CLI, your shell startup files, or any command aliases. Any aliases
below are optional shortcuts that you add and own.

```bash
# Print a compact RelayOS command reminder.
alias rb='relayos banner'

# Print-only handoff helpers.
alias rl='relayos launch latest'
alias rp='relayos policy latest'
alias rr='relayos report'
alias rd='relayos diff-risk'

# Local coordination helpers.
alias ro='relayos overseer brief'
alias ros='relayos overseer status'
```

Add only the aliases you actually want to your shell startup file, for
example `~/.zshrc` or `~/.bashrc`.

## Safety Notes

Do not alias `claude`, `codex`, `git`, `npm`, or other third-party
binaries to RelayOS commands. RelayOS should stay explicit at the point
where it prints or evaluates a handoff.

Do not wrap `relayos launch` in an alias that automatically executes the
printed command unless you intentionally want that behavior. The default
safe flow is still:

```bash
relayos policy latest
relayos launch latest
```

Then read the printed command and run it yourself.

## Startup Banner

If you want a small reminder in a terminal session, call the banner
directly:

```bash
relayos banner
```

You can also place `relayos banner` in your shell startup file, but it is
not installed automatically. Keep it manual so project shells remain
predictable.
