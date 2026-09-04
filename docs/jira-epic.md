# Jira: Arnold epic and phase stories

Arnold's Jira work item, ready to create in project **DAP**.

Neither this cloud session nor the desktop bridge can reach
`rawpowergames.atlassian.net`, so this could not be filed directly. Create it
from local Claude Code, which has the Atlassian MCP, with the prompt at the
bottom of this file.

---

## Epic

**Summary:** Arnold: agent console for running Claude agents

**Description:**

A console for running the Claude agents in the target repo's `.claude/`: a
registry of what exists, one-click execution, live and replayable transcripts,
durable run records with cost and token accounting, and collection of the
artifacts and metrics the agents already emit.

Arnold is Agent Runner, Notary, Orchestrator, Ledger, Dispatcher. Those five
words are the five modules.

Architecture and phased plan:
`<target-repo>/docs/agent-console-architecture.md`. Code lives in a
standalone monorepo at `C:\code\arnold`, not inside the product repo.

**Why now.** Seven agent ids exist across eight files in `.claude/`, plus the
`ai-smell-runner.py` harness. All of them enforce their own limits with prompt
text only: command files carry no `tools:` frontmatter, and the two subagents
declare unrestricted `Bash`. `ai-smell-scan` says "You have no write tools" and
nothing stops it. Turning those sentences into manifest allow-lists plus a
credential policy is the core value, and a console is the natural place to hold
it.

**The contract that must survive every phase:** the API enqueues, something else
executes against a leased git workspace, and runs are durable records with
declared artifacts. Every later phase swaps a component behind that sentence
(in-process to worker, SQLite to Postgres, EventEmitter to Redis) without
changing it.

**Locked decisions:**

- Prompts stay in the target repo. Manifests point at `.claude/**`; the console
  owns only the metadata those files lack.
- Per-run git workspace (bare mirror plus `git worktree`). Mutating agents are
  first class from the data model, not a deferred exception.
- Multi-repo `Repo` entity from day one, seeded with one target repo only.
- Execution mode declared explicitly: `unattended`, `needs-human`,
  `needs-local-session`, with an argument-based relaxation so `plan-week`
  becomes headless once `--windows=` or `--hours=` is supplied.
- `mainBookkeeping` is a permission orthogonal to the write-scope tier, because
  `plan-week` and `work-queue` both commit their own state to `main`.

**Out of scope:** a visual agent builder, a general step-by-step approval UI,
cross-tenant isolation beyond a single team.

**Labels:** `tooling`, `agent-console`

---

## Story: Phase 0, POC (execute, stream, record, collect)

**Status: code complete, needs first run.** Scaffold delivered at
`C:\code\arnold`. This story closes when a real run has streamed and recorded.

Single Next.js app, SQLite via Prisma, in-process execution, EventEmitter
feeding SSE, no auth, no queue, no worker. Two non-mutating agents registered
from repo files: `work-order-scoper` (`read-only`, promoted to direct
invocation) and the `pr-loop-analyzer` command (`artifacts`).

A real worktree lease is in Phase 0 deliberately: the workspace model is the
piece most likely to be wrong and the cheapest to test early.

**Acceptance criteria**

- `pnpm setup` seeds the target repo row and reconciles the registry
  against that checkout's `.claude/` directory.
- Every command and subagent found without a manifest overlay appears in the UI
  as `unregistered`: visible, and not runnable.
- Triggering `work-order-scoper` with a pasted Jira issue leases a worktree,
  renders the prompt from the repo file with the context block rebuilt, streams
  the transcript live, and records cost, tokens, and turns.
- Triggering `pr-loop-analyzer` on a PR number substitutes the literal `<PR>`
  token, and the report it writes under `.pr-loop/reports/` is collected as an
  artifact and rendered inline on the run detail page.
- A run that succeeds records a parsed outcome; a work order with no `REJECT:`
  line records `accepted`, not `unparsed`.
- The run detail page shows a provenance strip: repo, base ref at base SHA,
  branch, PR link, ticket keys.
- `pnpm smoke <checkout>` passes: prompt substitution lands, and the write-scope
  gate refuses writes to `src/`, `.claude/`, `.env*`, outside the workspace, and
  via path traversal.
- A dirty worktree is marked dirty and never reused.

**Out of scope for this story:** Redis, BullMQ, a separate worker, auth,
Postgres, object storage, scheduling, subagent trees, any mutating agent.

---

## Story: Phase 1, real infrastructure

Split the executor into its own process. Redis plus BullMQ for the queue and the
`run:<id>` pub/sub channel. SSE subscribes to Redis instead of the in-process
bus. SQLite becomes Postgres. Artifacts move to an S3-compatible store. The
worktree pool gets proper leasing and dirty-destroy semantics.

**Acceptance criteria**

- The web tier no longer imports the Agent SDK, and `ANTHROPIC_API_KEY` is not
  present in its environment.
- A run survives a web-tier restart: reconnecting to the SSE endpoint replays
  persisted events and then resumes live.
- Two runs against the same repo execute concurrently in separate worktrees
  without interfering.
