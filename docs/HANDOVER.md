# Arnold: Handover

State of the project as of the last working session. Written for whoever picks
this up next, including a future you with no memory of building it.

If you read only one thing: **Phase 0 is code complete and has never completed a
real agent run.** Everything below is either verified, or honestly marked as not.

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
- **Production build passes.** All 14 routes compile, TypeScript clean.
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
- **The Run modal works end to end** — verified in a real browser with a stubbed
  dispatcher: modal opens, required-argument gating behaves, submit POSTs the
  right body, modal closes, navigates to the run page.
- **RSC boundary guard**: `pnpm check:rsc` fails the build if a Server Component
  renders a HeroUI component that introspects its children. Tested both ways.

### Built but never executed

**No agent has ever actually run.** The database has zero `Run` rows. Everything
downstream of `dispatchRun` creating that row is written, typechecked, and
unproven:

- workspace lease (mirror clone, worktree add, prime, state-path check)
- the SDK `query()` loop and its adapter
- live SSE streaming of real events
- artifact collection and outcome parsing
- provenance recording and ledger updates
- workspace release, and dirty-worktree destruction

That is the single most valuable thing to do next.

### Known broken or unfinished

| Thing                                                    | Detail                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No auth                                                  | Phase 3. Anyone reaching the port can trigger any agent.                                                                                                 |
| Mutating agents registered without gating                | All seven reference manifests are registered, including `draft-pr` and `external-writes` tiers. The manifests exist; the role checks they assume do not. |
| `awaiting_input` is terminal                             | An agent that stops to ask parks with the question preserved and no way to answer. Phase 4.                                                              |
| No guarded-push helper                                   | Two manifests declare `mainBookkeeping`; the helper that validates the staged diff against declared globs is not written.                                |
| `pre-pr-review` has no structured outcome                | It prints a summary and writes no file, so its runs show a transcript and a cost but nothing chartable.                                                  |
| The reference registry points at a repo you may not have | `registry/example-repo/` describes agents from one specific project. Keep them as worked examples; add your own directory.                               |

---

## Getting a first real run

In order. Each step is small and each one de-risks the next.

1. **Point it at a repo you actually have.** Set `TARGET_REPO_PATH` in
   `.env.local` to a local checkout with a `.claude/` directory, and
   `TARGET_REPO_REMOTE` to its remote. Run `pnpm seed`. Registry sync will list
   its commands as `unregistered`.
2. **Write one manifest for one read-only agent of your own**, copying the shape
   of `registry/example-repo/work-order-scoper.ts`. Narrow `Bash` to the exact
   invocations its prompt runs.
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
