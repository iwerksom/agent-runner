# Arnold: Architecture

> Agent Runner, Notary, Orchestrator, Ledger, Dispatcher.
>
> The target architecture. What is built, and what is built next in what
> order, is in `docs/ROADMAP.md` (each phase carries a status); how to run it is
> in `docs/RUNNING.md`; why each choice was made is in `docs/DECISIONS.md`. Worked
> example agents are in `docs/reference-agents.md`, and how to add one in
> `docs/adding-an-agent.md`.

Arnold runs coding agents against repositories and keeps the record: which agent
ran, on which code, for whom, at what cost, and what came of it. An operator
lists the registered agents, sees data from their runs (status, cost, tokens,
logs, artifacts, tickets, PRs), and triggers a run from the UI.

The design target is not a UI for one particular agent or one particular
project. It is a host that can run **any** agent in **any** repo: the commands
and subagents already sitting in a project's `.claude/` directory, the ones not
written yet, and agents belonging to other repos entirely. Section 4 defines the
contract an agent must satisfy to be console-runnable; everything else follows
from it.

## 0. The shape: Arnold owns the record, and rents the loop

### The line between owned and rented

There are two places to abstract over vendors, and only one of them avoids
re-plumbing:

- **At the model API** (a gateway plus Arnold's own agent loop). This means
  rebuilding tool calling, file editing, context management and subagents —
  exactly what every coding-agent harness already does well. Rejected.
- **At the harness.** Run existing coding-agent CLIs — Claude Code, Codex,
  Gemini CLI, OpenCode — behind one adapter. **Chosen.**

The harness layer already has a standard: the **Agent Client Protocol (ACP)**, a
JSON-RPC protocol between a client and a coding agent. Gemini CLI speaks it
natively (`--acp`); Claude Code and Codex speak it through the
`claude-agent-acp` and `codex-acp` adapters. It was built for editors; Arnold is
one more client. Its permission-request flow is the vendor-neutral counterpart
of the SDK's `canUseTool`. Whether it holds up headless in a worker is
settled by ROADMAP feature 4.1. Where it does not, the fallback is each CLI's own
JSON event stream behind the same adapter interface.

So Arnold owns what gets run, where, by whom, and what came of it:

1. **The team registry** — versioned agent definitions and per-repo bindings,
   reviewed in git.
2. **Run history and provenance** — who ran what, at which SHA, on which
   harness and model, at what cost.
3. **Outcomes and findings** — reason codes over time; findings fingerprinted,
   deduplicated, closed when a re-check finds them fixed, and routed to the scoper and
   the queue (ROADMAP Phase 7).
4. **The inbox** — `awaiting_input` runs and approvals.
5. **Harness comparison** — the same agent run on two vendors, compared on
   outcome and cost per reason code. No single vendor will ever build this.

Everything else is rented.

### Target shape

```
                ┌──────────────── Arnold (owned) ───────────────┐
 UI (Next.js) ─┤  Registry · Dispatcher · Run history ·         │
 MCP server  ──┤  Provenance · Outcomes · Findings · Inbox ·    │
 Webhooks    ──┤  RBAC · Ledger views                           │
                └───────────────┬───────────────────────────────┘
                                │ enqueue (Postgres queue)
                         ┌──────▼──────┐
                         │   Worker    │  leases worktree, builds sandbox
                         └──────┬──────┘
          ┌─────────────────────┼─────────────────────┐   rented below
   Sandbox (container: worktree mount, egress policy, per-tier credentials)
          │   Harness adapter (ACP, or the CLI's JSON stream)
          │   claude-code │ codex │ gemini-cli │ opencode
          └──────── model traffic ──► LLM gateway ──► providers
```

### Owned and rented, concern by concern

| Concern                                      | Rented                                                                | Arnold's part                                  |
| -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| Agent loop, tools, file edits, subagents     | Claude Code, Codex, Gemini CLI, OpenCode                              | A `Harness` adapter normalising their events   |
| Client ↔ agent protocol                      | ACP                                                                   | One ACP client                                 |
| Tool integrations (tracker, calendar, forge) | MCP servers                                                           | Which servers each agent is granted            |
| Isolation and enforcement                    | Containers: read-only mounts, egress rules, no credentials by default | Compiling a write scope into a sandbox profile |
| Model keys, budget caps, per-provider cost   | LLM gateway (LiteLLM): a virtual key per run with `max_budget`        | Ledger views; caps declared in manifests       |
| Queue and schedules                          | A Postgres-backed queue (pg-boss or graphile-worker), cron included   | Nothing                                        |
| Live log transport                           | Postgres `LISTEN/NOTIFY` feeding SSE                                  | Nothing                                        |
| Auth                                         | Auth.js against any OIDC provider; solo mode is one local user        | Role checks                                    |
| Agent instructions in the target repo        | `AGENTS.md`, `SKILL.md`, MCP — formats several vendors read           | The manifest and prompt format                 |
| Triggers from other systems                  | n8n, forge webhooks                                                   | An HTTP and MCP endpoint they call             |

The gateway earns its place three times over: caps that hold across vendors, a
cost figure computed from one price table rather than each harness's own
reporting (Claude Code reports USD, others report tokens), and provider keys
that never enter the sandbox — the run holds a virtual key capped to its budget.

### Enforcement, rebuilt so it survives a vendor change

`canUseTool` exists only in Claude's SDK, and parsing shell strings cannot be
made complete (DECISIONS #22 lists the bypasses found in `writeScope.ts`). So a
write scope compiles into three layers, most trustworthy first:

1. **Sandbox profile — the boundary.** What the container can reach decides what
   the run can do. `read-only`: worktree mounted read-only, no network except the
   gateway, no credentials. `artifacts`: one writable output directory.
   `working-tree`: writable worktree, still no credentials. `branch-push` and up:
   a forge token scoped to that one repo. This holds whatever the agent tries,
   because it parses nothing.
2. **Harness-native config — best effort.** The manifest is translated into
   Claude permission rules, Codex sandbox and approval modes, or Gemini tool
   excludes. Its value is a clean denial in the transcript, not safety.
3. **ACP permission callback — the fine rules.** Bookkeeping globs, label-only
   issue edits, `.claude/` and `.env*` denials. `writeScope.ts` moves here. It
   no longer has to be complete, only useful.

### Portability: the engine and the registry split

`registry/` is TypeScript compiled into the app today, so adding an agent needs a
code change and a restart, and a team's agents live in the engine's repository.
Both are wrong for a tool that moves between employers.

- **The engine** is this repository: MIT, owned by its author.
- **A registry** is a separate git repository — agent definitions, prompts,
  per-repo bindings — loaded by Arnold at runtime and validated with zod. A team
  keeps its registry when its author leaves; a personal registry travels with
  them. One Arnold deployment points at one or more registry repos.
- **One deployment shape**: `docker compose up` brings up web, worker, Postgres
  and the gateway. Solo mode is the same file with auth off. A team adds an OIDC
  provider.
- **Definitions stay vendor-neutral.** Nothing in the definition format assumes
  `.claude/`. A repo's `.claude/commands/` can still be imported, but as one
  importer among several, not as the model.

## 1. Goals and non-goals

In scope: a registry of agents that can be reconciled from a repo's `.claude/`
directory, durable run history with cost and token accounting, live and
replayable run logs including nested subagent activity, one-click execution
against a managed git workspace, ingestion of the artifacts and metrics agents
already emit, and the same execution path used by schedules. Multiple target
repos.

Three requirements shape the design:

1. **Team and solo from one codebase.** One person on a laptop, and a team
   behind SSO, with the same engine. The engine is personal property; a team's
   agents are not.
2. **Team agents with history.** Agents are reviewed like code, runs are durable
   records, and the UI shows what the agents have found and what it cost over
   time.
3. **Vendor-agnostic.** An agent runs on more than one LLM vendor, and the
   choice is a manifest field, not a rewrite.

And one constraint on all three: **Arnold does not rebuild plumbing that already
exists.** A vendor abstraction is worth building only as an extraction over
something real.

Not in scope: a visual agent builder, a general step-by-step approval UI, and
cross-tenant isolation beyond a single team.

## 2. Architecture overview

The web tier never executes an agent. It enqueues a job and returns. A separate
worker owns execution, the workspace, the sandbox and the budget. This
decoupling matters because runs take minutes, must survive page reloads, and
need credentials the web tier should never hold.

Flow: UI -> API validates args and enqueues a job (Postgres queue) -> Worker
dequeues -> Worker leases a git workspace for the run's repo and builds the
sandbox for the agent's write scope -> Worker resolves the prompt from the
registry or the repo and starts the agent through a harness adapter -> each
harness message becomes a normalised log event, persisted to Postgres and
announced with `NOTIFY` -> declared artifacts and outcomes are collected from the
workspace -> spend is folded into the daily ledger -> the workspace is released
-> the UI streams logs over SSE (subscribing to the notification channel) and
reads run records, artifacts and outcomes from Postgres.

The worker, and the sandbox it builds, are the trust boundary. Provider keys
live in the gateway; git push credentials and tracker tokens are mounted into a
sandbox only when its write scope requires them.

The property that holds throughout: **the API enqueues, something else executes
against a leased workspace, and runs are durable records with declared
artifacts.** Every component can be swapped (in-process to worker, SQLite to
Postgres, local executor to remote) without changing it.

## 3. Technology stack

| Concern        | Choice                                                    | Why                                                                                |
| -------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| UI + API       | Next.js App Router, HeroUI, Tailwind                      | Team familiarity; SSE support in route handlers                                    |
| Execution      | Harness adapters over coding-agent CLIs (ACP or JSON)     | Reuses tool calling, file edits and context management instead of rebuilding them  |
| Gateway        | LiteLLM                                                   | Caps and one price table across vendors; provider keys stay out of the sandbox     |
| Worker         | Standalone Node process                                   | Long-running, owns workspaces and sandboxes, isolated from web                     |
| Sandbox        | One container profile per write scope                     | What the container can reach decides what the run can do, whatever the agent tries |
| Workspaces     | Bare mirror clone + `git worktree` per run                | Cheap isolated checkouts; parallel runs cannot collide on a branch                 |
| Store          | Postgres + Prisma                                         | Durable run history, artifacts, ledger; SQLite is used for a single-machine start  |
| Queue          | Postgres-backed (pg-boss or graphile-worker)              | Retries, concurrency caps and cron without a second datastore                      |
| Log transport  | Postgres `LISTEN/NOTIFY` -> SSE                           | Cross-process live logs; the full transcript is persisted in Postgres              |
| Artifact store | S3-compatible object store (a filesystem volume to start) | Reports and order files outlive the workspace                                      |
| Auth           | Auth.js against any OIDC provider                         | SSO with simple RBAC; solo mode is one local user                                  |
| Packaging      | pnpm workspaces                                           | Shared types between web and worker                                                |
| Containers     | Docker Compose (then K8s)                                 | Web, worker, Postgres and gateway as separate services                             |

## 4. What makes an agent console-runnable

This is the contract. An agent is registrable when all six hold. Anything that
fails one of these is either fixed in the agent or declared in the manifest so
the console can degrade gracefully rather than fail at runtime.

1. **Declared arguments.** Positional arguments have names, types, and required
   flags in the manifest, mapped to the `$1` / `$2` / `${1:-default}` slots the
   prompt body actually uses. The console renders the prompt; it does not pass a
   raw string and hope.
2. **Declared tool policy.** An allow-list of tool patterns. Repo command files
   carry no `tools:` frontmatter (only the two subagents do), so the policy
   lives in the console manifest and is enforced by the sandbox and the gate (the
   layers in Section 0), never by prompt wording alone.
3. **Declared write scope.** One of the tiers in Section 14. The console derives
   the workspace policy, the required role, and whether push credentials are
   even mounted from this value.
4. **Declared execution mode.** `unattended`, `needs-human`, or
   `needs-local-session` (Section 7).
5. **Structured terminal output.** Either a fenced JSON block, an appended JSONL
   metrics line, or a report file at a declared path. A run whose only output is
   prose is still valid but produces no `RunOutcome` row and therefore no
   trend data.
6. **Declared artifacts.** Glob patterns, relative to the workspace root, for
   every file the agent writes that should outlive the run.

## 5. Agent kinds

Not every agent is a slash command, and not every agent is triggered by a human.
The registry models four kinds.

| Kind       | Source                                                     | Example                                              | Invocable                              |
| ---------- | ---------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| `command`  | `.claude/commands/<id>.md` in the target repo              | `pre-pr-review`                                      | directly                               |
| `subagent` | `.claude/agents/<id>.md` in the target repo                | `work-order-scoper`                                  | child only, unless explicitly promoted |
| `harness`  | a script in the repo that fans out many Claude invocations | `scripts/ai-smell-runner.py` driving `ai-smell-scan` | directly                               |
| `native`   | a prompt owned by the console itself                       | future console-only agents                           | directly                               |

Two consequences worth being explicit about:

**Subagents are visible, not hidden.** `plan-week` spawns one
`work-order-scoper` per _survivor_ of its own screen, all in a single message so
they run concurrently: candidates it rejects in step 4 never reach a subagent, so
child-run count is survivors and not candidates. `fix-pr-comments` spawns
`pr-loop-analyzer` only when comments still remain after the final recheck at the
round cap (a clean final recheck ends as `converged_on_recheck` with no
analyzer). The SDK surfaces these, so the console persists them as child `Run` rows linked
by `parentRunId`. The run detail page renders a tree, and cost rolls up from
children to parent. A subagent that only ever runs as a child is registered with
`invocable: "child"` so it appears in the registry (and in cost breakdowns)
without a Run button.

**A harness run is a parent with many children.** `ai-smell-scan` is not a
whole scan: per its own prompt body it is the read-only per-batch worker that
`scripts/ai-smell-runner.py` invokes once per batch of files, sharing a daily
budget, with the runner (not the agent) appending to the report and filing Jira
tickets over the REST API. Registering only the batch worker would put the
console one level below the thing an operator wants to press. So the harness is
the registered agent, its child invocations are child `Run` rows, and the batch
worker is registered as `invocable: "child"`. Read `scripts/ai-smell-runner.py`
before writing its manifest: the runner's real argument surface, budget
mechanism, and Jira behaviour are asserted by the agent prompt but only
verifiable in the script.

## 6. Agent registry (manifest)

An agent is a declarative record the UI renders and the worker executes. Manifest
overlays live in the registry at `registry/<repo-slug>/<id>.ts`, because the repo
files carry none of this metadata. The `Agent` table is seeded and reconciled
from them. The contract is the `AgentManifest` type in
`packages/core/src/agents.ts`; this table groups its fields.

| Group      | Fields                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity   | `id` (matches the repo filename), `name`, `description`, `kind` (command, subagent, harness, native), `prompt` (a repo path, a registry path, or a script command), `repos` (slugs or `*`), `invocable` (direct or child)                                                            |
| Invocation | `args` (name, slot such as `$1`, `${1:-main}` or `--windows=`, type, required, default), `contextTemplate` (the context block a subagent's caller would hand it), `values` (per-repo constants for the prompt body's `{{name}}` placeholders), `model`, `unattendedIfArgs`           |
| Policy     | `tools` (allow-list, permission mode, MCP servers, denied paths), `writeScope` (read-only, artifacts, working-tree, branch-push, draft-pr, external-writes), `mainBookkeeping` (globs), `scopeEnforcement` (prompt-only, manifest, credential), `execution`, `ingestsUntrustedInput` |
| Results    | `artifactGlobs`, `statePaths` (path, source, required, hint), `outcome` (json-block, jsonl or report), `reasonCodes` (per agent, never merged), `trackFindings`                                                                                                                      |
| Limits     | `budget` (daily cost cap, max turns, max wall clock), `spawnsSubagents`, `defaultSchedule`, `disabled` (with a reason), `notes`                                                                                                                                                      |

Write scope determines the workspace policy, which credentials are mounted, and
the minimum role to trigger. The tiers are ordered least to most privileged, and
the order is load-bearing. `mainBookkeeping` is orthogonal to the tier, because
two agents commit their own state files straight to the default branch at
different tiers (Section 14). `scopeEnforcement` is a to-do list, not a
description: `prompt-only` means the restraint is a sentence in a prompt until a
manifest makes it real.

### 6.1 Prompt rendering

Because prompts are repo-owned, the console must reproduce Claude Code's
argument substitution rather than inventing its own. The renderer handles `$1`,
`$2`, `${1:-main}`, and `$ARGUMENTS`, and it validates against `args` before
substituting so a missing required argument fails at enqueue time and not
thirty seconds into a run. Frontmatter (`argument-hint`, `description`,
`tools`) is parsed and stripped; where a repo file declares `tools:`, that
declaration is intersected with the manifest allow-list and the narrower of the
two wins.

### 6.2 Registry sync

A `syncRegistry` job scans a repo's `.claude/commands/` and `.claude/agents/` at
a given ref and reconciles:

- a file with no manifest overlay becomes an `Agent` row in `UNREGISTERED`
  state, visible in the UI with a "needs a tool policy and write scope before it
  can run" badge. This is how a new agent shows up in the console without
  anyone editing the console.
- a manifest whose prompt path no longer exists is flagged `ORPHANED` and its
  Run button disabled; history is preserved.
- an `argument-hint` that no longer matches the manifest `args` raises a drift
  warning. Argument drift is the most likely silent breakage, since the prompt
  body reads positional slots.

### 6.3 Cross-run state is a first-class input

Several agents read state written by earlier runs: metrics and queue files, order
files, per-PR notes. State is an input, not a by-product.

Where that state is committed to the target repo, a fresh workspace at
`origin/main` has it. That is the reason `statePaths` exists in the manifest: the
worker verifies those paths are present after checkout and fails fast with a
useful message ("`.week-plan/queue.jsonl` missing, run `plan-week` first")
instead of letting the agent discover it.

State that is git-ignored does not travel with a checkout. Each `statePaths`
entry therefore carries a `source`, `repo` or `artifact-store`: for the latter
the worker primes the path from the artifact store before the run and writes it
back after.

## 7. Execution modes and what the UI does with them

- **`unattended`.** Run button enabled for operators. Runs in the worker.
- **`needs-human`.** Run button enabled, with a warning on the confirm dialog
  that the run may pause. When the agent asks a question, the worker sets the
  run `AWAITING_INPUT`, persists the question as a `RunEvent`, and stops
  consuming. The UI surfaces it on the run detail page and in a global "needs
  you" list. An operator answers from the run detail page and the run resumes.
- **`needs-local-session`.** Run button disabled in the hosted console, with the
  reason shown inline ("needs the Chrome extension on your machine"). If
  `unattendedIfArgs` is satisfied by the submitted arguments, the button
  enables. Section 13 describes the local runner that removes this limitation.

The important property: an agent that cannot run headless is _visible and
explained_ in the console rather than absent or silently broken.

## 8. Data model

The model lives in `packages/core/prisma/schema.prisma`; that file is the source
of truth and this section describes it. Enum-like columns are strings and
structured columns are JSON text on SQLite; on Postgres they become enums and
`Json`.

| Entity       | Holds                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Repo`       | A target repository: slug, remote URL, local clone source, default branch, `.claude` directory. Archived, never deleted, once any run references it.                                                                                              |
| `Agent`      | One registered agent: kind, state (active, unregistered, orphaned, disabled), write scope, execution mode, and a snapshot of its manifest taken at sync time.                                                                                     |
| `AgentRepo`  | Which repos an agent applies to, and whether it is enabled for each.                                                                                                                                                                              |
| `User`       | An operator with a role (viewer, operator, admin).                                                                                                                                                                                                |
| `Run`        | One execution: agent, repo, status, trigger (ui, schedule, api, parent), arguments, who triggered it, cost, tokens, turns, and the Notary's provenance (base ref and SHA, branch, head SHA, PR, ticket keys). A run tree hangs off `parentRunId`. |
| `RunEvent`   | The ordered event log of a run, `seq` unique per run, which is what makes replay possible.                                                                                                                                                        |
| `Artifact`   | A file an agent wrote that outlives the workspace: kind, path, storage key.                                                                                                                                                                       |
| `RunOutcome` | The structured result an agent declared (outcome, reason code, full payload). This is what gets charted.                                                                                                                                          |
| `Finding`    | One thing an agent found, kept across runs under a fingerprint (agent, file, normalised claim), with a state (open, filed, closed) and the tracker issue it was filed as.                                                                         |
| `Workspace`  | A leased git worktree: path, state (idle, leased, dirty, destroying), the run that leased it.                                                                                                                                                     |
| `Schedule`   | A cron schedule for an agent and repo, with arguments. Schedules share the enqueue path with the UI.                                                                                                                                              |
| `Ledger`     | Spend per day per scope (`global`, `agent:<id>`, `repo:<slug>`), which is what the budget gate reads.                                                                                                                                             |

Run status is one of: queued, running, awaiting_input, succeeded, failed,
cancelled, budget_stopped, timed_out.

## 9. Workspace lifecycle

The worker keeps one bare mirror per repo and creates a `git worktree` per run.
Worktrees are cheap, and each run gets its own branch and index, so parallel
runs cannot collide. This matters concretely: `work-queue` creates a branch per
work order and `plan-week` reasons about hot files across open branches, so two
runs sharing one checkout would corrupt both.

1. **Lease.** Pick an idle worktree for the repo or create one. Record
   `workspaceId` on the run.
2. **Prime.** `git fetch origin`, hard reset to the requested `baseRef`, clean
   untracked files, record `baseSha` on the run. Verify `statePaths` exist.
3. **Sandbox profile and credentials.** The worker builds the container for the
   write scope (Section 0). Credentials are mounted only if the write scope
   requires them. `read-only`,
   `artifacts`, and `working-tree` runs get no push credential and no GitHub
   token. This makes "the agent cannot push" a property of the environment, not
   of the prompt. If `mainBookkeeping` is granted, the push credential is
   available only through the guarded-push helper described in Section 14, which
   validates the staged diff against the declared globs.
4. **Run.** Execute with `cwd` set to the worktree.
5. **Collect.** Resolve `artifactGlobs`, upload to the object store, create
   `Artifact` rows. Parse `outcome` into `RunOutcome` rows. Record `branch`,
   `headSha`, `prUrl`, and any ticket keys found in the transcript.
6. **Release.** If the tree is clean, return the worktree to the pool. If dirty,
   mark `dirty` and destroy it. Never reuse a dirty worktree.

Two safety rules worth stating: an uncommitted change outside the agent's
declared scope aborts the run and preserves the worktree for inspection, and a
run that exceeds `maxWallClockMinutes` is cancelled with `TIMED_OUT` and its
worktree destroyed.

### Repo hooks

A target repo can declare hooks in its own `.claude/settings.json`, for example a
`PostToolUse` hook that type-checks after every edit or a `Stop` hook that runs a
dead-code scan. In a worker these cost real wall-clock time and, indirectly, real
money. The manifest's `maxWallClockMinutes` must account for them, and the worker
decides per agent whether to honour the repo's hooks or run with them disabled.
Read-only agents gain nothing from either.

## 10. Run lifecycle

1. An operator clicks Run (or a schedule fires). The API validates args against
   the manifest, checks the execution mode is satisfiable, checks the operator's
   role against the write scope, checks the daily ledger for both the global and
   the `agent:<id>` scope, creates a `Run` row (`queued`), and enqueues a job
   carrying `{ runId, agentId, repoId, args }`.
2. The worker picks up the job, leases a workspace, sets the run `running`, loads
   the manifest, resolves and renders the prompt, builds the sandbox, and starts
   the harness.
3. For each harness message, the worker appends a `RunEvent` (ordered by `seq`)
   and announces it on the run's channel. Subagent messages create or update a
   child `Run` and are announced on both the child and the parent channel.
4. If the agent asks a question, the run goes `awaiting_input` with the question
   persisted.
5. On the final result, the worker records cost, tokens and turns, collects
   artifacts and outcomes, records findings, sets the terminal status, rolls
   child costs into the parent, and updates the `Ledger` for every scope.
6. The workspace is released. The UI shows live logs during the run and the
   persisted transcript plus artifacts, PR links and ticket links afterwards.

## 11. Worker: the harness, budget and permissions

The worker runs an agent through a `Harness` adapter: `start(spec, sandbox)`
yields normalised events, `cancel()` stops it, and `capabilities` says what the
harness supports. The raw vendor payload is kept beside each normalised event, so
nothing is lost by normalising. `claude-code` is one implementation; others
follow the same interface. The loop in `packages/core/src/runner.ts` is the
reference for the order of operations: budget gate, lease, render the prompt,
run, collect, record usage, release.

- **Pin the vendor surface.** The harness and SDK field names (permission
  callbacks, usage fields, how subagent messages are surfaced) shift across
  releases. Pin the version and keep the field access in one adapter module, so a
  version bump touches one file.
- **Budget is enforced four ways:** a pre-flight day-cap gate on both the global
  and per-agent scope, a per-run turn limit, a wall-clock timeout, and queue
  concurrency. For mid-run cost stops, the loop breaks when running cost crosses
  a threshold. A failed run's spend is still recorded.
- **Write scope is enforced in layers on purpose** (Section 0): the sandbox
  profile blocks the effect, harness-native configuration gives a clean denial,
  and the permission callback applies the fine rules. Either layer alone is one
  bug away from a surprise push.

## 12. Web and API

API routes (Next.js route handlers under `apps/web/app/api`):

- `GET /api/repos` and `GET /api/repos/[slug]/agents` list the registry per repo.
- `GET /api/agents` returns the registry with state (`ACTIVE`, `UNREGISTERED`,
  `ORPHANED`), write scope, execution mode, and last run summary.
- `GET /api/runs?agentId=&repoId=&status=&outcome=` returns run history, filtered.
- `POST /api/runs` validates args, checks the role against the agent's write
  scope, checks the execution mode is satisfiable with the submitted args,
  creates the `Run`, enqueues the job. Returns `{ runId }`.
- `POST /api/runs/[id]/cancel` cancels a queued or running job.
- `POST /api/runs/[id]/answer` answers an `awaiting_input` question.
- `GET /api/runs/[id]/events` is the SSE endpoint. It replays persisted
  `RunEvent`s in `seq` order, then subscribes to the run's notification channel, and closes on a
  terminal status. Child run events are relayed on the parent channel too, so
  one stream renders the whole tree.
- `GET /api/artifacts/[id]` streams an artifact from the object store.
- `POST /api/registry/sync` (admin) triggers a registry reconcile for a repo.
- `GET /api/findings?repoSlug=&state=` lists findings; `POST
/api/findings/[id]/file` (operator, on a click) files one as an issue on the
  repo's own tracker. It writes to the tracker, never to the repo.

UI pages:

- **Agents grid**, grouped by repo. Each card shows name, write scope as a badge
  (read-only through external-writes), execution mode, last run status, 7-day
  cost, and a Run action whose enabled state comes from role plus execution mode.
  `UNREGISTERED` agents appear greyed with what they are missing.
- **Agent detail**: run history table with outcome and reason-code columns, a
  cost/token sparkline, an outcome-mix chart over time, and the latest artifacts.
- **Run detail**: the SSE transcript rendered as a tree (parent, subagent and
  batch children, each with its own cost), the workspace provenance line (repo,
  base SHA, branch, PR), the artifact list, the parsed outcome record, and the
  question panel if the run is `AWAITING_INPUT`.
- **Needs you**: every run in `AWAITING_INPUT`, plus the aggregated
  `needs-decision` and `undecided-design` reason codes from parked work orders.
  This is the page that turns agent output into a human work queue.
- **Findings**: per repo, open, filed and closed, each with the claim, the
  measured value and the command that measured it, and a File issue action.
- **Budget**: ledger by day, by agent, and by repo, against configured caps.

## 13. The local-session runner (removes the `needs-local-session` limit)

`plan-week` needs the Chrome extension to read the calendar, and the extension
is only reachable from a session on your own machine. Rather than treat that as
permanently out of scope, the console supports a second executor: a small Node
process the operator runs locally that authenticates to the console, polls for jobs whose
agent is `needs-local-session` (or whose repo checkout is local), executes them
with the same `runAgent` code path, and publishes events back over the same API.

The contract does not change: the API still enqueues, something else still
executes, and runs are still durable records. The only difference is which
executor picks up the job. This also gives a clean answer for agents that need
any other locally-bound resource later.

## 14. Auth, RBAC, and write scope

Auth.js with the team IdP (OIDC/SAML). Roles map to write scope rather than to a
flat "can trigger" bit, because the difference between an agent that greps and
an agent that pushes to a PR branch is the whole risk story.

| Write scope       | Minimum role to trigger | Credentials mounted                         |
| ----------------- | ----------------------- | ------------------------------------------- |
| `read-only`       | VIEWER                  | none                                        |
| `artifacts`       | OPERATOR                | none                                        |
| `working-tree`    | OPERATOR                | none                                        |
| `branch-push`     | OPERATOR                | git push (deploy key, non-default branches) |
| `draft-pr`        | OPERATOR                | git push + GitHub token (PR create only)    |
| `external-writes` | ADMIN                   | git push + GitHub token + Jira token        |

`mainBookkeeping` is granted separately and is not a tier. An agent that has it
may push to the default branch, but only through the worker's guarded-push
helper, which refuses unless every path in the staged diff matches the declared
globs and the commit message carries `[skip ci]`. So `plan-week` sits at
`artifacts` and still gets its `.week-plan/` commit, and no agent gets a
general-purpose push to `main`. This is the one place where a credential alone
cannot express the policy, so the code path has to.

Registering a new agent, raising an existing agent's write scope, or granting
`mainBookkeeping` is an ADMIN action. Record `triggeredById` on every run for the
audit trail. The web session never carries tool credentials; only the executor
does.

Two global denials apply to every agent regardless of scope: no writes under
`.claude/` (that is the registry's own source, and an agent editing it would
rewrite its own permissions) and no writes to `.env*`, CI config, or release
config. `work-queue` already forbids these in prose; the console makes them
structural.

Agents with `ingestsUntrustedInput: true` (`plan-week` reading calendars,
`fix-pr-comments` reading review comments, `work-order-scoper` reading Jira
text) get the tighter treatment: external text is data and never instruction,
and their tool policy should not include anything that could act on injected
text. `plan-week`'s own rule generalizes well: never put ingested text into a
Jira issue or PR body.

## 15. Configuration and secrets

```
# .env.example
DATABASE_URL=postgresql://...
AUTH_SECRET=...
AUTH_ISSUER=...            # any OIDC provider
S3_ENDPOINT=...            # artifact store
S3_BUCKET=...
# gateway-only secrets (never in the web tier or the sandbox):
PROVIDER_API_KEYS=...      # held by the LLM gateway; a run gets a capped virtual key
# executor-only secrets (never exposed to web):
GIT_SSH_KEY=...            # deploy key, push to non-default branches only
GITHUB_TOKEN=...           # PR create + review threads
JIRA_BASE_URL=...
JIRA_EMAIL=...
JIRA_API_TOKEN=...
WORKSPACE_ROOT=/var/agent-workspaces
```

Split env by service in Compose so the web image does not even receive the
executor secrets, and split further per write scope if the executor is sharded
(a read-only worker pool with no credentials at all is a cheap, strong
guarantee).

## 16. Deployment

```yaml
# docker-compose.yml (sketch)
services:
    postgres: { image: postgres:16, volumes: ["pgdata:/var/lib/postgresql/data"] }
    gateway: { image: litellm, environment: [DATABASE_URL, PROVIDER_API_KEYS] }
    minio: { image: minio/minio, command: server /data, volumes: ["s3data:/data"] }
    web:
        build: { context: ., dockerfile: apps/web/Dockerfile }
        environment: [DATABASE_URL, AUTH_SECRET, AUTH_ISSUER, S3_ENDPOINT, S3_BUCKET]
        ports: ["3000:3000"]
        depends_on: [postgres, minio]
    worker:
        build: { context: ., dockerfile: apps/worker/Dockerfile }
        environment:
            [
                DATABASE_URL,
                GIT_SSH_KEY,
                GITHUB_TOKEN,
                JIRA_BASE_URL,
                JIRA_EMAIL,
                JIRA_API_TOKEN,
                WORKSPACE_ROOT,
            ]
        volumes: ["workspaces:/var/agent-workspaces"]
        depends_on: [postgres, gateway, minio]
volumes: { pgdata: {}, s3data: {}, workspaces: {} }
```

Solo mode is the same file with auth off; a team adds an OIDC provider.

The sandbox image needs the target repos' toolchain, because the agents run it:
Node at the version in `.nvmrc`, `npm ci` warm cache, `git`, the `gh` CLI plus
the `k1LoW/gh-copilot-review` extension, and Python if the smell runner is
registered. Scale workers horizontally; queue concurrency plus the scoped ledger
keep spend bounded. Run the worker in a hardened container since it executes
agent tools.

## 17. Security considerations

The executor is remote code execution by design. Keep it in a locked-down
container, never expose it to the public internet, hold provider keys only in the
gateway and tool credentials only in the worker, mount credentials per write
scope rather than globally, enforce scope with the sandbox first and the tool gate
second, cap spend per agent and per day, bound wall clock, and audit who
triggered each run. Treat every agent that can write files or reach external
systems as higher-risk and require ADMIN to register it. Treat all external text
an agent reads (calendar events, Jira descriptions, PR comments) as data and
never as instruction, and never copy it into an artifact that another system will
act on.

## 18. References

- [Agent SDK reference (TypeScript), Claude API Docs](https://docs.claude.com/en/api/agent-sdk/typescript)
- [Agent SDK overview, Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/overview)
- [Streaming input vs single mode, Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [Subagents, Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [Slash commands and argument substitution, Claude Code Docs](https://code.claude.com/docs/en/slash-commands)
