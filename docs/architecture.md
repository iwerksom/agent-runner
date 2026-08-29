# Arnold: Architecture

> Agent Runner, Notary, Orchestrator, Ledger, Dispatcher.
>
> This is the plan of record. It was written before the code, and the code has
> since diverged in places: see `docs/HANDOVER.md` for what is actually built,
> and `docs/DECISIONS.md` for the choices made while building it.

A console for running Claude-based agents: list the registered agents, see data
from their runs (status, cost, tokens, logs, artifacts, tickets, PRs), and
trigger a run from the UI. This document is written to be scaffolded from
directly, and the phased plan ends at a working hosted app but starts with a POC
you can stand up quickly (see Section 17).

The design target is not a UI for one particular agent, or for one particular
project. It is a host that can run **any** Claude agent in **any** repo: the
slash commands and subagents already sitting in a project's `.claude/`
directory, the ones not written yet, and agents belonging to other repos
entirely. Section 5 defines the contract an agent must satisfy to be
console-runnable; everything else follows from it.

The registry bundled with this repo (`registry/example-repo/`) is a reference
set: seven real manifests, one per agent kind and one per write scope, written
against a project that is no longer the point. Read them as worked examples and
templates, then add a directory for your own repo.

## 1. Goals and non-goals

In scope: a registry of agents that can be reconciled from a repo's `.claude/`
directory, durable run history with cost/token accounting, live and replayable
run logs including nested subagent activity, one-click execution against a
managed git workspace, ingestion of the artifacts and metrics agents already
emit, and the same execution path used by schedules. Multi-user with a
viewer/operator/admin split. Multiple target repos.

Out of scope (for now): a visual agent builder, a general step-by-step approval
UI, and cross-tenant isolation beyond a single team.

## 2. Locked decisions

- Execution: TypeScript Agent SDK (`@anthropic-ai/claude-agent-sdk`), in a
  dedicated worker process.
- Deployment: hosted, multi-user, containerized.
- Codebase: standalone monorepo (not inside the product repo).
- UI/API: Next.js App Router, HeroUI, Tailwind.
- Store: Postgres (via Prisma). Queue and log pub/sub: Redis (BullMQ + pub/sub).
- Auth: Auth.js against the team IdP, with role-based access
  (viewer/operator/admin).
- **Prompts stay in the target repo.** A manifest points at
  `.claude/commands/<id>.md` or `.claude/agents/<id>.md` in a checked-out repo.
  The repo is the single source of truth for prompt bodies; the console owns only
  the metadata the repo files do not carry (tool policy, budget, schedule,
  execution mode, write scope).
- **Every run gets a git workspace.** Mutating agents are first-class, not a
  later exception. The worker leases an isolated checkout per run, the agent
  works there, and the workspace is torn down or returned to the pool.
- **Multi-repo from the data model.** A `Repo` entity exists from day one even
  though Phase 0 seeds only one.
- **Execution mode is declared, not assumed.** Agents that need a human mid-run
  or a local browser session are representable and are not silently launched
  into a headless worker.

## 3. Architecture overview

The web tier never executes an agent. It enqueues a job and returns. A separate
worker owns execution, the workspace, and the budget. This decoupling matters
because runs take minutes, must survive page reloads, and require tool
credentials the web tier should never hold.

Flow: UI -> API validates args and enqueues a job (Redis) -> Worker dequeues ->
Worker leases a git workspace for the run's repo -> Worker resolves the prompt
from the repo files and runs the agent via the SDK `query()` loop -> each SDK
message becomes a log event published to Redis and persisted to Postgres ->
declared artifacts and metrics lines are collected from the workspace -> the
run's final `result` usage is folded into a daily ledger -> the workspace is
released -> the UI streams logs over SSE (subscribing to the Redis channel) and
reads run records, artifacts, and outcomes from Postgres.

The worker is the single trust boundary. `ANTHROPIC_API_KEY`, git push
credentials, the GitHub token, and Jira credentials live only there.

## 4. Technology stack and rationale

| Concern        | Choice                                                    | Why                                                                                                         |
| -------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| UI + API       | Next.js App Router, HeroUI, Tailwind                      | Team familiarity; SSE support in route handlers                                                             |
| Execution      | `@anthropic-ai/claude-agent-sdk`                          | In-process streaming messages, structured usage, subagent visibility, finer permission control than the CLI |
| Worker         | Standalone Node process                                   | Long-running, holds secrets, owns workspaces, isolated from web                                             |
| Workspaces     | Bare mirror clone + `git worktree` per run                | Cheap isolated checkouts; parallel runs cannot collide on a branch                                          |
| Store          | Postgres + Prisma                                         | Durable multi-user run history, artifacts, ledger                                                           |
| Queue          | Redis + BullMQ                                            | Retries, concurrency caps, rate limiting (helps budget control)                                             |
| Log transport  | Redis pub/sub -> SSE                                      | Cross-process live logs; full transcript persisted in Postgres                                              |
| Artifact store | S3-compatible object store (filesystem volume in Phase 0) | Reports and order files outlive the workspace                                                               |
| Auth           | Auth.js + team IdP                                        | Self-hosted SSO with simple RBAC                                                                            |
| Packaging      | pnpm workspaces                                           | Shared types between web and worker                                                                         |
| Containers     | Docker Compose (then K8s)                                 | Web and worker as separate images                                                                           |

## 5. What makes an agent console-runnable

This is the contract. An agent is registrable when all six hold. Anything that
fails one of these is either fixed in the agent or declared in the manifest so
the console can degrade gracefully rather than fail at runtime.

1. **Declared arguments.** Positional arguments have names, types, and required
   flags in the manifest, mapped to the `$1` / `$2` / `${1:-default}` slots the
   prompt body actually uses. The console renders the prompt; it does not pass a
   raw string and hope.
