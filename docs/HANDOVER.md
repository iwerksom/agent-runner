# Arnold: Handover

State of the project as of the last working session. Written for whoever picks
this up next, including a future you with no memory of building it.

If you read only one thing: **the current tree runs.** On 2026-10-01 a read-only
agent completed six runs against a throwaway sandbox repo, the last on the tree
as merged with PRs #6–#8, and with `ARNOLD_TRACE_PLUGIN_DIR` set each run also
lands as an MLflow trace.
Only the read-only and `artifacts` tiers have run; everything above them is held
in code until Phase 3. Everything below is either verified, or honestly marked
as not.

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
| `docs/ROADMAP.md`      | Eight phases with acceptance criteria                                   |
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
  No repo is seeded: `/repos` is the only way one is added, and saving a repo
  syncs its agents.
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

The Aug 29–30 genericization then replaced every per-repo value in the eight
prompts with `{{placeholders}}`. A per-manifest `values` map now fills them, and
a body placeholder left unfilled throws at render time rather than reaching the
model.

All five rows have `repoId = null`: the repo they ran against was deleted, and
because `Run.repoId` is nullable that silently detached them rather than failing.
They are the worked example for DECISIONS #16, and the reason a repo with runs
can now only be archived.

### Executed on the current tree

| Date       | Repo       | Agent               | Runs | Cost       | Notes                                                    |
| ---------- | ---------- | ------------------- | ---- | ---------- | -------------------------------------------------------- |
| 2026-09-12 | `ledtraad` | `docid-invariant`   | 1    | $0.93      | First run after the placeholder fix                      |
| 2026-09-12 | `ledtraad` | `doc-drift`         | 2    | $1.78/1.59 | 39 and 34 turns; sized the agent's budget                |
| 2026-10-01 | `sandbox`  | `sandbox-doc-drift` | 6    | $0.10–0.32 | After the tracker-binding merge; found all planted drift |

`sandbox` is a throwaway local repo (`registry/sandbox/`) whose README carries
three deliberate drifts, so a run is either right or wrong. It is the cheapest
way to prove a change end to end without pointing Arnold at a real project. Add
it from `/repos` with the local path of any small git repo of the same shape.

### Executing work orders: a temporary bridge

Until `work-queue` runs on a repo (feature 4.1, #36), an accepted work
order reaches code through GitHub and a Claude Code skill, outside Arnold:

1. Run a `*-work-order-scoper` binding on an issue, e.g. `#41` on ledtraad.
2. `pnpm orders:publish <runId>` posts the order as a comment on that issue,
   marked with the run id and the base SHA it was scoped at, and labels the
   issue `wo:proposed`. `--dry-run` prints it instead. It refuses a failed run,
   a rejected order, and any agent other than a scoper.
3. The repo owner approves by swapping the label to `wo:approved`.
4. In that repo, ask Claude Code to run approved work orders. The skill
   (`bridge/run-work-orders/SKILL.md`, symlinked into `~/.claude/skills`)
   executes only orders the owner approved after the order was posted, parks
   an order whose files changed since its base SHA, and ends at a draft PR with
   `Closes #<n>`. It never merges.

GitHub is the queue because it persists and shows on the board, which
`.week-plan/queue.jsonl` in a leased worktree does not. Delete
`scripts/publish-order.ts`, `bridge/` and the symlink when #36 lands.

### Tracing runs in MLflow

Opt-in, and off unless `ARNOLD_TRACE_PLUGIN_DIR` is set.

1. `pip install "mlflow>=3.4"` in a virtualenv, then `mlflow server --port 5000`.
2. In the target repo: `mlflow autolog claude -u http://localhost:5000 -n <name> -y`.
   It writes an `env` block to `.claude/settings.json` and installs the
   `mlflow-tracing` plugin. **Commit `settings.json`**: a run sees the leased
   worktree, not your checkout.
3. Start the console with `ARNOLD_TRACE_PLUGIN_DIR` pointing at
   `~/.claude/plugins/cache/mlflow-plugins/mlflow-tracing/<version>`.

Step 3 is needed because the plugin is installed with `--scope local`, which
binds it to the checkout's own path; a worktree never has that path, so without
it the SDK init event shows `plugins: []` and nothing is traced.

Each run yields an AGENT span, one TOOL span per tool call and an LLM span. The
plugin attaches usage to the last LLM call only, so MLflow's cost and token
figures undercount by roughly 3×. **The ledger is the source of truth for cost.**

### Known broken or unfinished

| Thing                                                    | Detail                                                                                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No auth                                                  | Phase 3. Anyone reaching the port can trigger any agent — and now also register a repo, which names a host path Arnold will clone. Keep it on localhost.                                                        |
| Mutating agents held, not gated                          | Every manifest above `artifacts` carries `disabled` with a reason and cannot be triggered (smoke [13]). The role checks and per-tier credentials that would release them are Phase 3.                           |
| `awaiting_input` is terminal                             | An agent that stops to ask parks with the question preserved and no way to answer. Phase 4.                                                                                                                     |
| No guarded-push helper                                   | Two manifests declare `mainBookkeeping`; the helper that validates the staged diff against declared globs is not written.                                                                                       |
| `pre-pr-review` has no structured outcome                | It prints a summary and writes no file, so its runs show a transcript and a cost but nothing chartable.                                                                                                         |
| Reads are not confined                                   | The gate governs writes only. A read-only agent may `Read`, `Grep`, `cat` or `wc` any file the console user can read, `.env.local` included; the safe-filter exemption also applies after `;`, not only after ` | `. Gate now or sandbox later is a design call (#27). |
| User-level skills load into runs                         | `settingSources: ["project"]` does not keep `~/.claude` skills out: they appear in the SDK init event's slash commands.                                                                                         |
| `Agent.id` is global                                     | One prompt bound to two repos needs two ids (`doc-drift`, `sandbox-doc-drift`); a shared id would overwrite the other repo's row on sync.                                                                       |
| Five runs detached from their repo                       | `repoId` is null on every historical run because the old repo row was deleted. Not recoverable; DECISIONS #16 stops it recurring.                                                                               |
| The reference registry points at a repo you may not have | `registry/example-repo/` describes agents from one specific project. Keep them as worked examples; add your own directory.                                                                                      |

---

## Getting a first real run

In order. Each step is small and each one de-risks the next.

1. **Point it at a repo you actually have.** Open `/repos`, press Add
   repository, and give it a local checkout with a `.claude/` directory. The path
   is probed as you type, so a typo is caught here rather than at lease time.
   Saving it syncs the registry, which lists that repo's commands as
   `unregistered`. This works on an empty database; nothing needs seeding first
   except the operator, which `pnpm setup` creates.
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
