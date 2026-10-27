# Contributing to Arnold

Arnold is early (Phase 0 in [`docs/ROADMAP.md`](docs/ROADMAP.md)) and the shape
is still moving, so the most useful contributions right now are small and
concrete.

## Good places to start

- Issues labelled
  [`good first issue`](https://github.com/iwerksom/agent-runner/labels/good%20first%20issue)
  or [`help wanted`](https://github.com/iwerksom/agent-runner/labels/help%20wanted).
- Run it against your own repo and report what broke
  ([`docs/RUNNING.md`](docs/RUNNING.md) lists the known traps).
- A worked-example agent for a workflow you use; see
  [`docs/adding-an-agent.md`](docs/adding-an-agent.md).

## Before a structural change

Open a Discussion or an issue first. Read
[`docs/DECISIONS.md`](docs/DECISIONS.md) (why the code looks like this) and
[`docs/architecture.md`](docs/architecture.md). The roadmap is the single source
of truth for order; features are named by phase, for example `2.1`.

## Setup and checks

See "Getting started" in the [README](README.md). Before opening a PR:

```bash
pnpm typecheck:offline
pnpm smoke ../example-repo
pnpm check:rsc
```

## Pull requests

- Keep a PR to one feature or fix, and link its issue.
- Say what you ran, and what you could not.
- Anything touching the tool policy or write-scope gate needs a test that shows
  the refused case, not only the allowed one.

## Security

Arnold runs agents against local checkouts. If you find a way for an agent to
escape its write scope, please report it privately through GitHub's
"Report a vulnerability" on the Security tab rather than a public issue.

## Licence

By contributing you agree your contribution is licensed under the
[MIT licence](LICENSE).