2. **Declared tool policy.** An allow-list of tool patterns. Repo command files
   carry no `tools:` frontmatter (only the two subagents do), so the policy
   lives in the console manifest and is enforced in code via `canUseTool`, never
   by prompt wording alone.
3. **Declared write scope.** One of the tiers in Section 8. The console derives
   the workspace policy, the required role, and whether push credentials are
   even mounted from this value.
4. **Declared execution mode.** `unattended`, `needs-human`, or
   `needs-local-session` (Section 9).
5. **Structured terminal output.** Either a fenced JSON block, an appended JSONL
   metrics line, or a report file at a declared path. A run whose only output is
   prose is still valid but produces no `RunOutcome` row and therefore no
   trend data.
6. **Declared artifacts.** Glob patterns, relative to the workspace root, for
   every file the agent writes that should outlive the run.

## 6. Agent kinds

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

## 7. Agent registry (manifest)

An agent is a declarative record the UI renders and the worker executes.
Manifest overlays live in the console at `registry/<repo-slug>/<id>.ts`, because
the repo files carry none of this metadata. The `Agent` table is seeded and
reconciled from them.

````ts
// packages/core/src/agents.ts

export type AgentKind = "command" | "subagent" | "harness" | "native";

/** Where the prompt body comes from. Repo-sourced is the default. */
export type PromptSource =
	| { kind: "repo"; path: string } // ".claude/commands/pre-pr-review.md"
	| { kind: "console"; path: string } // "agents/<id>/prompt.md"
	| { kind: "script"; command: string }; // harness entrypoint, e.g. a python runner

/**
 * Write scope determines the workspace policy, which credentials are mounted,
 * and the minimum role required to trigger. Ordered least to most privileged.
 */
export type WriteScope =
	| "read-only" // no writes at all
	| "artifacts" // writes only inside artifactGlobs
	| "working-tree" // edits product code, no VCS operations
	| "branch-push" // creates a branch, commits, pushes
	| "draft-pr" // also opens draft PRs
	| "external-writes"; // Jira issues, PR comments, thread resolution

/**
 * Orthogonal to WriteScope, because two agents need it at different tiers:
 * a commit and push directly to the default branch, restricted to these paths.
 * Both `plan-week` and `work-queue` commit their own state files to `main`,
 * so a flat "never push to main" credential rule cannot execute them.
 * The worker validates the staged diff against these globs before pushing.
 */
export type MainBookkeeping = { paths: string[] };

export type ExecutionMode =
	| "unattended" // safe in a headless worker
	| "needs-human" // may block mid-run waiting on a decision
	| "needs-local-session"; // needs a tool only reachable from a local machine

export type ToolPolicy = {
	allowedTools: string[]; // e.g. ["Read","Glob","Grep","Bash(git *)","Bash(npx tsc*)"]
	permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions";
	mcpServers?: string[]; // e.g. ["atlassian"] - must be provisioned in the worker
};

export type ArgSpec = {
	name: string; // "prNumber"
	slot: string; // "$1", "${1:-main}", "--windows="
	type: "string" | "number" | "boolean";
	required?: boolean;
	default?: string;
	description: string;
};

/**
 * Where read-only or scoped behaviour actually comes from. Repo command files
 * carry no `tools:` frontmatter at all, and the two subagents declare only
 * `tools: Read, Grep, Glob, Bash` (unrestricted Bash), so in every current
 * agent the restraint is prompt text. The console must never treat a prompt
 * sentence as enforcement.
 */
export type ScopeEnforcement = "prompt-only" | "manifest" | "credential";

export type OutcomeSpec =
	| { kind: "json-block" } // last fenced ```json block in the final message
	| { kind: "jsonl"; path: string } // ".pr-loop/metrics.jsonl"
	| { kind: "report"; pathGlob: string }; // ".pr-loop/reports/PR-*-*.md"

export type AgentManifest = {
	id: string; // matches the repo filename, e.g. "pre-pr-review"
	name: string;
	description: string;
	kind: AgentKind;
	prompt: PromptSource;
	repos: string[]; // repo slugs this agent applies to, or ["*"]
	invocable: "direct" | "child";
	args: ArgSpec[];
	model?: string;
	tools: ToolPolicy;
	writeScope: WriteScope;
	mainBookkeeping?: MainBookkeeping;
	/** How the declared scope is enforced today. "prompt-only" is a to-do, not a state. */
	scopeEnforcement: ScopeEnforcement;
	execution: ExecutionMode;
	/** Args whose presence downgrades the execution mode to unattended. */
	unattendedIfArgs?: string[];
	/** Relative globs for files worth keeping after the workspace is released. */
	artifactGlobs: string[];
	/** State directories the agent reads across runs and that must be primed. */
	statePaths: string[];
	outcome?: OutcomeSpec;
	/** Reason / outcome codes this agent is allowed to emit, for grouping in the UI. */
	reasonCodes?: string[];
	budget: { dailyCostCapUsd: number; maxTurns: number; maxWallClockMinutes: number };
	/** True when the agent reads text from outside the repo (calendars, tickets, PR comments). */
	ingestsUntrustedInput?: boolean;
	spawnsSubagents?: string[];
	defaultSchedule?: string; // cron, optional
};
````

### 7.1 Prompt rendering

Because prompts are repo-owned, the console must reproduce Claude Code's
argument substitution rather than inventing its own. The renderer handles `$1`,
`$2`, `${1:-main}`, and `$ARGUMENTS`, and it validates against `args` before
substituting so a missing required argument fails at enqueue time and not
thirty seconds into a run. Frontmatter (`argument-hint`, `description`,
`tools`) is parsed and stripped; where a repo file declares `tools:`, that
declaration is intersected with the manifest allow-list and the narrower of the
two wins.

