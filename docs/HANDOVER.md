# Arnold: Handover

State of the project as of the last working session. Written for whoever picks
this up next, including a future you with no memory of building it.

If you read only one thing: **Phase 0 completed five real agent runs in August
2026, and nothing has run since the genericization.** As of 2026-09-25 the
placeholders that blocked a run are filled from per-repo settings and
`pnpm smoke` is green, so the next step is a real run. Everything below is either
verified, or honestly marked as not.

> **Correction, 2026-09-09.** Earlier versions of this file said Arnold "has
> never completed a real agent run" and that "the database has zero `Run` rows".
> Both were wrong. `packages/core/prisma/arnold.db` holds five successful runs
> from 13–14 August 2026 — $2.98 of real spend, 1.6M tokens, 344 persisted
> events, one collected artifact still on disk at
> `.arnold/artifacts/*/PR-507-20260813-1445.md`. The claim appears to have been
> carried forward from before those runs happened and never rechecked.

---

## What Arnold is

A console for running Claude agents against any repo. It lists the agents a repo
declares in its `.claude/` directory, lets you trigger one, streams the
transcript live, and keeps a durable record of what each run cost, what code it
saw, and what it produced.

The five words are five real modules, not a backronym stretched over a name:

| Word             | Module                        | Job                                                             |
| ---------------- | ----------------------------- | --------------------------------------------------------------- |
| **Runner**       | `packages/core/runner.ts`     | Drives the Agent SDK `query()` loop under an enforced policy    |
| **Notary**       | `packages/core/notary.ts`     | Records what code the run saw: base SHA, branch, PR, tickets    |
| **Orchestrator** | `packages/core/registry.ts`   | Owns the registry and the run tree (subagent, harness children) |
| **Ledger**       | `packages/core/ledger.ts`     | Daily cost and token caps, per agent and globally               |
| **Dispatcher**   | `packages/core/dispatcher.ts` | Validates arguments, refuses what it should, enqueues           |

The one property every phase must preserve:

> The API enqueues, something else executes against a leased workspace, and runs
> are durable records with declared artifacts.

## Documentation map

| File                   | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `README.md`            | How to run it, and the traps that bite on first setup                   |
| `docs/architecture.md` | The plan of record, written before the code. Long.                      |
| `docs/DECISIONS.md`    | Why the code looks like this. Read before changing anything structural. |
| `docs/ROADMAP.md`      | Seven phases with acceptance criteria                                   |
| `docs/HANDOVER.md`     | This file: what actually works today                                    |

`packages/core/src/agents.ts` is the file to read first in the code. Everything
else reads from it.

---

## Current state

### Built and verified

- **Monorepo scaffold**: pnpm workspaces, `@arnold/core` + `@arnold/web`,
  Next 16 App Router, React 19, HeroUI 2.8, Tailwind 4, Prisma 6 on SQLite,
  Agent SDK pinned exactly at `0.3.228`.
- **Production build passes.** All 19 routes compile, TypeScript clean.
- **Prompt rendering works against real prompt files.** `pnpm smoke <checkout>`
  renders every registered agent and asserts every substitution landed:
  positionals, `${1:-default}` forms, flag args, the literal `<PR>` token, and
  subagent context templates. 25 assertions.
- **The write-scope gate refuses what it should.** Same smoke run proves a
  read-only agent cannot Write or Edit, cannot `git push`, cannot smuggle a
  second command past the allow-list (`git log && rm -rf src`), and cannot write
  into `.claude/`, `.env*`, outside the workspace, or via path traversal.
- **Seed and registry sync work.** Seeding produces one repo row, seven agent
  rows, one operator user. Agents found without a manifest overlay appear as
  `unregistered` and are not runnable.
- **Repos are managed from the console.** `/repos` adds, edits, archives,
  restores and deletes target repositories; the switcher in the nav scopes the
  Agents and Runs screens to one of them. Verified against a real checkout over
  HTTP: the probe detects branch and remote and refuses a path that is not a git
  checkout, a duplicate slug and a malformed slug are both rejected with the
  reason, archive round-trips, and a repo with a run row refuses deletion.
