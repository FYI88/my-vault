# Contributing to My Vault

Thanks for your interest in improving My Vault.

## Security-First Contribution Rules

- No direct pushes to `main`.
- All changes must come through Pull Requests.
- Keep PRs small and focused.
- Do not add telemetry, analytics, tracking, or external network calls.
- Do not weaken cryptography, key handling, or unlock/lock flows.
- Any crypto/security-sensitive change must include tests and a clear explanation.

## Development Setup

1. Fork the repository.
2. Create a branch from `main`.
3. Install dependencies in `pcvault/` with `npm ci`.
4. Run tests with `npm test` before opening your PR.

## Pull Request Checklist

- [ ] I ran tests locally and they pass.
- [ ] My change does not add hidden network behavior.
- [ ] I explained security impact (or stated none).
- [ ] I agree to the Contributor License Terms below.

## Contributor License Terms (Relicensing Permission)

By submitting a contribution (code, docs, assets, or other material) to this
repository, you agree that:

1. You have the right to submit the contribution.
2. You keep copyright ownership of your contribution.
3. You grant the project maintainer(s) a perpetual, worldwide,
   non-exclusive, royalty-free license to use, modify, distribute,
   sublicense, and relicense your contribution as part of this project,
   including under different open-source or source-available licenses
   in the future.

If you do not agree to these terms, please do not submit a contribution.