### 7.2 Registry sync

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

## 8. The current agents

The bundled reference registry describes seven distinct agent ids found in one
project's `.claude/` directory (`pr-loop-analyzer` exists as both a command and
a subagent, and the two copies differ in behaviour), plus one harness living
outside `.claude/` as a script. They are kept because between them they cover
every agent kind and every write scope the model supports, which makes them the
best available worked examples. The table is the registry seed; the per-agent
notes capture what a manifest must encode.

| id                  | kind                   | invocable                      | write scope                                         | main bookkeeping                              | execution           | spawns                 |
| ------------------- | ---------------------- | ------------------------------ | --------------------------------------------------- | --------------------------------------------- | ------------------- | ---------------------- |
| `ai-smell-scan`     | `command`              | child (via the runner harness) | `read-only`                                         | no                                            | unattended          | none                   |
| `ai-smell-runner`   | `harness`              | direct                         | `external-writes`                                   | no                                            | unattended          | `ai-smell-scan` xN     |
| `pre-pr-review`     | `command`              | direct                         | `working-tree`                                      | no                                            | unattended          | none                   |
| `pr-loop-analyzer`  | `command` + `subagent` | direct and child               | `artifacts` (command), `external-writes` (subagent) | no                                            | unattended          | none                   |
| `fix-pr-comments`   | `command`              | direct                         | `external-writes`                                   | no (pushes `.pr-loop/` to the PR head branch) | needs-human         | `pr-loop-analyzer`     |
| `plan-week`         | `command`              | direct                         | `artifacts`                                         | yes, `.week-plan/**`                          | needs-local-session | `work-order-scoper` xN |
| `work-order-scoper` | `subagent`             | child                          | `read-only`                                         | no                                            | unattended          | none                   |
| `work-queue`        | `command`              | direct                         | `draft-pr`                                          | yes, `.week-plan/**`                          | unattended          | none                   |

Every row's `scopeEnforcement` is `prompt-only` today. That is the single
highest-value thing the console adds: turning eight prompt sentences into eight
manifest allow-lists plus a credential policy.

**`ai-smell-scan`** takes `$1` jira project key, `$2` report path (read-only
context for the agent; the runner owns the file), `$3` path to the
newline-delimited batch file. Its prompt asserts "You have no write tools", but
nothing enforces that, so the manifest allow-list is where read-only becomes
real: `Read`, `Grep`, `Bash(npx tsc --noEmit)` capped at one call per invocation,
and `Bash(npx eslint*)` with the batch paths passed explicitly (only the tsc call
is capped in the prompt). The allow-list should also permit reading
`reports/knip.json`, which the agent prefers over re-running knip. Its outcome is
the last fenced `json` block in its final message with `batch`, `findings[]`, and
`notes`. Note
for the worker: plugin-provided MCP servers do not load in a headless `claude -p`
process, which is why this agent files nothing itself. The console's worker uses
the SDK rather than the CLI, so MCP availability must be re-verified per agent
rather than assumed either way.

**`ai-smell-runner`** is the harness. It owns the report file, the daily budget
across batches, and Jira ticket creation over the REST API. Registering it
directly is what makes "run a smell scan" a single button.

**`pre-pr-review`** takes `${1:-main}` as the base branch. It edits the working
tree and explicitly does not push or open a PR unless asked, so `working-tree`
is the correct ceiling and the worker should not mount push credentials for it.
Its verification chain is `npx tsc --noEmit`, `npx vitest run <paths>`,
`npx eslint <changed files>`, `npm run knip:production`. It produces no files,
so it has no artifacts and its value in the console is the transcript plus the
printed summary.

**`pr-loop-analyzer`** exists twice, and the two copies differ in write scope:
the command version writes only a report under `.pr-loop/reports/`, while the
subagent version also files Jira issues (a configured Jira project, issue type Task, under a fixed parent issue,
label `tooling`) or writes `.pr-loop/enhancements/<slug>.md`. Register them as
two rows sharing a name, or reconcile the files first. Worth flagging as a
finding rather than papering over in the manifest: the subagent declares
`tools: Read, Grep, Glob, Bash` but must write files, so its declared policy is
already inconsistent with its behaviour. Its verdicts
(`converged-on-final-recheck`, `process-improvement-warranted`,
`no-change-needed`) make good `reasonCodes`.

**`fix-pr-comments`** takes `$1` PR number and derives `TICKET` from the head
branch via `[A-Z]+-\d+`. It is the most privileged agent: it edits code, commits,
pushes to the PR head branch, posts and resolves review threads over the GitHub
GraphQL API, may create Jira issues, and appends to `.pr-loop/PR-$1.md` and
`.pr-loop/metrics.jsonl`. It also has two genuine stop-and-ask points (no
resolvable ticket, and the same substantive comment reappearing after being
addressed), which is exactly what `needs-human` is for. Its terminal cases
(`clean`, `minors_only`, `converged_on_recheck`, `cap_not_converged`,
`copilot_error`, `wait_timeout`, `tool_error`) plus the `metrics.jsonl` schema
give the console a real outcome funnel for free. Prerequisite in the worker
image: the `k1LoW/gh-copilot-review` gh extension.

