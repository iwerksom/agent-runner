# Arnold: Decisions

Why the code looks the way it does. Every entry is a choice that was made
deliberately, with the alternative that was rejected, because the next person to
read this code (including a future you) will otherwise reasonably assume it was
an accident.

Ordered roughly by how expensive it would be to get wrong.

---

## 1. Prompts stay in the target repo

A manifest points at `.claude/commands/<id>.md` or `.claude/agents/<id>.md` in a
checked-out repo. Arnold owns only the metadata those files do not carry: tool
policy, budget, write scope, execution mode, artifact globs.

**Rejected:** copying prompt bodies into Arnold. It would mean maintaining two
copies of every agent and reconciling them forever.

**Consequence:** editing a command in the target repo changes what the console
runs, immediately, with no deploy. That is the intended property. It also means
Arnold must reproduce the argument substitution the prompts expect (see 4).

## 2. Every agent's declared scope was a lie, and that is the whole point

Every agent in the reference registry started at
`scopeEnforcement: "prompt-only"`. Command files carry no `tools:` frontmatter at
all. The two subagents declare `tools: Read, Grep, Glob, Bash` with completely
unrestricted `Bash`. One agent's prompt says "You have no write tools" and
nothing whatsoever enforced that.

Turning those sentences into manifest allow-lists plus a credential policy is
Arnold's core value. Not the UI, not the run history: the enforcement.

`scopeEnforcement` is therefore a **to-do list, not a description**. It is shown
in the UI as a warning state at `prompt-only`, and a bare `Bash` in an
allow-list means the declared write scope is still fiction.

## 3. Write scope is enforced twice, and `mainBookkeeping` is orthogonal

Two independent mechanisms: `canUseTool` refuses the tool call, and the executor
does not mount the credential. Either alone is one bug away from a surprise push.

`mainBookkeeping` is a separate grant rather than a tier, because two agents sit
at different write scopes (`artifacts` and `draft-pr`) yet both commit their own
state files straight to the default branch. A flat "the deploy key cannot push to
the default branch" rule would make both unrunnable. The grant carries path
globs, and a guarded-push helper must validate the staged diff against them.

**Global denials, at every scope:** no writes under `.claude/` (the executor
mounts a real checkout, so an agent editing it would be rewriting the registry
source that defines its own permissions), `.env*`, CI config, release config.

## 4. Prompt slots are not uniform, and getting one wrong fails silently

Three different forms exist in real prompts, and all three must work:

- positional: `$1`, `${1:-main}`, `${1:-120}`
- a **literal token**: one command reads the PR number as `<PR>`, not `$1`
- **nothing at all**: subagents have no argument hints, because their caller
  hands them context in prose. Running one directly means rebuilding that block,
  which is what a manifest's `contextTemplate` is for.

A prompt whose `<PR>` token never got substituted still runs. It just analyses
the wrong PR, confidently. That class of bug is invisible without a test, which
is why `pnpm smoke` renders every registered agent's prompt against a real
checkout and asserts nothing is left unsubstituted.

## 5. Per-run git workspace, from the data model

A bare mirror per repo plus a `git worktree` per run. Mutating agents are first
class from day one, not a deferred exception.

**Rejected:** read-only agents first, with mutation bolted on later. Also
rejected: observing agents that run elsewhere and only ingesting their artifacts.

**Why worktrees:** one agent creates a branch per work order while another
reasons about which files open branches have touched. Two runs sharing one
checkout would corrupt both. A dirty worktree is marked dirty and destroyed,
never reused.

## 6. Paths resolve against the repo root, never the cwd

The cwd differs per entry point: `apps/web` for `pnpm dev`, `packages/core` for
the seed script, the repo root for a worker. A relative default therefore
resolved somewhere different in each case, and the dev-server case was actively
harmful: it would have put a bare mirror and a full worktree checkout of the
target repo _inside the Next app directory_, where the file watcher would try to
compile all of it.

Workspaces now default outside the repo entirely (`<tmpdir>/arnold-workspaces`).
See `packages/core/src/paths.ts`.

## 7. Reason-code vocabularies stay per agent

Two agents in the reference registry emit different words for a similar idea:
one says `too-large-to-split`, the other `too-large`. Merging them into a shared
enum would split one concept across two labels in every chart, or silently
relabel one agent's output as the other's.

Each manifest keeps its own `reasonCodes` list. Charts group per agent.

## 8. Some agents only announce failure

One agent prints `REJECT: <code>` when it refuses and otherwise just returns its
work product. With a naive report parser, every _successful_ run recorded as
`unparsed` and the reject rate read as 100%.

