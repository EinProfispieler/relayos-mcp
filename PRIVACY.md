# Privacy (RelayOS Core)

This document describes the privacy posture of the open-source RelayOS Core project.

## Scope

This policy applies to RelayOS Core as shipped in this repository.

- RelayOS Core is local-first.
- RelayOS Core does not provide cloud sync.
- RelayOS Core does not include telemetry by default.

If future paid/cloud/enterprise services are introduced, they will require separate privacy notice and explicit user consent.

## Data handling by default

RelayOS Core stores local workflow state and audit artifacts on your machine according to project configuration.

By default, RelayOS Core does not collect or transmit to a RelayOS-operated service:

- source code
- prompts
- AI outputs
- diffs
- file paths
- Git remote URLs
- API keys
- command output

## GitHub issues and public channels

Do not post secrets or confidential data in public issue trackers.

Do not paste:

- API keys, tokens, passwords, private keys
- proprietary source code
- private prompts
- logs containing credentials
- confidential customer or regulated data

## Debug/support bundles

Any debug or support bundle must be:

- user-generated
- user-reviewed
- user-submitted

RelayOS Core does not auto-upload support bundles.

## Safety reminder

AI agents can produce unsafe or destructive actions. Always review commands, diffs, and outputs before applying or executing changes.

## Legal note

This document is informational and not legal advice. Review with qualified counsel before commercial launch.