**`plan-week`** takes `$1` ISO week, `--windows=`, and `--hours=N`. Its write
scope is `artifacts` (`.week-plan/**`) plus main bookkeeping: it never creates a
branch, and its only push is `git checkout main && git pull`, stage the explicit
`.week-plan/` paths, commit, push. A flat "deploy key cannot push to `main`"
credential rule would make it unrunnable, which is why `mainBookkeeping` is
orthogonal to the scope tier. Capacity
source 0 is the Claude in Chrome MCP reading Google Calendar, which is only
reachable from a session on your own machine, so the default execution mode is
`needs-local-session`. Passing `--windows=` or `--hours=` removes that
dependency, which is precisely what `unattendedIfArgs: ["windows", "hours"]`
encodes: the console enables the Run button only once one of those is supplied,
and otherwise routes the run to the local runner bridge (Section 15). It needs
the Atlassian MCP server (`getAccessibleAtlassianResources`,
`searchJiraIssuesUsingJql`, `getJiraIssue`) and hard-stops if no Atlassian tool
is reachable, which the console should pre-flight rather than discover mid-run.
Its writes are confined to `.week-plan/` plus that bookkeeping commit. It is
`ingestsUntrustedInput: true`: calendar content is data, never instruction. Its
own reject codes, emitted by its step-4 screen before any subagent is spawned,
are `needs-visual-judgment`, `undecided-design`, `external-dependency`,
`hot-files: <branch>`, `too-large-to-split`, `no-window`, and `not-reversible`.

**`work-order-scoper`** is spawned once per survivor of `plan-week`'s screen,
many concurrently, and receives `WO-<n>`, the full Jira issue text, the ticket
key, the hot-file set, and the usable window minutes. It returns either a
rejection with a reason code or a work order body; the caller writes the file.
Its own rejection codes are a different list from its caller's:
`undecided-design`, `needs-visual-judgment`, `external-dependency`,
`hot-files: <branch>`, `too-large`, `stale-premise`. Note `too-large` (scoper)
against `too-large-to-split` (plan-week): the console must keep the two code
vocabularies per-agent rather than merging them into one enum, or the charts will
silently split one concept across two labels. These codes are the
highest-value thing in the whole system to chart over time, because they say
what is blocking the backlog from being agent-executable.

It declares `tools: Read, Grep, Glob, Bash` with unrestricted `Bash`, so its
read-only guarantee is prompt text ("you do not run git write commands") and
nothing more. Same finding as the analyzer below: the manifest allow-list has to
narrow `Bash` to the read-only invocations it actually needs.

**`work-queue`** takes `${1:-120}` minutes of runway and an optional `$2` WO id.
It is the reference `draft-pr` agent: branches off `origin/main`, edits code,
commits, pushes, opens draft PRs, and mutates `.week-plan/queue.jsonl`,
`log.jsonl`, and `parked/`. It also needs `mainBookkeeping`, both before the
first order (committing any pending `.week-plan/` state) and before stopping, so
`draft-pr` alone would block a required step.

Its guardrails are the console's guardrails too, and the manifest should encode
all of them: never push to `main` beyond bookkeeping, never force-push, never
change a PR base, never mark ready for review, never merge, never run
`/fix-pr-comments`, never edit `.env*` / CI config / release config /
`.claude/` workflow files, never create or edit Jira issues, never work on a
ticket that is not in the queue. The `.claude/` one deserves attention: the
worker mounts a real checkout, so an agent editing `.claude/` would be editing
the console's own registry source. Deny writes under `.claude/` for every agent
by default.

It is explicitly designed for unattended operation and turns ambiguity into a
park rather than a question, with codes `stale-premise`, `branch-exists`,
`needs-decision`, `verification-failed`.

### 8.1 Cross-run state is a first-class input

Five of the seven read state written by earlier runs: `plan-week` and
`work-order-scoper` read `.pr-loop/metrics.jsonl`, `work-queue` reads
`.week-plan/queue.jsonl` and the order files, and both `pr-loop-analyzer` copies
read `.pr-loop/PR-<n>.md` as their primary source, as does `fix-pr-comments` for
its own PR. State is an input, not a by-product.

Where that state is committed to the target repo, a fresh workspace at
`origin/main` has it. That is the reason `statePaths` exists in the manifest: the
worker verifies those paths are present after checkout and fails fast with a
useful message ("`.week-plan/queue.jsonl` missing, run `plan-week` first")
instead of letting the agent discover it.

The `.pr-loop/` case needs checking before Phase 4, because `fix-pr-comments`
explicitly handles the possibility that `.pr-loop/` is git-ignored (it runs
`git check-ignore` and refuses to force-add). If it is ignored in the real repo
then that state does not travel with a checkout at all, and the worker must prime
it from the artifact store before the run and write it back after. Design for
both: `statePaths` entries carry a `source: "repo" | "artifact-store"`.

### 8.2 Repo hooks affect cost and runtime

A target repo can declare hooks in its own `.claude/settings.json`. The project
these manifests were written against had a `PostToolUse` hook running
`npx tsc --noEmit` after every `.ts`/`.tsx` edit (timeout 120s) and a `Stop`
hook running `npm run knip` (timeout 300s). In a worker these are real
wall-clock and, indirectly, real cost. The manifest's `maxWallClockMinutes` must
account for them, and the worker should decide per agent whether to honour the
repo hooks or run with them disabled. Read-only agents gain nothing from either
hook.

## 9. Execution modes and what the UI does with them

- **`unattended`.** Run button enabled for operators. Runs in the worker.
- **`needs-human`.** Run button enabled, with a warning on the confirm dialog
  that the run may pause. When the agent asks a question, the worker sets the
  run `AWAITING_INPUT`, persists the question as a `RunEvent`, and stops
  consuming. The UI surfaces it on the run detail page and in a global "needs
  you" list. Phase 4 adds the answer path; before that, `AWAITING_INPUT` is a
  terminal state with the question preserved so a human can finish the job in
  local Claude Code.
