# Arnold: Roadmap

Nine phases (0 to 8). Phases 1 to 6 are each a component swap behind a contract
that does not change; Phases 7 and 8 add capabilities rather than replacing an
implementation:

> **The API enqueues, something else executes against a leased workspace, and
> runs are durable records with declared artifacts.**

Phase 0 runs the executor in-process with SQLite and an EventEmitter. Every later
phase replaces a component behind that sentence without rewriting the shape.

Design detail lives in `docs/architecture.md`. Current build state, including
what is verified and what is known broken, lives in `docs/HANDOVER.md`.

> **This roadmap is the single source of truth** for what Arnold is building and
> in what order. Work is named by phase and by feature (`7.2` is the second
> feature of Phase 7); the feature docs are in `docs/features/`, each with a user
> story and its GitHub issues. Other documents (`docs/architecture.md`
> Section 0, `docs/DECISIONS.md`) give the reasons; they do not set the order.
>
> `docs/architecture.md` Section 0 (2026-09-28) re-scoped Arnold as a
> vendor-agnostic team tool. Where a phase below still names Redis, BullMQ or the
> Agent SDK as the execution layer, Section 0 wins and the phase says so.

## Build order

What is built next, by feature. Phases are numbered by what they are, not by when
they are built; this list is the sequence.

1. **Useful on ledtraad, Phase 7:** 7.1, 7.2 and 7.3 (done), plus 4.2 (done).
2. **Phase 3, sandbox:** 3.1 one container per write scope; 3.2 finishes the gate.
3. **Phase 4, mutating agents:** 4.1 on ledtraad.
4. **Phase 8, vendor-agnostic harnesses:** 8.1 harness spike, then 8.2 gateway,
   with 8.3 scoring alongside.
5. **Phase 1:** 1.1 Postgres and a queue.
6. **Phase 2:** 2.1 registry repository.
7. **Phase 7:** 7.4 the rest of the findings chain.
8. **Phase 3:** 3.3 auth, once someone other than the author uses the console.

Phases 5 and 6 are not scheduled; 5.1 (accurate spend) is picked up with 8.2.

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

## Phase 1: Real infrastructure

