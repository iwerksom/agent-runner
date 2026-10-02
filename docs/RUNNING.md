# Arnold: Running it

How to run Arnold, how to trace a run, what has actually been run on which tree,
and the traps that cost time. What is built and in what order is in the roadmap
(`docs/ROADMAP.md`, each phase carries a status); known problems are GitHub
issues, listed per feature in the roadmap.

**The current tree runs.** Only the read-only and `artifacts` tiers have run;
everything above them is held in code until the Phase 2 sandbox or Phase 8 auth.
With `ARNOLD_TRACE_PLUGIN_DIR` set each run also lands as an MLflow trace.

---

## What has run

Real runs, by date. Costs are from the ledger, which is the source of truth.

| Date              | Repo                   | Agent                                                | Runs | Cost       | Notes                                                                        |
| ----------------- | ---------------------- | ---------------------------------------------------- | ---- | ---------- | ---------------------------------------------------------------------------- |
| 2026-08-13 and 14 | (a repo since deleted) | `work-order-scoper`, `pr-loop-analyzer`, `plan-week` | 5    | $0.47–0.74 | First runs; their repo was deleted, so `repoId` is null (DECISIONS #16)      |
| 2026-09-12        | `ledtraad`             | `docid-invariant`                                    | 1    | $0.93      | First run after the placeholder fix                                          |
| 2026-09-12        | `ledtraad`             | `doc-drift`                                          | 2    | $1.59–1.78 | 34 and 39 turns; sized the agent's budget                                    |
| 2026-10-01        | `sandbox`              | `sandbox-doc-drift`                                  | 8    | $0.07–0.32 | One failed; the rest found all three planted drifts                          |
| 2026-10-01        | `ledtraad`             | `doc-drift`                                          | 4    | $1.91–2.77 | 33 to 66 turns; the runs that shaped the findings design (Phase 1)           |
| 2026-10-01        | `ledtraad`             | `ledtraad-work-order-scoper`                         | 2    | $0.00–2.01 | One failed at the turn limit, which exposed the failed-spend bug (#38)       |
| 2026-10-02        | `sandbox`              | `sandbox-doc-drift`, `sandbox-readme-report`         | 3    | $0.07–0.25 | First runs inside the Docker sandbox (feature 2.1); one cancelled on purpose |
| 2026-10-02        | `ledtraad`             | `doc-drift`                                          | 3    | $1.15–2.69 | Checked finding rows end to end; one died at the 45-turn cap                 |

`sandbox` is a throwaway local repo (`registry/sandbox/`) whose README carries
three deliberate drifts, so a run is either right or wrong. It is the cheapest
way to prove a change end to end without pointing Arnold at a real project. Add
it from `/repos` with the local path of any small git repo of the same shape.

---

## Executing work orders: a temporary bridge

Until `work-queue` runs on a repo (feature 3.1, #36), an accepted work
order reaches code through GitHub and a Claude Code skill, outside Arnold:

1. Run a `*-work-order-scoper` binding on an issue, e.g. `#41` on ledtraad.
2. `pnpm orders:publish <runId>` posts the order as a comment on that issue,
   marked with the run id and the base SHA it was scoped at, and labels the
   issue `wo:proposed`. `--dry-run` prints it instead. It refuses a failed run,
   a rejected order, and any agent other than a scoper.
3. The repo owner approves by swapping the label to `wo:approved`.
4. In that repo, ask Claude Code to run approved work orders. The skill
   (`bridge/run-work-orders/SKILL.md`, symlinked into `~/.claude/skills`)
   executes only orders the owner approved after the order was posted, parks
   an order whose files changed since its base SHA, and ends at a draft PR with
   `Closes #<n>`. It never merges.

GitHub is the queue because it persists and shows on the board, which
`.week-plan/queue.jsonl` in a leased worktree does not. Delete
`scripts/publish-order.ts`, `bridge/` and the symlink when #36 lands.

---

## Tracing runs in MLflow

Opt-in, and off unless `ARNOLD_TRACE_PLUGIN_DIR` is set.

1. `pip install "mlflow>=3.4"` in a virtualenv, then `mlflow server --port 5000`.
2. In the target repo: `mlflow autolog claude -u http://localhost:5000 -n <name> -y`.
   It writes an `env` block to `.claude/settings.json` and installs the
   `mlflow-tracing` plugin. **Commit `settings.json`**: a run sees the leased
   worktree, not your checkout.
3. Start the console with `ARNOLD_TRACE_PLUGIN_DIR` pointing at
   `~/.claude/plugins/cache/mlflow-plugins/mlflow-tracing/<version>`.

Step 3 is needed because the plugin is installed with `--scope local`, which
binds it to the checkout's own path; a worktree never has that path, so without
it the SDK init event shows `plugins: []` and nothing is traced.

Each run yields an AGENT span, one TOOL span per tool call and an LLM span. The
plugin attaches usage to the last LLM call only, so MLflow's cost and token
figures undercount by roughly 3×. **The ledger is the source of truth for cost.**

---

## Getting a first real run on a new repo

In order. Each step is small and each one de-risks the next.

1. **Point it at a repo you actually have.** Open `/repos`, press Add
   repository, and give it a local checkout with a `.claude/` directory. The path
   is probed as you type, so a typo is caught here rather than at lease time.
   Saving it syncs the registry, which lists that repo's commands as
   `unregistered`. This works on an empty database; nothing needs seeding first
   except the operator, which `pnpm setup` creates.
2. **Write one manifest for one read-only agent of your own**, copying the shape
   of `registry/example-repo/work-order-scoper.ts`. Narrow `Bash` to the exact
   invocations its prompt runs.
3. **Run `pnpm smoke <your-checkout>`** before touching the UI. If prompt
   rendering is wrong, a run will succeed while doing the wrong thing.
4. **Trigger it from the console and watch the terminal.** This is where the
   first real failure shows up. The workspace lease and the SDK adapter both log
   loudly.
5. **Check the database**, not just the UI:
   `sqlite3 packages/core/prisma/arnold.db "select id, status, exitReason from Run"`.
   A run that never leaves `queued` means the dispatcher returned before the
   executor started. A run stuck in `running` means the loop threw somewhere the
   `finally` did not cover.

---

## Environment traps

Each of these cost real time. They are all documented in code comments too, but
here they are in one place.

**Env files are loaded by two shims, not by the tools.** The Prisma CLI reads
only `.env`, and only from its own working directory; Next reads env files from
`apps/web`. The single source is `.env.local` at the repo root, injected by
`scripts/with-env.mjs` for CLI scripts and by `apps/web/next.config.mjs` for the
app. Do not scatter copies. Symptom of getting this wrong:
`P1012: Environment variable not found: DATABASE_URL`.

**`@heroui/theme` is a dependency nothing imports.** It exists so pnpm symlinks
it where Tailwind's `@source` can scan it. Removing it silently deletes every
HeroUI utility that appears nowhere in Arnold's own source. See DECISIONS #13.

**Webpack needs `extensionAlias`.** `@arnold/core` is TypeScript ESM, so its
internal imports carry the `.js` extension the emitted JavaScript would have.
TypeScript resolves that; webpack takes it literally and fails with
`Can't resolve './agents.js'`.

**Workspaces default outside the repo.** A worktree holds a full checkout of the
target repo. Inside this repo, the dev watcher, `tsc` and `knip` would all treat
it as source. See DECISIONS #6.

**Prisma engine binaries need network on first install.** `pnpm db:generate`
downloads them. In a sandbox where `binaries.prisma.sh` is unreachable, no query
can execute at all; `pnpm typecheck:offline` generates a type-only client stub so
`tsc` still verifies the repo, and `pnpm smoke` needs no database.

---

## Lessons from working with Claude Code

Two things worth knowing, learned the hard way. Today the session runs on the
desktop that holds the database and the API key, and the laptop connects to it,
so the first lesson is satisfied by construction; it is kept because it explains
why a cloud session cannot stand in for it.

**Run it locally for anything involving a live run.** A cloud session cannot
execute a Prisma query if the engine binaries are unreachable, so it cannot
reproduce the runtime at all. It is good at authoring, typechecking, building and
browser-driven UI verification; it is bad at "run it and read the console".

**For UI bugs, measure before theorising.** Build a fixture-data preview route,
drive it with Playwright, and check element geometry and network calls. See
DECISIONS #15 for why this is written down.

---

## Running agents in the Docker sandbox, and solo mode

Feature 2.1. The sandbox is off unless `ARNOLD_SANDBOX=docker` is set. `read-only`,
`artifacts`, `working-tree`, `branch-push` and `draft-pr` agents have a profile;
`external-writes` does not and refuses to start sandboxed.

1. Docker must work for your user (`docker run --rm hello-world`). In WSL, join the
   `docker` group and open a fresh session.
2. Build the image: `pnpm sandbox:build`.
3. Start the console with the variable set: `ARNOLD_SANDBOX=docker pnpm dev`.

Each run then executes the whole `claude` process in a container named
`arnold-<runId>`: worktree and mirror read-only (writable where the tier needs it),
an empty `HOME`, no credentials except the model key, read-only root filesystem, no
capabilities. `docker ps` shows it while it runs.

**Releasing the held tiers on a single-user console.** Agents at `working-tree`,
`branch-push` and `draft-pr` are held by default, on the agent card and at dispatch.
Setting **both** `ARNOLD_SOLO=1` and `ARNOLD_SANDBOX=docker` releases them. The
first run at a tier starts a canary self-test container; if it fails (image missing,
a mount too wide) the tier stays held and the refusal says why. Never set
`ARNOLD_SOLO=1` on a console other people can reach: the sandbox contains what an
agent can do, not who may start it (that is Phase 8).

Credentials: a read-only forge token for agents that use `gh` goes in
`ARNOLD_GH_READ_TOKEN`; pushing tiers need `ARNOLD_GH_PUSH_TOKEN` (or
`ARNOLD_GH_PUSH_TOKEN_<SLUG>` for one repo) and use `ARNOLD_GIT_NAME` and
`ARNOLD_GIT_EMAIL` for commits (DECISIONS #30).

To restart a console you started in the background, kill both `next dev` and
`next-server`: killing only one leaves the old server on the port, still running
with the old environment.