- **No repo is hardcoded (2026-09-25).** `TARGET_REPO_*` and the seeded first
  row are gone; an empty database opens on an empty Agents page that links to
  `/repos`. The agent library (`registry/library/`, all `repos: ["*"]`) attaches
  to a repo when it is added, with no Sync press. Verified in a browser on the
  laptop against a fresh SQLite file: add two repos, pick one in the switcher,
  delete one, and an edit that sets and then clears a prompt value.
- **Prompt values fill the `{{variables}}` (2026-09-25).** `Repo.promptVariables`
  holds the tracker project key, parent issue, timezone and working hours;
  `{{defaultBranch}}` comes from the repo column. `renderPrompt` fills them before
  any argument, and the Dispatcher refuses a run whose repo lacks one, naming it.
  `pnpm smoke` passes 95 checks, including every library prompt rendering with
  nothing left unfilled. **No agent has run on this tree yet**: the laptop had no
  API key configured.
- **The Run modal works end to end** — verified in a real browser with a stubbed
  dispatcher: modal opens, required-argument gating behaves, submit POSTs the
  right body, modal closes, navigates to the run page.
- **RSC boundary guard**: `pnpm check:rsc` fails the build if a Server Component
  renders a HeroUI component that introspects its children. Tested both ways.

### Executed once, against a repo that no longer exists

Five runs succeeded on 13–14 August 2026 against the previous target repo. They
exercised the whole path that the rest of this file used to call unproven:

| Agent             | Cost  | Turns | Events | Outcome rows | Artifacts |
| ----------------- | ----- | ----- | ------ | ------------ | --------- |
| work-order-scoper | $0.56 | 13    | 80     | 1            | 0         |
| pr-loop-analyzer  | $0.74 | 14    | 74     | 1            | 1         |
| plan-week         | $0.67 | 16    | 71     | 1            | 0         |
| plan-week         | $0.55 | 14    | 62     | 1            | 0         |
| work-order-scoper | $0.47 | 11    | 57     | 1            | 0         |

So the workspace lease, the SDK `query()` loop and its adapter, event
persistence, outcome parsing, provenance recording and the ledger all did work at
least once, and artifact collection produced a real 8.6 KB report that is still
in the artifact store.

**What is unproven is the current tree, which is not the tree that ran.** The
Aug 29–30 genericization changed how console-owned prompts resolve and replaced
every per-repo value in the eight prompts with `{{placeholders}}` that nothing
fills. Nothing has run since. Treat the list above as evidence the design works,
not as evidence this checkout works.

All five rows have `repoId = null`: the repo they ran against was deleted, and
because `Run.repoId` is nullable that silently detached them rather than failing.
They are the worked example for DECISIONS #16, and the reason a repo with runs
can now only be archived.

Getting one run to succeed on the current tree is still the single most valuable
thing to do next. The placeholders no longer block it.

### Known broken or unfinished

| Thing                                               | Detail                                                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No auth                                             | Phase 3. Anyone reaching the port can trigger any agent — and now also register a repo, which names a host path Arnold will clone. Keep it on localhost. |
| Mutating agents registered without gating           | All seven reference manifests are registered, including `draft-pr` and `external-writes` tiers. The manifests exist; the role checks they assume do not. |
| `awaiting_input` is terminal                        | An agent that stops to ask parks with the question preserved and no way to answer. Phase 4.                                                              |
| No guarded-push helper                              | Two manifests declare `mainBookkeeping`; the helper that validates the staged diff against declared globs is not written.                                |
| `pre-pr-review` has no structured outcome           | It prints a summary and writes no file, so its runs show a transcript and a cost but nothing chartable.                                                  |
| Five runs detached from their repo                  | `repoId` is null on every historical run because the old repo row was deleted. Not recoverable; DECISIONS #16 stops it recurring.                        |
| Library agents assume Jira and a `.pr-loop/` layout | The prompts are generic in their values, not their process. An agent may still expect files or tools a given repo lacks.                                 |