Hence `fallbackOutcome` on the report outcome spec: a non-match on a successful
run is the accepted path, but only when a manifest explicitly says so. Without
one, a non-match still records `unparsed`, which is styled to look wrong.

## 9. A harness is not the same as its worker

One registry entry is the read-only per-batch worker of a fan-out script, not a
whole scan. The script owns the report file, the daily budget across batches, and
the ticket filing. Registering only the worker puts the console one level below
the button an operator wants to press.

So the registry models a `harness` kind whose run is a parent with one child run
per batch, and the worker is registered `invocable: "child"` — visible in the
registry and in cost breakdowns, with no Run button.

## 10. Execution mode is declared, not assumed

`unattended | needs-human | needs-local-session`, plus `unattendedIfArgs` so an
agent that normally needs a local browser becomes headless once an argument
removes that dependency.

**Rejected:** a full approval and resume channel up front (that is Phase 4), and
also merely documenting the limitation. An agent that cannot run headless should
be _visible and explained_ in the console, not absent and not silently broken.

## 11. Server Components call the query layer directly

They used to `fetch()` Arnold's own HTTP routes over localhost. The server asking
itself, over TCP, for data it can already read: four extra round trips per render,
an origin guessed from request headers, and in dev it serialised badly against
on-demand route compilation. One page was taking 17 seconds.

The HTTP routes remain what they should be: the interface for the browser and for
anything outside the process.

## 12. Some HeroUI components must be client components

HeroUI components that introspect their own children cannot receive children
created in a Server Component. `Tooltip` does
`if (!isValidElement(children)) trigger = jsx("p", {...})`, which wraps a chip's
`div` in a `p` — invalid HTML and a hydration error. `Table` uses React Aria's
collection builder and throws `Unknown element <[object Object]> in collection`.

Neither fails at compile time, so `scripts/check-rsc-boundaries.mjs` fails the
build on the combination and `pnpm build` runs it first.

## 13. Tailwind must be told to scan HeroUI's theme

Three compounding causes, all silent, all needed fixing together:

1. Tailwind 4 excludes `node_modules` from content detection. Only an explicit
   `@source` opts a path back in, so content globs pointing there did nothing.
2. Under pnpm, a transitive dependency lives only under
   `node_modules/.pnpm/<name>@<version>_<hash>/`, so `./node_modules/@heroui/theme`
   matched nothing. `@heroui/theme` is therefore an **explicit dependency** of
   the web app purely so pnpm symlinks it somewhere with a stable path. Do not
   remove it because nothing imports it: Tailwind reads it.
3. 50 of its 55 dist files are `.mjs`, which a `{js,ts,jsx,tsx}` glob misses.

**Symptom when this regresses:** utilities that appear nowhere in Arnold's own
source silently vanish. The first casualty was `Modal`'s wrapper losing its
height utility, so the panel sized to its content, the footer landed 341px below
the fold with nothing scrollable, and the primary action could not be clicked on
any screen under 1080p. Nothing errored. The button was simply out of reach.

The modal also carries redundant height classes from Arnold's own source, so the
operator's primary action does not depend on one generated utility.

## 14. SQLite accommodations to undo at Phase 1

Marked `JSON-TEXT` in the schema. SQLite has no enums, so status, scope and mode
columns are `String` with the union types living in `packages/core/src/agents.ts`
and narrowed at the DTO boundary. SQLite has no array or json scalar, so
structured columns are `String` holding JSON, read through the helpers in
`json.ts` and never with a bare `JSON.parse` at the call site.

Everything else, including the run tree and the per-scope ledger, is already the
Postgres shape.

## 15. Verify UI bugs by driving a browser, not by reading code

Recorded because it cost real time. Three rounds of plausible static diagnosis of
"nothing happens when I click Run" were all wrong. The actual cause was geometry
(see 13) — invisible in code review, obvious in one measurement.

For any "nothing happens in the UI" report: build a fixture-data preview route,
drive it with Playwright, measure element geometry and network calls, and only
then theorise.

## 16. A repo with runs is archived, never deleted

`Run.repoId` is optional, so Prisma's default referential action for the relation
is `SetNull`. Deleting a `Repo` therefore does not fail on its runs — it silently
nulls out the column, and every one of those runs loses the repo it ran against.
That is precisely the provenance the Notary exists to record, discarded by an
operator who thought they were tidying up a list.

So removal is two operations, not one:

| Operation | What survives                                        | When it is offered         |
| --------- | ---------------------------------------------------- | -------------------------- |
| Archive   | Everything. The repo leaves the switcher only.       | Always, and reversible.    |
| Delete    | Nothing to lose: refused while any run refers to it. | Only when `runCount` is 0. |