Split the executor into its own process. Postgres holds the queue and
`LISTEN/NOTIFY` carries the `run:<id>` channel (Redis and BullMQ, which this
phase first named, are dropped: DECISIONS #21 to #26). SSE subscribes to
Postgres instead of the in-process bus. SQLite becomes Postgres. Artifacts move to an S3-compatible store. The
worktree pool gets proper leasing and dirty-destroy semantics.

**Features**

- [1.1 Postgres and a queue, with a separate worker](features/1.1-postgres-and-queue.md): Planned (#22)

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

## Phase 2: Registry sync, repo management, and run trees

Registry sync with `unregistered` / `orphaned` states and argument-drift
warnings. Target repositories managed from the console rather than the
environment. Subagent and harness child runs with cost roll-up. Register the
first `harness` agent. Outcome parsing for JSONL streams, and the first
outcome-mix chart.

**Note:** repo management and the repo switcher were built early, during Phase 0,
at the maintainer's request. The screens and the API exist and are listed as done
below. What is _not_ done is the part that belongs to Phase 3: registering a repo
is an unauthenticated action, so anyone reaching the port can point Arnold at any
path on the host. Treat the remaining work as gating, not building.

**Features**

- [2.1 The registry lives in its own repository](features/2.1-registry-in-own-repository.md): Planned (#23, #16)

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

## Phase 3: Auth and write-scope gating

Auth.js against an identity provider. Viewer, operator, admin. Write scope gates
triggering. Credentials mounted per tier, so a read-only run provably cannot
push. Audit trail on every run.

**Features**

- [3.1 One container sandbox per write scope](features/3.1-sandbox-per-write-scope.md): Planned (#21, #35)
- [3.2 The gate refuses what it should, and nothing else](features/3.2-gate-hardening.md): In progress (#12, #14, #37, #27, #15)
- [3.3 Auth, once someone other than the author uses it](features/3.3-auth.md): Planned (#25)

**Acceptance criteria**

- Role floors hold: `read-only` viewer, `external-writes` admin, everything else
  operator.
- A `read-only` or `artifacts` run has no push credential and no forge token in
  its environment, so the tool policy and the environment both refuse.
- Registering an agent, raising its write scope, or granting `mainBookkeeping`
  requires admin.
- Registering, editing or removing a **repo** requires admin. This is the widest
  unauthenticated capability Phase 0 has: a repo row names a filesystem path that
  Arnold will clone and run agents against, so until this lands the console must
  not be exposed beyond localhost.
- Every run records who triggered it.
- The guarded-push helper refuses a `mainBookkeeping` push whose staged diff
  touches a path outside the declared globs, or whose commit message lacks
  `[skip ci]`.

---

## Phase 4: Mutating agents

Register `pre-pr-review` (`working-tree`), then `work-queue` (`draft-pr`), then
`fix-pr-comments` (`external-writes`, `needs-human`) with the `awaiting_input`
answer path.

**Note:** all five remaining reference manifests were registered early, during
Phase 0, at the maintainer's request. So the manifests exist but the gating they
assume does not. Treat this phase as "make the guarantees real", not "write the
manifests".

**Revised 2026-10-01.** This phase is built after the Phase 3 sandbox (feature
3.1), and its first target is ledtraad (feature 4.1). In solo mode the sandbox
releases the hold on `working-tree` and `draft-pr`; auth (feature 3.3) is not a
precondition until someone other than the author uses the console (DECISIONS #26).

**Features**

- [4.1 Mutating agents on ledtraad](features/4.1-mutating-agents-on-ledtraad.md): Planned (#36, #26)
- [4.2 Approved work orders reach code](features/4.2-approved-work-orders-reach-code.md): Done (#31, #40)

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

## Phase 5: Scheduling and budget

Schedules share the enqueue path with the UI, so cron and a button are one route.
Per-agent and per-repo caps with a ledger UI.

**Features**

- [5.1 Spend is recorded accurately](features/5.1-spend-recorded-accurately.md): In progress (#38, #20)

**Acceptance criteria**

- A scheduled run and a UI-triggered run differ only by the `trigger` column.
- A run is refused before it starts when either the global or the per-agent daily
  cap is already spent, and the refusal is visible as `budget_stopped`.
- The ledger UI shows spend by day, by agent, and by repo against configured
  caps.

---

## Phase 6: Reach

The local-session runner, so agents needing a browser or another locally-bound
resource can run from the console. A second repo onboarded to prove the
multi-repo model. The "needs you" page as the primary landing view.

**Features:** none defined yet.

**Acceptance criteria**

- A local executor authenticates to the console, picks up jobs whose agent is
  `needs-local-session`, executes them with the same `runAgent` code path, and
  publishes events back. The enqueue contract does not change; only which
  executor claims the job.
- A second repo is registered and one agent runs against both. Registration
  itself is no longer the obstacle — that shipped in Phase 2 — so what this
  criterion now tests is the manifest half: one agent whose `repos` covers both
  slugs, running successfully against each.
- The "needs you" page aggregates every `awaiting_input` run plus the
  decision-required reason codes from parked work.

---

## Phase 7: Findings become work

Today an agent's findings die in the transcript. `doc-drift` reports four stale
claims and records `"findings": 4` in its outcome block — a **count**. The four
findings themselves exist only as prose, so nothing downstream can address
finding #3, and running the agent again tomorrow (its budget allows four runs a
day) re-reports the same four with no way to tell them from new ones.

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

- [7.1 doc-drift emits structured findings](features/7.1-structured-findings.md): Done (#32)
- [7.2 Finding rows with a fingerprint](features/7.2-finding-rows.md): Done (#33)
- [7.3 Findings view: file a reviewed finding as an issue](features/7.3-findings-view.md): Done (#34)
- [7.4 The rest of the chain: triage, scoper, order, queue, executor](features/7.4-findings-chain.md): Planned (#24)

**Acceptance criteria**

- A finding is a durable row, not a count: `Finding` carries repo, source run,
  fingerprint, title, file, verdict and state. `Artifact.kind` already lists
  `findings` and `artifactKindFor` never emits it — that is the hook.
- **The fingerprint is not `file:line`.** Lines move; that is what drift _is_.
  Two consecutive `doc-drift` runs over an unchanged repo produce zero new
  findings. Without this the rest is worthless, so it is the first thing built.
- A finding is closed automatically, by re-measurement. Each run is handed the
  open findings and re-checks each; only a `fixed` re-check closes one. A finding
  that a run simply does not mention stays open, because the agent is not
  deterministic. A findings count that only ever rises is a lying count.
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
  sandbox and Phase 4. ledtraad is not granted `draft-pr` to make a demo
  complete.
- **Revised 2026-10-01:** the first three criteria above (durable rows, the
  fingerprint, auto-close) plus structured output from `doc-drift` and filing to
  GitHub are features 7.1, 7.2 and 7.3, built first and done. The rest of the
  chain is feature 7.4. Closing a finding is by re-measurement, not by omission
  (see 7.2).

---

## Phase 8: Vendor-agnostic harnesses

Arnold owns the record and rents the loop (`docs/architecture.md` Section 0): it
runs existing coding-agent harnesses (Claude Code, Codex, and later Gemini CLI
and OpenCode) behind one adapter, instead of rebuilding tool calling, file
editing and context management on a model API. A gateway in front of them holds
cost, caps and provider keys. This phase settles whether vendor-agnosticism is
real before anything is spent on team features.

**Features**

- [8.1 Harness spike: doc-drift through Claude Code and Codex](features/8.1-harness-spike.md): Planned (#17)
- [8.2 LLM gateway in front of both harnesses](features/8.2-llm-gateway.md): Planned (#19)
- [8.3 Score runs against the planted-drift sandbox](features/8.3-score-runs.md): Planned (#18)

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

**Depends on** feature 3.1 (the sandbox profile is what the harness runs inside).

---

## Deliberately not planned

- A visual agent builder. Prompts live in the target repo; that is the point.
- A general step-by-step approval UI. `awaiting_input` covers the cases that
  actually occur.
- Cross-tenant isolation. Single-operator tool.