---

## Getting a first real run

In order. Each step is small and each one de-risks the next.

1. **Point it at a repo you actually have.** Open `/repos`, press Add
   repository, and give it a local checkout with a `.claude/` directory. The path
   is probed as you type, so a typo is caught here rather than at lease time.
   Fill in the Prompt values the agent you want to run uses (each field says
   which agents use it). The library agents appear on the Agents page at once;
   the repo's own `.claude/` commands show up as `unregistered`.
2. **Start with `work-order-scoper`**, the read-only library agent. It needs only
   the default branch. To run one of the repo's own commands instead, write a
   manifest for it, copying the shape of `registry/library/work-order-scoper.ts`,
   and narrow `Bash` to the exact invocations its prompt runs.
3. **Run `pnpm smoke <your-checkout>`** before touching the UI. If prompt
   rendering is wrong, a run will succeed while doing the wrong thing.
4. **Trigger it from the console and watch the terminal.** This is where the
   unproven half begins. Expect the failure to be in the workspace lease or the
   SDK adapter; both log loudly.
5. **Check the database**, not just the UI:
   `sqlite3 packages/core/prisma/arnold.db "select id, status, exitReason from Run"`.
   A run that never leaves `queued` means the dispatcher returned before the
   executor started. A run stuck in `running` means the loop threw somewhere the
   `finally` did not cover.

---

## Environment traps

Each of these cost real time. They are all documented in code comments too, but
here they are in one place.

**Env files are loaded by two shims, not by the tools.** The Prisma CLI reads
only `.env`, and only from its own working directory; Next reads env files from
`apps/web`. The single source is `.env.local` at the repo root, injected by
`scripts/with-env.mjs` for CLI scripts and by `apps/web/next.config.mjs` for the
app. Do not scatter copies. Symptom of getting this wrong:
`P1012: Environment variable not found: DATABASE_URL`.

**`@heroui/theme` is a dependency nothing imports.** It exists so pnpm symlinks
it where Tailwind's `@source` can scan it. Removing it silently deletes every
HeroUI utility that appears nowhere in Arnold's own source. See DECISIONS #13.

**Webpack needs `extensionAlias`.** `@arnold/core` is TypeScript ESM, so its
internal imports carry the `.js` extension the emitted JavaScript would have.
TypeScript resolves that; webpack takes it literally and fails with
`Can't resolve './agents.js'`.

**Workspaces default outside the repo.** A worktree holds a full checkout of the
target repo. Inside this repo, the dev watcher, `tsc` and `knip` would all treat
it as source. See DECISIONS #6.

**Prisma engine binaries need network on first install.** `pnpm db:generate`
downloads them. In a sandbox where `binaries.prisma.sh` is unreachable, no query
can execute at all; `pnpm typecheck:offline` generates a type-only client stub so
`tsc` still verifies the repo, and `pnpm smoke` needs no database.

---

## Scripts

| Command                  | What it does                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `pnpm setup`             | install, prisma generate, db push, seed                                            |
| `pnpm dev`               | Next dev server on :3000                                                           |
| `pnpm env:check`         | confirms the root env file is found and required vars are set                      |
| `pnpm smoke <checkout>`  | renders every registered prompt and exercises the tool policy. No database needed. |
| `pnpm check:rsc`         | fails on Server Components rendering child-introspecting HeroUI components         |
| `pnpm typecheck:offline` | typechecks using a generated Prisma type stub                                      |
| `pnpm build`             | `check:rsc` then the Next production build                                         |

---

## Working on this with Claude Code

Two things worth knowing, learned the hard way.

**Run it locally for anything involving a live run.** A cloud session cannot
execute a Prisma query if the engine binaries are unreachable, so it cannot
reproduce the runtime at all. It is good at authoring, typechecking, building and
browser-driven UI verification; it is bad at "run it and read the console".

**For UI bugs, measure before theorising.** Build a fixture-data preview route,
drive it with Playwright, and check element geometry and network calls. See
DECISIONS #15 for why this is written down.