- **`needs-local-session`.** Run button disabled in the hosted console, with the
  reason shown inline ("needs the Chrome extension on your machine"). If
  `unattendedIfArgs` is satisfied by the submitted arguments, the button
  enables. Section 15 describes the local runner that removes this limitation.

The important property: an agent that cannot run headless is _visible and
explained_ in the console rather than absent or silently broken.

## 10. Data model (Prisma)

```prisma
// packages/core/prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum RunStatus {
  QUEUED RUNNING AWAITING_INPUT SUCCEEDED FAILED CANCELLED
  BUDGET_STOPPED TIMED_OUT
}
enum Role { VIEWER OPERATOR ADMIN }
enum AgentState { ACTIVE UNREGISTERED ORPHANED DISABLED }
enum AgentKind { COMMAND SUBAGENT HARNESS NATIVE }
enum WriteScope { READ_ONLY ARTIFACTS WORKING_TREE BRANCH_PUSH DRAFT_PR EXTERNAL_WRITES }
enum ExecutionMode { UNATTENDED NEEDS_HUMAN NEEDS_LOCAL_SESSION }

model User {
  id    String @id @default(cuid())
  email String @unique
  role  Role   @default(VIEWER)
  runs  Run[]
}

model Repo {
  id            String @id @default(cuid())
  slug          String @unique          // "example-repo"
  name          String
  remoteUrl     String
  defaultBranch String @default("main")
  claudeDir     String @default(".claude")
  agents        AgentRepo[]
  runs          Run[]
  workspaces    Workspace[]
}

model Agent {
  id            String        @id       // manifest id, e.g. "work-queue"
  name          String
  description   String
  kind          AgentKind
  state         AgentState    @default(ACTIVE)
  invocable     String        @default("direct")  // direct | child
  writeScope    WriteScope
  /** Path globs this agent may commit to the default branch, or null. */
  mainBookkeeping Json?
  /** prompt-only | manifest | credential - surfaced as a badge in the UI. */
  scopeEnforcement String     @default("prompt-only")
  execution     ExecutionMode
  promptSource  Json                    // PromptSource
  manifest      Json                    // full AgentManifest snapshot at sync time
  repos         AgentRepo[]
  runs          Run[]
  schedules     Schedule[]
}

/** An agent applies to one or more repos; enablement is per pair. */
model AgentRepo {
  agentId String
  repoId  String
  enabled Boolean @default(true)
  agent   Agent   @relation(fields: [agentId], references: [id])
  repo    Repo    @relation(fields: [repoId], references: [id])
  @@id([agentId, repoId])
}

model Run {
  id            String    @id @default(cuid())
  agentId       String
  agent         Agent     @relation(fields: [agentId], references: [id])
  repoId        String?
  repo          Repo?     @relation(fields: [repoId], references: [id])

  // Run tree: harness and subagent invocations hang off a parent.
  parentRunId   String?
  parent        Run?      @relation("RunTree", fields: [parentRunId], references: [id])
  children      Run[]     @relation("RunTree")
  label         String?                        // "batch 3/12", "WO-4 scoper"

  status        RunStatus @default(QUEUED)
  triggeredById String?
  triggeredBy   User?     @relation(fields: [triggeredById], references: [id])
  trigger       String    @default("ui")       // ui | schedule | api | parent
  args          Json?

  // Workspace provenance: what code did this run actually see?
  workspaceId   String?
  baseRef       String?                        // "main"
  baseSha       String?                        // resolved commit
  branch        String?                        // branch the agent created
  headSha       String?
  prUrl         String?
  prNumber      Int?

  startedAt     DateTime?
  endedAt       DateTime?
  costUsd       Float     @default(0)
  tokens        Int       @default(0)
  numTurns      Int       @default(0)
  exitReason    String?
  ticketKeys    String[]  @default([])

  events        RunEvent[]
  artifacts     Artifact[]
  outcomes      RunOutcome[]
  createdAt     DateTime  @default(now())
  @@index([agentId, createdAt])
  @@index([repoId, createdAt])
  @@index([parentRunId])
  @@index([status])
}

model RunEvent {
  id      String   @id @default(cuid())
  runId   String
  run     Run      @relation(fields: [runId], references: [id])
  seq     Int                                   // ordering for replay
  type    String                                // assistant | tool_use | tool_result | result | log | question
  payload Json
  at      DateTime @default(now())
  @@index([runId, seq])
}

/** A file the agent wrote that must outlive the workspace. */
model Artifact {
  id        String   @id @default(cuid())
  runId     String
  run       Run      @relation(fields: [runId], references: [id])
  kind      String                              // report | work-order | parked | log | findings
  path      String                              // path relative to the workspace root
  storageKey String                             // object-store key
  mimeType  String
  sizeBytes Int
  createdAt DateTime @default(now())
  @@index([runId])
}

/**
 * The structured result an agent declares: a parsed JSON block, or one line of
 * the JSONL streams the agents already append to. This is what gets charted.
 */
model RunOutcome {
  id         String   @id @default(cuid())
  runId      String
  run        Run      @relation(fields: [runId], references: [id])
  outcome    String                             // "clean", "parked", "process-improvement-warranted"
  reasonCode String?                            // "hot-files", "needs-decision", "no-window"
  payload    Json                               // the whole parsed record
  at         DateTime @default(now())
  @@index([runId])
  @@index([outcome])
  @@index([reasonCode])
}

/** A leased git checkout. Reused across runs when clean, destroyed when dirty. */
model Workspace {
  id          String    @id @default(cuid())
  repoId      String
  repo        Repo      @relation(fields: [repoId], references: [id])
  path        String                            // worktree path on the worker volume
  state       String                            // idle | leased | dirty | destroying
  leasedByRun String?
  leasedAt    DateTime?
  lastUsedAt  DateTime  @default(now())
  @@index([repoId, state])
}

model Schedule {
  id       String  @id @default(cuid())
  agentId  String
  agent    Agent   @relation(fields: [agentId], references: [id])
  repoId   String
  cron     String
  args     Json?
  enabled  Boolean @default(true)
  lastRunAt DateTime?
}

/** Spend caps are per day and per scope, so an agent cannot eat the whole budget. */
model Ledger {
  scope    String                               // "global" | "agent:<id>" | "repo:<slug>"
  day      String                               // YYYY-MM-DD
  costUsd  Float  @default(0)
  tokens   Int    @default(0)
  runCount Int    @default(0)
  @@id([scope, day])
}
```