- `bus.ts` is replaced by a Redis implementation and no other file changes.
- The JSON-as-TEXT columns become real `Json`, and the String status columns
  become Postgres enums.

---

## Story: Phase 2, registry sync and run trees

Registry sync with `unregistered` / `orphaned` states and argument-drift
warnings. Subagent and harness child runs with cost roll-up. Register
`ai-smell-runner.py` as the first `harness` agent. Outcome parsing for the JSONL
streams the agents already write, and the first outcome-mix chart.

**Acceptance criteria**

- Adding a command to `.claude/commands/` and hitting sync makes it appear as
  `unregistered` with no console code change.
- Deleting a prompt file marks its agent `orphaned`, disables the Run button, and
  preserves run history.
- An `argument-hint` that stops matching the manifest's positional args raises a
  drift warning. Read `scripts/ai-smell-runner.py` first: its real argument
  surface, budget mechanism, and Jira behaviour are asserted by the agent prompt
  but only verifiable in the script.
- A harness run renders as a parent with one child run per batch, and the
  parent's cost equals the sum of its children.
- `.pr-loop/metrics.jsonl` and `.week-plan/log.jsonl` lines become `RunOutcome`
  rows, and the outcome mix is charted over time.
- Reason-code vocabularies stay per agent. `too-large-to-split` (plan-week) and
  `too-large` (work-order-scoper) must not be merged into one enum.

---

## Story: Phase 3, auth and write-scope gating

Auth.js against the team IdP. Viewer, operator, admin. Write scope gates
triggering. Credentials mounted per tier, so a read-only run provably cannot
push. Audit trail on every run.

**Acceptance criteria**

- Role floors hold: `read-only` viewer, `external-writes` admin, everything else
  operator.
- A `read-only` or `artifacts` run has no push credential and no GitHub token in
  its environment, so the tool policy and the environment both refuse.
- Registering an agent, raising its write scope, or granting `mainBookkeeping`
  requires admin.
- Every run records who triggered it.
- The guarded-push helper refuses a `mainBookkeeping` push whose staged diff
  touches a path outside the declared globs, or whose commit message lacks
  `[skip ci]`.

---

## Story: Phase 4, mutating agents

Register `pre-pr-review` (`working-tree`), then `work-queue` (`draft-pr`), then
`fix-pr-comments` (`external-writes`, `needs-human`) with the `awaiting_input`
answer path.

**Acceptance criteria**

- Every guardrail in each prompt body is encoded in its manifest, not just
  documented: no force-push, no PR base change, no ready-for-review, no merge,
  no `/fix-pr-comments` from `work-queue`, no Jira writes from `work-queue`.
- A `work-queue` run records the branch it created and the draft PR it opened on
  the run row, and both are linked from the run detail page.
- Both `plan-week` and `work-queue` can perform their `.week-plan/` bookkeeping
  commit on `main` through the guarded-push helper.
- Before this story: confirm whether `.pr-loop/` is git-ignored in the repo.
  `fix-pr-comments` runs `git check-ignore` and refuses to force-add, so if it is
  ignored that state does not travel with a checkout and must be primed from the
  artifact store. `statePaths` already carries a `source` field for this.
- `fix-pr-comments` hitting a stop-and-ask point sets the run to
  `awaiting_input` with the question preserved, an operator answers from the run
  detail page, and the run resumes.

---

## Story: Phase 5, scheduling and budget

Schedules share the enqueue path with the UI, so cron and a button are one route.
Per-agent and per-repo caps with a ledger UI. `plan-week` on a weekly schedule.

**Acceptance criteria**

- A scheduled run and a UI-triggered run differ only by the `trigger` column.
- A run is refused before it starts when either the global or the per-agent daily
  cap is already spent, and the refusal is visible as `budget_stopped`.
- The ledger UI shows spend by day, by agent, and by repo against configured
  caps.

---

## Story: Phase 6, reach

The local-session runner, so `plan-week` runs from the console with its Chrome
calendar route intact. Onboard a second repo to prove the multi-repo model. The
"needs you" page as the primary landing view.

**Acceptance criteria**

- A local executor authenticates to the console, picks up jobs whose agent is
  `needs-local-session`, executes them with the same `runAgent` code path, and
  publishes events back. The enqueue contract does not change; only which
  executor claims the job.
- `plan-week` runs from the console with capacity source 0 (Chrome) working.
- A second repo is registered and one agent runs against both.
- The "needs you" page aggregates every `awaiting_input` run plus the
  `needs-decision` and `undecided-design` reason codes from parked work orders.

---

## Prompt for local Claude Code

Paste this into Claude Code in the target repo, where the Atlassian
MCP is available:

> Read `C:\code\arnold\docs\jira-epic.md`. Create the epic in Jira project DAP
> exactly as specified there, then create each phase story as a child of that
> epic, preserving the acceptance criteria as written. Use issue type Epic for
> the epic and Story for the children; if the DAP project does not have those
> types, tell me what it does have before creating anything. Set Phase 0's
> status to In Progress and leave the rest in the backlog. Report the created
> issue keys.