`planRepoRemoval` computes the counts before the dialog opens, so the operator
reads the consequence rather than discovering it. Core enforces the rule and the
API defaults `mode` to `archive`, so a caller that forgets the parameter cannot
destroy history by omission.

The plan alone is not the guard. It is computed for a dialog, so by the time the
button is pressed it is seconds old and dispatch may have created a run in the
gap. Three layers, because the failure is silent and unrecoverable — a detached
run cannot be re-attached, only guessed at:

1. The preflight plan, which is what the operator reads.
2. A re-read of the count inside the `deleteRepo` transaction.
3. `Run.repo` declared `onDelete: Restrict`, so the database refuses even if both
   checks above were raced. The resulting `P2003` is translated into the same
   operator-facing message as a blocked delete.

Archiving is enforced in the same place runs begin, not only in the UI that stops
offering the repo: `dispatchRun` rejects a repo with a non-null `archivedAt`.
A schedule, a direct `POST /api/runs`, or any later executor never sees the
switcher, so the refusal has to live at the boundary every dispatch crosses.

The same reasoning is why the slug is immutable after creation. Manifests name
their repo by slug and `registry/<slug>/` is a real directory; a rename in the
console would orphan every manifest pointing at it and leave the directory
behind, with nothing failing loudly enough to notice.

## 17. The repo selection is a view, not a permission

The switcher writes `?repo=<slug>` and an `arnold.repo` cookie. Both are read
back by `lib/repoSelection.ts`, URL first, and neither is trusted: a slug that no
longer resolves to an active repo falls back to "all repos" and says so, because
a cookie outliving a reseed should not render an empty console with no
explanation.

It is deliberately _only_ a view. Every trigger names its repo explicitly in the
request body, and the Dispatcher reads that, never the cookie. A stale or forged
cookie can therefore change what an operator is looking at and can never change
where a run happens — which is why the cookie is `httpOnly: false` and carries no
integrity protection. If the selection ever starts feeding the dispatch path,
that reasoning is void and it needs signing.

Two sources rather than one because they answer different questions. The URL
makes a repo-scoped view linkable, matching how the run status filter already
behaves. The cookie makes the choice survive navigating to a page that was linked
without the param. The root layout can only see the cookie — layouts are not
given search params — so `RepoSwitcher` reconciles the two on the client, which
is the one place both are visible.

The reconciliation is **one function in `lib/repoSelectionRule.ts`**, applied by
the server page and the client switcher, and the module deliberately imports
nothing server-only so both can. Two copies drifted apart the first time: the
page treated an unknown `?repo=` slug as authoritative and fell back to all
repos, while the switcher ignored it and displayed the cookie — so a stale shared
link listed every repo while the control claimed one was selected. A control that
misreports the scope is worse than no control.

An explicit slug that cannot be honoured therefore resolves to "all repos" and
says so; it never silently reverts to whatever this browser remembers. For the
same reason the nav carries `?repo=` across links: a bare destination path would
re-resolve from the cookie, turning a shared scoped link into a different repo on
the first click. Only `repo` travels — a status filter means nothing on a screen
that has none.

## 18. Never name an App Router folder with a leading underscore

`/api/repos/_probe` and `/api/repos/_selection` were the first attempt at keeping
these endpoints out of the `[repoSlug]` namespace, where a repo slug could shadow
them. Next treats an underscore-prefixed folder as a **private folder** and opts
it, and every subfolder, out of routing entirely.

The failure is quiet and misleading. `POST /api/repos/_probe` did not 404: it fell
through to the dynamic sibling `[repoSlug]/route.ts` with `repoSlug` bound to
`"_probe"`, which has no `POST` export, so it returned **405 Method Not Allowed**.
A method error for a route that exists, on a path that does not.

Both now live as siblings of `/api/repos` — `/api/repo-probe` and
`/api/repo-selection` — which cannot collide with a slug at all.

## 19. Changing a repo's clone source throws away its mirror

The bare mirror is cloned once and keyed by slug, and `ensureMirror` refreshes an
existing one by fetching _its own_ origin. So editing a repo's `localPath` or
`remoteUrl` used to be recorded and then ignored: the row named the new source
while every subsequent run kept executing the old one.

That is the worst shape a bug can take here. Nothing errors, runs keep succeeding,
artifacts keep being collected — against code nobody pointed at, with a
provenance record that names the wrong source.

So a source change calls `discardRepoWorkspaces`, which removes the mirror and
every worktree derived from it, on disk and in the database, and the next lease
re-clones. It refuses while any workspace is leased, and the discard happens
_before_ the row is written: if the mirror cannot be rebuilt now, the edit must
not land either, or the row and the disk disagree again in the other direction.

Name and branch edits do not trigger it. Only the two fields that decide where
the code comes from.

## 20. The tracker is a binding, not a branch in the prompt