## 11. Workspace lifecycle

The worker keeps one bare mirror per repo and creates a `git worktree` per run.
Worktrees are cheap, and each run gets its own branch and index, so parallel
runs cannot collide. This matters concretely: `work-queue` creates a branch per
work order and `plan-week` reasons about hot files across open branches, so two
runs sharing one checkout would corrupt both.

1. **Lease.** Pick an idle worktree for the repo or create one. Record
   `workspaceId` on the run.
2. **Prime.** `git fetch origin`, hard reset to the requested `baseRef`, clean
   untracked files, record `baseSha` on the run. Verify `statePaths` exist.
3. **Credential mount.** Only if the write scope requires it. `read-only`,
   `artifacts`, and `working-tree` runs get no push credential and no GitHub
   token. This makes "the agent cannot push" a property of the environment, not
   of the prompt. If `mainBookkeeping` is granted, the push credential is
   available only through the guarded-push helper described in Section 16, which
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

## 12. Run lifecycle

1. Operator clicks Run (or a schedule fires). API validates args against the
   manifest, checks the execution mode is satisfiable, checks the operator's
   role against the write scope, checks the daily ledger for both the global and
   the `agent:<id>` scope, creates a `Run` row (`QUEUED`), and enqueues a BullMQ
   job carrying `{ runId, agentId, repoId, args }`.
2. Worker picks up the job, leases a workspace, sets the run `RUNNING`, loads the
   manifest, resolves and renders the prompt from the repo files, and starts the
   SDK `query()` loop.
3. For each SDK message, the worker appends a `RunEvent` (ordered by `seq`) and
   publishes it to `run:<runId>` on Redis. Subagent messages create or update a
   child `Run` and are published on both the child and the parent channel.
4. If the agent asks a question, the run goes `AWAITING_INPUT` with the question
   persisted.
5. On the `result` message, the worker records `costUsd`, `tokens`, `numTurns`,
   collects artifacts and outcomes, sets the terminal status, rolls child costs
   into the parent, and updates the `Ledger` for every scope.
6. The workspace is released. The UI shows live logs during the run and the
   persisted transcript plus artifacts, PR links, and ticket links afterward.

## 13. Worker: the SDK query loop, budget, and permissions

```ts
// apps/worker/src/runAgent.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { prisma, loadManifest } from "@agent-console/core";
import { publishEvent } from "./publish";
import { checkBudget, recordUsage } from "./ledger";
import { leaseWorkspace, releaseWorkspace } from "./workspace";
import { renderPrompt } from "./prompt";
import { collectArtifacts, parseOutcome } from "./collect";

export async function runAgent(
	runId: string,
	agentId: string,
	repoId: string,
	args: Record<string, string>,
) {
	const manifest = loadManifest(agentId);

	// Pre-flight budget gate: both the global cap and this agent's own cap.
	const gate = await checkBudget(["global", `agent:${agentId}`], manifest.budget);
	if (!gate.ok) {
		await prisma.run.update({
			where: { id: runId },
			data: { status: "BUDGET_STOPPED", exitReason: gate.reason, endedAt: new Date() },
		});
		return;
	}

	const ws = await leaseWorkspace(repoId, args.baseRef ?? "main", manifest);
	await prisma.run.update({
		where: { id: runId },
		data: {
			status: "RUNNING",
			startedAt: new Date(),
			workspaceId: ws.id,
			baseRef: ws.baseRef,
			baseSha: ws.baseSha,
		},
	});

	const prompt = await renderPrompt(manifest, args, ws.path); // repo file + $1/$2 substitution
	let seq = 0;
	let terminal: { cost: number; tokens: number; turns: number } | undefined;

	try {
		for await (const message of query({
			prompt,
			options: {
				cwd: ws.path,
				model: manifest.model,
				allowedTools: manifest.tools.allowedTools,
				permissionMode: manifest.tools.permissionMode,
				maxTurns: manifest.budget.maxTurns,
				// Hard enforcement of the tool policy, regardless of prompt content.
				// Write scope is enforced twice: here, and by not mounting credentials.
				canUseTool: async (tool, input) => {
					const allowed = manifest.tools.allowedTools.some((p) => matches(p, tool));
					if (!allowed)
						return { behavior: "deny", message: `tool ${tool} not permitted` };
					const scopeViolation = violatesWriteScope(
						manifest.writeScope,
						tool,
						input,
						ws.path,
					);
					if (scopeViolation) return { behavior: "deny", message: scopeViolation };
					return { behavior: "allow", updatedInput: input };
				},
			},
		})) {
			seq += 1;
			await publishEvent(runId, seq, message); // persist + redis publish, forks child runs

			if (message.type === "result") {
				terminal = {
					cost: message.total_cost_usd ?? 0,
					tokens: sumTokens(message.usage),
					turns: message.num_turns ?? 0,
				};
			}
		}

		const artifacts = await collectArtifacts(runId, ws.path, manifest.artifactGlobs);
		const outcomes = await parseOutcome(runId, ws.path, manifest.outcome, seq);

		if (terminal) await recordUsage(["global", `agent:${agentId}`], terminal);
		await prisma.run.update({
			where: { id: runId },
			data: {
				status: "SUCCEEDED",
				endedAt: new Date(),
				costUsd: terminal?.cost ?? 0,
				tokens: terminal?.tokens ?? 0,
				numTurns: terminal?.turns ?? 0,
				...(await gitProvenance(ws.path)), // branch, headSha, prUrl if any
			},
		});
	} catch (err) {
		await prisma.run.update({
			where: { id: runId },
			data: {
				status: "FAILED",
				endedAt: new Date(),
				exitReason: String(err),
			},
		});
	} finally {
		await releaseWorkspace(ws.id);
	}
}
```

