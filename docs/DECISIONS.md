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