`prompts/work-queue.md` carried 24 lines of Atlassian REST — basic-auth assembly,
transition-id resolution by name, the agile sprint endpoint — and
`prompts/plan-week.md` carried JQL and `getJiraIssue`. Both were unconditional.
A repo without a Jira account could not run either agent, and the only escape was
`WORK_QUEUE_NO_JIRA=1`, an env var that skipped the whole section.

That is the wrong seam. **The discipline of keeping a board in step is identical
on any tracker; the calls that carry it out never are.** Which state a ticket
should be in, recomputed from all the sibling orders that share it; when to move
it; that a failed board write must never park an order — none of that is
Atlassian-specific, and all of it was tangled with prose that is.

So the prompts keep the discipline and the mechanics arrive through
`registry/trackers/`, exactly as `registry/ledtraad/doc-drift.ts` supplies
measurements to a repo-agnostic auditing prompt. Three bindings:

| Binding         | Cost                                  | For                                     |
| --------------- | ------------------------------------- | --------------------------------------- |
| `githubTracker` | none — `gh` is already authenticated  | any repo with a PR flow                 |
| `noTracker`     | none — `queue.jsonl` is the board     | a single-committer repo, e.g. ledtraad  |
| `jiraTracker`   | four secrets and an HTTP client grant | a repo that actually has a Jira project |

**Rejected: an `if` in the prompt.** Three trackers described inline is three
sets of instructions the model must skip past, in a file already long enough to
be a cost line. It also makes the wrong thing easy — a fourth tracker means
editing the prompt every repo shares.

**Rejected: Linear or a self-hosted Forgejo as the free option.** Linear's free
tier caps at 250 issues and adds a SaaS dependency; Forgejo is real ops for one
person. GitHub Issues wins on one fact that outweighs the feature comparison:
`work-queue` already shells `gh pr create` and `gh pr view`, so issues need no
new credential, no new env var, and no MCP server.

**"No tracker" is a declaration, not a skipped section.** A binding that says so
tells the agent _why_, which stops it hunting for a board, and lets the report
omit the tracker section rather than print an empty one. `queue.jsonl` already
records status, attempts and the PR URL per order — that is everything a board
would have shown.

### What a binding has to supply, and why each field exists

Two prose blocks (`trackerSync`, `trackerQuery`) were the obvious part. The other
four are the places a tracker leaks out of prose, each found by rendering the
prompts against all three bindings:

- `branchGlob` — the hot-file set is built from unmerged branches matching
  `PROJ-*`. On GitHub that is `issue-*`; too narrow and an in-flight branch is
  missed, which is how two orders collide on one file.
- `ticketExample` — `plan-week` writes a `queue.jsonl` example. An example in the
  wrong shape gets copied faithfully into a real queue.
- `mcpServers` — `["atlassian"]` hardcoded next to a GitHub binding pre-flights a
  server the run will never call, failing it before it starts.
- `allowedTools` — this one closed a real bug rather than anticipating one.
  `work-queue`'s allow-list is `git`, `gh pr`, and the project's checks: nothing
  that can reach a network API. At `scopeEnforcement: "manifest"` its Jira POSTs
  were refused by the very policy the prompt was written against, so every board
  update would have failed as a tool denial and been logged as a tracker outage.
  The Jira binding now grants `Bash(curl -sS *)` — deliberately broad, because
  pinning the pattern to a host and header shape breaks the moment an argument is
  reordered. An agent holding a Jira token plus an unrestricted curl is the
  residual risk, and it is a further reason `githubTracker`, which needs no such
  grant, is the better default.

### The ticket-key regex was the silent half

`extractTicketKeys` matched `/\b[A-Z]{2,10}-\d+\b/` and was commented
"Jira-style keys". A GitHub issue is `#482`, which it does not match — so a repo
on `githubTracker` would have recorded `ticketKeys: null` on **every** run while
nothing errored. Provenance degrading to nothing, quietly, is the exact failure
this module exists to prevent.

It now matches both shapes, and caps the issue number at five digits to keep
six- and eight-digit hex colours out. `#abc`-style shorthand that happens to be
all-numeric still collides, and that is the accepted trade: a false key is
visible in the provenance strip and costs a glance, a missing one is invisible
and costs the record.

### Still Jira-shaped: the issue-_creating_ path

`fix-pr-comments`, `pr-loop-analyzer-subagent` and `ai-smell-scan` still read
`{{trackerProjectKey}}` and `{{trackerParentIssue}}` directly. They are a third
mechanic — filing a new issue, rather than reading a backlog or moving a ticket —
and they are untouched and working. That mechanic is the one the findings
pipeline needs, so it is deliberately left for the work that will actually
exercise it.