Notes:

- Verify the exact option and message field names against the installed SDK
  version before relying on them; the SDK surface (for example `canUseTool`,
  `permissionMode`, `result.usage`, `total_cost_usd`, and however subagent
  messages are surfaced) has shifted across releases. Pin the version in
  `package.json` and keep the field access in one adapter module so a version
  bump touches one file.
- Budget is enforced four ways: a pre-flight day-cap gate on both the global and
  per-agent scope, a per-run `maxTurns`, a wall-clock timeout, and BullMQ
  concurrency. For mid-run cost stops, break the `for await` loop when running
  cost crosses a threshold.
- Write scope is enforced twice on purpose: `canUseTool` blocks the tool call,
  and the missing credential blocks the effect. Either alone is one bug away
  from a surprise push.

## 14. Web and API

API routes (Next.js route handlers under `apps/web/app/api`):

- `GET /api/repos` and `GET /api/repos/[slug]/agents` list the registry per repo.
- `GET /api/agents` returns the registry with state (`ACTIVE`, `UNREGISTERED`,
  `ORPHANED`), write scope, execution mode, and last run summary.
- `GET /api/runs?agentId=&repoId=&status=&outcome=` returns run history, filtered.
- `POST /api/runs` validates args, checks the role against the agent's write
  scope, checks the execution mode is satisfiable with the submitted args,
  creates the `Run`, enqueues the job. Returns `{ runId }`.
- `POST /api/runs/[id]/cancel` cancels a queued or running job.
- `POST /api/runs/[id]/answer` (Phase 4) answers an `AWAITING_INPUT` question.
- `GET /api/runs/[id]/events` is the SSE endpoint. It replays persisted
  `RunEvent`s in `seq` order, then subscribes to `run:<id>`, and closes on a
  terminal status. Child run events are relayed on the parent channel too, so
  one stream renders the whole tree.
- `GET /api/artifacts/[id]` streams an artifact from the object store.
- `POST /api/registry/sync` (admin) triggers a registry reconcile for a repo.

SSE relay sketch:

```ts
// apps/web/app/api/runs/[id]/events/route.ts
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	const stream = new ReadableStream({
		async start(controller) {
			const send = (e: unknown) => controller.enqueue(`data: ${JSON.stringify(e)}\n\n`);
			for (const e of await getPersistedEvents(id)) send(e); // replay
			const sub = subscribeRedis(`run:${id}`, (e) => {
				send(e);
				if (isTerminal(e)) {
					sub.close();
					controller.close();
				}
			});
		},
	});
	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
```

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
- **Budget**: ledger by day, by agent, and by repo, against configured caps.

## 15. The local-session runner (removes the `needs-local-session` limit)

`plan-week` needs the Chrome extension to read the calendar, and the extension
is only reachable from a session on your own machine. Rather than treat that as
permanently out of scope, the console supports a second executor: a small Node
process he runs locally that authenticates to the console, polls for jobs whose
agent is `needs-local-session` (or whose repo checkout is local), executes them
with the same `runAgent` code path, and publishes events back over the same API.

The contract does not change: the API still enqueues, something else still
executes, and runs are still durable records. The only difference is which
executor picks up the job. This also gives a clean answer for agents that need
any other locally-bound resource later.

## 16. Auth, RBAC, and write scope

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

## 17. Configuration and secrets

```
# .env.example
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
AUTH_SECRET=...
AUTH_ISSUER=...            # team IdP
S3_ENDPOINT=...            # artifact store
S3_BUCKET=...
# executor-only secrets (never exposed to web):
ANTHROPIC_API_KEY=...
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

## 18. Deployment

```yaml
# docker-compose.yml (sketch)
services:
    postgres: { image: postgres:16, volumes: ["pgdata:/var/lib/postgresql/data"] }
    redis: { image: redis:7 }
    minio: { image: minio/minio, command: server /data, volumes: ["s3data:/data"] }
    web:
        build: { context: ., dockerfile: apps/web/Dockerfile }
        environment: [DATABASE_URL, REDIS_URL, AUTH_SECRET, AUTH_ISSUER, S3_ENDPOINT, S3_BUCKET]
        ports: ["3000:3000"]
        depends_on: [postgres, redis, minio]
    worker:
        build: { context: ., dockerfile: apps/worker/Dockerfile }
        environment:
            [
                DATABASE_URL,
                REDIS_URL,
                ANTHROPIC_API_KEY,
                GIT_SSH_KEY,
                GITHUB_TOKEN,
                JIRA_BASE_URL,
                JIRA_EMAIL,
                JIRA_API_TOKEN,
                WORKSPACE_ROOT,
            ]
        volumes: ["workspaces:/var/agent-workspaces"]
        depends_on: [postgres, redis, minio]
