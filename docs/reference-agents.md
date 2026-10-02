# Reference agents

> A worked-example catalog, not architecture. The registry bundled in
> `registry/example-repo/` describes eight agents found in one project's
> `.claude/` directory. They are kept because between them they cover every agent
> kind and every write scope the model supports. What an agent is, and the
> contract it must meet, is in `docs/architecture.md`; how to add one is in
> `docs/adding-an-agent.md`.

The registry seed has seven distinct agent ids (`pr-loop-analyzer` exists as both
a command and a subagent, and the two copies differ in behaviour), plus one
harness living outside `.claude/` as a script. The table is the seed; the
per-agent notes capture what a manifest must encode.

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
and otherwise routes the run to the local runner bridge (`docs/architecture.md`, local-session runner). It needs
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
