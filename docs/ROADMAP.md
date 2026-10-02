# Arnold: Roadmap

Eleven phases (0 to 10), **numbered in the order they are built**: Phase 1 is
built first, then Phase 2, and so on. **Phases 0 and 1 are built; Phase 2 is
next.** When priorities change the phases are renumbered, and the renumbering is
recorded in `docs/DECISIONS.md` (#27) so history stays traceable. Phases 9 and 10
are not scheduled.

Phases 5, 6 and 9 are each a component swap behind a contract that does not
change; the others add capability:

> **The API enqueues, something else executes against a leased workspace, and
> runs are durable records with declared artifacts.**

Phase 0 runs the executor in-process with SQLite and an EventEmitter. Every later
phase replaces a component behind that sentence, or adds a capability on top of
it, without rewriting the shape.

> **This roadmap is the single source of truth** for what Arnold is building and
> in what order. Work is named by phase and by feature (`2.1` is the first feature
> of Phase 2); the feature docs are in `docs/features/`, each with a user story and
> its GitHub issues. `docs/architecture.md` is the target architecture,
> `docs/DECISIONS.md` records why, and `docs/HANDOVER.md` holds the current build
> state, including what is verified and what is known broken. None of them sets
> the order.

---

## Phase 0: POC (execute, stream, record, collect)

**Status: verified.** Five runs in August 2026 on the pre-genericization tree,
three against ledtraad on 2026-09-12, and six against a throwaway sandbox repo on
2026-10-01, the last on the tree as merged. Read-only and `artifacts` tiers only;
see `docs/HANDOVER.md`.

Single Next.js app, SQLite via Prisma, in-process execution, EventEmitter feeding
SSE, no auth, no queue, no worker. Two non-mutating agents registered from repo
files: `work-order-scoper` (`read-only`, promoted to direct invocation) and the
`pr-loop-analyzer` command (`artifacts`).

A real worktree lease is in Phase 0 deliberately: the workspace model is the
piece most likely to be wrong and the cheapest to test early.

**Acceptance criteria**

- [x] `pnpm setup` seeds a target repo row and reconciles the registry against
      that checkout's `.claude/` directory.
- [x] Every command and subagent found without a manifest overlay appears in the
      UI as `unregistered`: visible, and not runnable.
- [ ] Triggering `work-order-scoper` leases a worktree, renders the prompt from
      the repo file with its context block rebuilt, streams the transcript live,
      and records cost, tokens and turns.
- [ ] Triggering `pr-loop-analyzer` on a PR number substitutes the literal `<PR>`
      token, and the report it writes is collected as an artifact and rendered
      inline on the run detail page.
- [ ] A run that succeeds records a parsed outcome; a work order with no
      `REJECT:` line records `accepted`, not `unparsed`.
- [ ] The run detail page shows a provenance strip: repo, base ref at base SHA,
      branch, PR link, ticket keys.
- [x] `pnpm smoke <checkout>` passes: prompt substitution lands, and the
      write-scope gate refuses writes to source, `.claude/`, `.env*`, outside the
      workspace, and via path traversal.
- [ ] A dirty worktree is marked dirty and never reused.

**Out of scope:** Redis, BullMQ, a separate worker, auth, Postgres, object
storage, scheduling, subagent trees, any mutating agent.

**Features**

- [0.1 One verified run on the current tree](features/0.1-verified-run-on-current-tree.md): Done (#10)
- [0.2 Trace runs in MLflow](features/0.2-mlflow-tracing.md): Done (#11)
- [0.3 Keep HANDOVER, README and ROADMAP current](features/0.3-docs-current.md): Done (#13)

---

---

## Phase 1: Useful on ledtraad

**Status: built; one live check outstanding** (a real File issue click on
ledtraad). Built 2026-10-01 and 2026-10-02.

The first phase after the proof of concept makes Arnold useful to its author on a
real repo before anything else is built (DECISIONS #26). An agent's findings
used to die in the transcript: `doc-drift` reported four stale claims and
recorded `"findings": 4`, a **count**, so nothing downstream could address finding
#3 and every later run re-reported the same four. This phase turns findings into
durable rows that can be filed as issues, and gives an accepted work order a path
to code, using only what exists: the scoper, `gh`, and a Claude Code skill. No new
infrastructure.

**Features**

- [1.4 Approved work orders reach code](features/1.4-approved-work-orders-reach-code.md): Done (#31, #40)
- [1.1 doc-drift emits structured findings](features/1.1-structured-findings.md): Done (#32)
- [1.2 Finding rows with a fingerprint](features/1.2-finding-rows.md): Done (#33)
- [1.3 Findings view: file a reviewed finding as an issue](features/1.3-findings-view.md): Done (#34)

**Acceptance criteria**

- [x] `doc-drift` emits each finding as a structured entry (file, line, claim,
      measured value, command, verdict, note), and the prose report stays.
- [x] A finding is a durable row, not a count: `Finding` carries repo, source run,
      fingerprint, title, file, verdict and state.
- [x] **The fingerprint is not `file:line`.** Lines move; that is what drift _is_.
      Known findings are not re-reported as new: each run is handed the open
      findings and re-checks each by id.
- [x] A finding is closed by re-measurement. Only a `fixed` re-check closes one; a
      finding a run does not mention stays open, because the agent is not
      deterministic. A findings count that only ever rises is a lying count.
- [x] `/findings` lists open, filed and closed findings per repo. Filing creates an
      issue on the repo's own GitHub tracker; it writes to the tracker, never the
      repo, and only on the operator's click.
- [x] `work-order-scoper` is bound to ledtraad with GitHub issues as tickets, and
      an accepted order reaches code through a temporary bridge skill after the
      operator approves it.
- [ ] A real File issue click has been made on ledtraad.

---

## Phase 2: Sandbox and a hardened gate

**Status: next.** The gate is mostly hardened; the sandbox is not started.

One container profile per write scope, so a read-only run provably cannot read
secrets, write or push, whatever the agent tries. The tool gate in
`writeScope.ts` stays as a second layer. In solo mode the sandbox, not auth,
releases the held `working-tree` and `draft-pr` tiers (DECISIONS #26), because
the risk the hold guards against is what an agent can do, not who pressed the
button.

**Features**

- [2.1 One container sandbox per write scope](features/2.1-sandbox-per-write-scope.md): Planned (#21, #35)
- [2.2 The gate refuses what it should, and nothing else](features/2.2-gate-hardening.md): In progress (#12, #14, #37, #27, #15)

**Acceptance criteria**

- A `read-only` or `artifacts` run has no push credential and no forge token in
  its environment, so the tool policy and the environment both refuse.
- `read-only`: worktree mounted read-only, no network except the gateway, no
  credentials. `artifacts`: one writable output directory. `working-tree`:
  writable worktree, no credentials. `branch-push` and up: a forge token scoped
  to one repo.
- Reads are confined to the worktree, including Bash operands of allow-listed
  programs.
- A solo-mode setting: in it, a held tier is runnable once its sandbox profile
  exists. Outside solo mode the hold still needs auth (Phase 8).
- [x] No allow-listed command can run arbitrary code, and the gate runs ahead of
      the CLI's own auto-approval.
- [x] Separators inside quotes do not split a command; the safe-filter exemption
      applies only after a pipe.
- [x] `Read`, `Grep` and `Glob` stay inside the worktree and never open `.env`
      secrets.
- [ ] User-level skills from the operator's `~/.claude` do not load into runs.

---

## Phase 3: Mutating agents

Register `pre-pr-review` (`working-tree`), then `work-queue` (`draft-pr`), then
`fix-pr-comments` (`external-writes`, `needs-human`) with the `awaiting_input`
answer path.

**Note:** all five remaining reference manifests were registered early, during
Phase 0, at the maintainer's request. So the manifests exist but the gating they
assume does not. Treat this phase as "make the guarantees real", not "write the
manifests".

**Revised 2026-10-01.** This phase is built after the Phase 2 sandbox, and its
first target is ledtraad. In solo mode the sandbox releases the hold on
`working-tree` and `draft-pr`; auth (Phase 8) is not a precondition until someone
other than the author uses the console (DECISIONS #26).

**Features**

- [3.1 Mutating agents on ledtraad](features/3.1-mutating-agents-on-ledtraad.md): Planned (#36, #26, #53)

**Acceptance criteria**

- Every guardrail in each prompt body is encoded in its manifest, not just
  documented: no force-push, no PR base change, no ready-for-review, no merge.
- A `work-queue` run records the branch it created and the draft PR it opened on
  the run row, and both are linked from the run detail page.
- Agents needing a bookkeeping commit on the default branch can perform it
  through the guarded-push helper.
- Before this phase: confirm whether the target repo's agent state directories
  are git-ignored. If they are, that state does not travel with a checkout and
  must be primed from the artifact store. `statePaths` already carries a `source`
  field for this.
- An agent hitting a stop-and-ask point sets the run to `awaiting_input` with the
  question preserved, an operator answers from the run detail page, and the run
  resumes.
- `work-queue` and `plan-week` run against a repo with **no Jira account**. The
  tracker is a binding (DECISIONS #20), so this is now a one-line change in
  `registry/<slug>/`; what the criterion tests is that the free path works
  end to end — a `githubTracker` repo where `gh issue edit` sets the state label
  and `notary` records `#<n>` as the ticket key, and a `noTracker` repo where the
  queue is the only board and the report omits the tracker section.
- The issue-_creating_ path is bound too. `fix-pr-comments`,
  `pr-loop-analyzer-subagent` and `ai-smell-scan` still read
  `{{trackerProjectKey}}` and `{{trackerParentIssue}}` directly; filing an issue
  is a third mechanic alongside reading a backlog and moving a ticket, and it
  needs a `trackerFile` block before any of those three can run on a repo without
  Jira.

---

---

## Phase 4: Vendor-agnostic harnesses

Arnold owns the record and rents the loop (`docs/architecture.md` Section 0): it
runs existing coding-agent harnesses (Claude Code, Codex, and later Gemini CLI
and OpenCode) behind one adapter, instead of rebuilding tool calling, file
editing and context management on a model API. A gateway in front of them holds
cost, caps and provider keys. This phase settles whether vendor-agnosticism is
real before anything is spent on team features.

**Features**

- [4.4 Spend is recorded accurately](features/4.4-spend-recorded-accurately.md): In progress (#38, #20)
- [4.1 Harness spike: doc-drift through Claude Code and Codex](features/4.1-harness-spike.md): Planned (#17)
- [4.2 LLM gateway in front of both harnesses](features/4.2-llm-gateway.md): Planned (#19)
- [4.3 Score runs against the planted-drift sandbox](features/4.3-score-runs.md): Planned (#18)

**Acceptance criteria**

- `doc-drift` runs headless through Claude Code and through Codex, each via ACP
  or its CLI JSON stream, and both event streams normalise into one `RunEvent`
  shape that the console renders. A DECISIONS entry records which transport and
  why.
- A `Harness` interface (`start(spec, sandbox)` yielding normalised events,
  `cancel()`, `capabilities`) with `claude-code` as one implementation; the raw
  vendor payload is kept beside each normalised event.
- The worker holds no provider API key: a gateway holds the keys, and a run holds
  a virtual key capped to its budget. The ledger reads spend from the gateway.
- Each harness adapter states what it loads from the host, so two operators get
  the same agent.
- A run can be scored against the sandbox's planted drifts, so a prompt change or
  a second harness is compared by number.

- A run that fails or hits its turn limit still records its cost, and MLflow shows
  the ledger's cost and tokens rather than undercounting them.

**Depends on** Phase 2 (the sandbox profile is what the harness runs inside).

---

---

## Phase 5: Real infrastructure

Split the executor into its own process. Postgres holds the queue and
`LISTEN/NOTIFY` carries the `run:<id>` channel (Redis and BullMQ, which this
phase first named, are dropped: DECISIONS #21 to #26). SSE subscribes to
Postgres instead of the in-process bus. SQLite becomes Postgres. Artifacts move to an S3-compatible store. The
worktree pool gets proper leasing and dirty-destroy semantics.

**Features**

- [5.1 Postgres and a queue, with a separate worker](features/5.1-postgres-and-queue.md): Planned (#22)

**Acceptance criteria**

- The web tier no longer imports the Agent SDK, and `ANTHROPIC_API_KEY` is not
  present in its environment.
- A run survives a web-tier restart: reconnecting to the SSE endpoint replays
  persisted events and then resumes live.
- Two runs against the same repo execute concurrently in separate worktrees
  without interfering.
- `bus.ts` is replaced by a Postgres `LISTEN/NOTIFY` implementation and no other
  file changes.
- The JSON-as-TEXT columns become real `Json`, and the String status columns
  become Postgres enums.

---

---

## Phase 6: Registry and run trees

Registry sync with `unregistered` / `orphaned` states and argument-drift
warnings. Target repositories managed from the console rather than the
environment. Subagent and harness child runs with cost roll-up. Register the
first `harness` agent. Outcome parsing for JSONL streams, and the first
outcome-mix chart.

**Note:** repo management and the repo switcher were built early, during Phase 0,
at the maintainer's request. The screens and the API exist and are listed as done
below. What is _not_ done is the part that belongs to Phase 8: registering a repo
is an unauthenticated action, so anyone reaching the port can point Arnold at any
path on the host. Treat the remaining work as gating, not building.

**Features**

- [6.1 The registry lives in its own repository](features/6.1-registry-in-own-repository.md): Planned (#23, #16)

**Acceptance criteria**

- Adding a command to a target repo's `.claude/commands/` and hitting sync makes
  it appear as `unregistered` with no console code change.
- [x] A repo is registered, edited and retired from the console, with no edit to
      `.env.local` and no re-run of `pnpm seed`. No repo is seeded at all:
      `/repos` works on an empty database, and saving a repo syncs its agents.
- [x] A candidate checkout is probed before it is accepted: a path that does not
      exist or is not a git checkout is refused at registration time, with the
      reason, rather than failing inside a workspace lease minutes into a run.
- [x] A repo that any run references cannot be deleted, only archived. Archiving
      keeps every run, artifact and outcome and removes the repo from the
      switcher. See DECISIONS #16.
- [x] The console is scoped to one repo, or to all of them, from a switcher in
      the nav, and the choice survives navigating between Agents and Runs.
- [ ] A repo registered in the console with no `registry/<slug>/` directory
      reports why it has no agents, rather than rendering as an empty group.
- Deleting a prompt file marks its agent `orphaned`, disables the Run button, and
  preserves run history.
- An `argument-hint` that stops matching the manifest's positional args raises a
  drift warning.
- A harness run renders as a parent with one child run per batch, and the
  parent's cost equals the sum of its children.
- Metrics JSONL lines become `RunOutcome` rows, and the outcome mix is charted
  over time.
- Reason-code vocabularies stay per agent. Two agents using different words for
  the same idea must not be merged into one enum.

---

---

## Phase 7: The rest of the findings chain

Phase 1 turned findings into rows and filed them as issues. This phase builds the
rest of the chain from there.

The chain this phase builds: **finding → triage → scoper → order → queue →
executor.** Note the order. The work order is the _validator's output_, not its
input: `work-order-scoper` already exists and its stated value is "first, try to
reject", against the code, before anything is written. A finding is already
ticket-shaped, which is all it needs.

`ai-smell-scan` is the precedent, not a new design. Its Step 6 already specifies
structured findings, an `agentFixable` judgement "the runner cannot make, because
it has not read the code", severity gating, and dedup on smell ID plus file path —
and explicitly says the agent must not file tickets, a runner does. That runner
does not exist in Arnold: `ai-smell-scan` is registered `invocable: "child"` with
no parent, and there are no `kind: "harness"` manifests at all. The finding-
consumer role is vacant and its contract is already written.

**Features**

- [7.1 The rest of the chain: triage, scoper, order, queue, executor](features/7.1-findings-chain.md): Planned (#24)

**Acceptance criteria**

- Triage is deterministic — no model. `doc-drift`'s existing `verdict` field is
  `agentFixable` under another name: only `document-stale` is auto-promotable,
  `repo-changed` means the code is wrong and is a human's ticket, `unclear` is
  never promoted.
- Findings are batched by document or class, not one order per finding. Four
  findings in one README is one branch, one PR — which is also the scoper's own
  rule about fixing a class at one site.
- A doc-drift-derived order verifies **without a test suite**: every finding
  carries the command that measured it, so the acceptance criterion is "re-run
  this command; the document now states the measured value". This is the reason
  structuring findings pays for itself, and it is what makes documentation work
  safe for an unattended executor at all.
- The first consumer is honest about its limits. `doc-drift` runs on ledtraad,
  and `registry/ledtraad/index.ts` states that nothing in it may write to the
  repo. Since 2026-09-28 ledtraad has a GitHub Project board, PRs and a `finding`
  label, so the chain's first leg ends there: a reviewed finding is filed as a
  ledtraad issue by the operator, from the console. Filing writes to the
  tracker, not the repo, and only on a click. The executor leg waits for the
  Phase 2 sandbox and Phase 3. ledtraad is not granted `draft-pr` to make a demo
  complete.

---

## Phase 8: Auth

**Status: not started; built once someone other than the author uses the
console.** Until then the console stays on localhost.

Auth.js against any OIDC provider (optional in solo mode). Viewer, operator,
admin. Write scope gates triggering. Audit trail on every run.

**Features**

- [8.1 Auth, once someone other than the author uses it](features/8.1-auth.md): Planned (#25)

**Acceptance criteria**

- Role floors hold: `read-only` viewer, `external-writes` admin, everything else
  operator.
- Registering an agent, raising its write scope, or granting `mainBookkeeping`
  requires admin.
- Registering, editing or removing a **repo** requires admin. This is the widest
  unauthenticated capability Phase 0 has: a repo row names a filesystem path that
  Arnold will clone and run agents against, so until this lands the console must
  not be exposed beyond localhost.
- Every run records who triggered it.

---

## Phase 9: Scheduling and budget

**Status: not scheduled.**

Schedules share the enqueue path with the UI, so cron and a button are one route.
Per-agent and per-repo caps with a ledger UI.

**Acceptance criteria**

- A scheduled run and a UI-triggered run differ only by the `trigger` column.
- A run is refused before it starts when either the global or the per-agent daily
  cap is already spent, and the refusal is visible as `budget_stopped`.
- The ledger UI shows spend by day, by agent, and by repo against configured
  caps.

---

---

## Phase 10: Reach

**Status: not scheduled.**

The local-session runner, so agents needing a browser or another locally-bound
resource can run from the console. A second repo onboarded to prove the
multi-repo model. The "needs you" page as the primary landing view.

**Acceptance criteria**

- A local executor authenticates to the console, picks up jobs whose agent is
  `needs-local-session`, executes them with the same `runAgent` code path, and
  publishes events back. The enqueue contract does not change; only which
  executor claims the job.
- A second repo is registered and one agent runs against both. Registration
  itself is no longer the obstacle — that shipped in Phase 6 — so what this
  criterion now tests is the manifest half: one agent whose `repos` covers both
  slugs, running successfully against each.
- The "needs you" page aggregates every `awaiting_input` run plus the
  decision-required reason codes from parked work.

---

---

## Deliberately not planned

- A visual agent builder. Prompts live in the target repo; that is the point.
- A general step-by-step approval UI. `awaiting_input` covers the cases that
  actually occur.
- Cross-tenant isolation. Single-operator tool.