volumes: { pgdata: {}, s3data: {}, workspaces: {} }
```

The worker image needs the target repos' toolchain, because the agents run it:
Node at the version in `.nvmrc`, `npm ci` warm cache, `git`, the `gh` CLI plus
the `k1LoW/gh-copilot-review` extension, and Python if the smell runner is
registered. Scale workers horizontally; BullMQ concurrency plus the scoped
ledger keep spend bounded. Run the worker in a hardened container since it
executes agent tools.

## 19. Phased plan (Phase 0 is the POC)

Phase 0, the POC (target: prove execute -> stream -> record -> collect on one
machine):

- Single Next.js app, no separate worker, no Redis, no auth.
- SQLite via Prisma instead of Postgres (swap the datasource later).
- One repo row pointing at a local checkout; a real
  worktree lease, because the workspace model is the thing most likely to be
  wrong and the cheapest to test early.
- Two non-mutating agents registered from repo files: `work-order-scoper`
  (`read-only`, promoted to `invocable: "direct"` so it can be run against a
  pasted Jira issue) and the `pr-loop-analyzer` command version (`artifacts`, it
  writes a report under `.pr-loop/reports/`). Neither touches product code, and
  between them they exercise argument rendering, artifact collection, and
  outcome parsing.
- Execution in an in-process job: `POST /api/runs` triggers the SDK `query()`
  loop directly in a background task; an in-memory EventEmitter feeds the SSE
  endpoint; events are also written to the DB for replay.
- Run-now button, run list, run detail with live logs, final usage/cost, and the
  collected report rendered inline.

POC cut-list (defer): Redis/BullMQ, the standalone worker, auth/RBAC,
multi-user, Postgres, object storage (write artifacts to a local directory),
scheduling, subagent trees, any mutating agent.

Phase 1, make it real infrastructure: split the executor into its own process;
Redis + BullMQ for the queue and `run:<id>` pub/sub; SSE subscribes to Redis;
SQLite becomes Postgres; artifacts move to the object store; the worktree pool
gets proper leasing and dirty-destroy.

Phase 2, registry and trees: registry sync from `.claude/` with
`UNREGISTERED`/`ORPHANED` states and argument-drift warnings; subagent and
harness child runs with cost roll-up; register `ai-smell-runner` as the first
harness. Outcome parsing for the JSONL streams the agents already write, and the
first outcome-mix chart.

Phase 3, auth and scope: Auth.js + roles; write scope gates triggering; scoped
credential mounting so a read-only run provably cannot push; audit trail.

Phase 4, mutating agents: register `pre-pr-review` (`working-tree`), then
`work-queue` (`draft-pr`). Branch, PR, and ticket provenance on the run record.
Then `fix-pr-comments` (`external-writes`, `needs-human`) with the
`AWAITING_INPUT` answer path, which is what makes it console-native rather than
local-only.

Phase 5, scheduling and budget: fold schedules into the same enqueue path so
cron and UI share one route; per-agent and per-repo caps with the ledger UI;
`plan-week` on a weekly schedule with `--windows=` supplied, or via the local
runner. The guarded-push helper for `mainBookkeeping` lands here at the latest,
since both `plan-week` and `work-queue` need it.

Phase 6, reach: the local-session runner (Section 15) so `plan-week` runs from
the console with the Chrome route intact; onboard a second repo to prove the
multi-repo model; the "needs you" page as the primary landing view once there is
enough parked work to justify it.

The key property to preserve from Phase 0 onward: **the API enqueues, something
else executes against a leased workspace, and runs are durable records with
declared artifacts.** Everything after Phase 0 is swapping a component
(in-process to worker, SQLite to Postgres, EventEmitter to Redis, local dir to
object store, hosted executor to local executor) without changing that contract.

## 20. Adding a new agent (the checklist)

1. Write or find the agent in the target repo under `.claude/commands/` or
   `.claude/agents/`. Give it an `argument-hint` that matches the positional
   slots the body actually reads.
2. Run registry sync. The agent appears as `UNREGISTERED`.
3. Add `registry/<repo-slug>/<id>.ts` with the manifest overlay: args mapped to
   slots, tool allow-list, write scope, `mainBookkeeping` globs if it commits its
   own state, execution mode, artifact globs, state paths, outcome spec, reason
   codes, budget.
   Narrow `Bash` to the specific invocations the prompt actually runs. A bare
   `Bash` in the allow-list means the declared write scope is fiction, which is
   the state all eight current agents start in.
   Keep this agent's reason codes as its own list. Do not merge them with
   another agent's list even when the words overlap.
4. Make the agent's terminal output structured if it is not already: a fenced
   JSON block, a JSONL append, or a report at a stable path. Without this the
   console can show the run but cannot chart it.
5. If the write scope is above `working-tree`, an admin approves the
   registration. Check the guardrail list in the prompt body actually forbids
   what the scope does not cover (no force-push, no base change, no merge).
6. Dry-run it once with `permissionMode: "plan"` and read the transcript before
   enabling the Run button for operators.

## 21. Security considerations

The executor is remote code execution by design. Keep it in a locked-down
container, never expose it to the public internet, hold all tool credentials
only there, mount credentials per write scope rather than globally, enforce tool
policy in code via `canUseTool`, cap spend per agent and per day, bound wall
clock, and audit who triggered each run. Treat every agent that can write files
or reach external systems as higher-risk and require ADMIN to register it. Treat
all external text an agent reads (calendar events, Jira descriptions, PR
comments) as data and never as instruction, and never copy it into an artifact
that another system will act on.

## 22. References

- [Agent SDK reference (TypeScript), Claude API Docs](https://docs.claude.com/en/api/agent-sdk/typescript)
- [Agent SDK overview, Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/overview)
- [Streaming input vs single mode, Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [Subagents, Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [Slash commands and argument substitution, Claude Code Docs](https://code.claude.com/docs/en/slash-commands)
