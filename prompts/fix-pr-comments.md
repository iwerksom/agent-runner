---
description: Fetch a PR's Copilot review comments, fix the substantive ones, push, re-request, loop until clean (bounded), emit metrics, and self-diagnose if it can't converge.
argument-hint: <pr-number>
---

Automate the automated-reviewer→fix cycle for PR #$1 using the `gh` CLI (with
GitHub GraphQL where noted). Goal is CONVERGENCE, not addressing every possible
suggestion — auto-fixing trivial nits keeps changing the diff and spawns new
nits, so only substantive comments get code changes.

Prerequisite (one-time): `gh extension install k1LoW/gh-copilot-review`.

Two files govern this loop and must be read before the first round:

- The repo's conventions file — `CLAUDE.md` or `AGENTS.md` at the repo root.
  It defines the project's commands (typecheck, tests, lint, formatting,
  dead-code check), its commit-message format, its branch naming, and its code
  rules. Every "the project's X" below means "X as that file defines it".
- The repo's automated-review instructions file — whatever file the automated
  reviewer reads for its house rules (the conventions file will say where it
  lives). It defines the SUBSTANTIVE bar used throughout this command.

Resolve TICKET from the head branch (`[A-Z]+-\d+`, e.g.
`{{trackerProjectKey}}-1005`); if none, ask before committing.

Round log: maintain `.pr-loop/PR-$1.md`. At the end of EACH round append a
section with: round number, head SHA, and for every comment — file:line, a
one-line summary, classification (SUBSTANTIVE/MINOR), THEME (e.g. "input
validation"), action taken, commit SHA, and `fix-spawned: yes/no` (yes if the
comment targets code a previous round's fix introduced/changed). This log is the
analyzer's data source — keep it accurate.

Track a round counter. MAX_ROUNDS = 3. Each round:

1. Fetch the latest automated review + unresolved inline comments on the current
   head of PR #$1. If none → terminal case `clean`.
2. Classify each comment SUBSTANTIVE vs MINOR per the repo's automated-review
   instructions file.
3. MINOR: don't change code. Reply with a one-line reason and resolve the
   thread. If it's a worthwhile future enhancement, record it (see
   "Enhancements" below).
4. SUBSTANTIVE: fix in the working tree. When a comment reveals a CLASS of issue
   (e.g. "validate this persisted field"), fix the WHOLE class this round (all
   analogous sites), not just the flagged instance — biggest lever for fewer
   rounds.
5. If code changed:
   a. Self-review the fix diff as if you were the next round's reviewer.
   Fix-spawned comments (a later comment targeting code an earlier fix wrote)
   are the loop's top convergence killer, so catch them in the round that
   introduces them. If the fix adds or changes any payload/response/message
   shape, locate its existing consumer (parser, schema, caller) and verify
   the new shape against that contract — e.g. a new error response must
   still parse through the project's error-envelope parser as the envelope
   type its consumers expect; run the consumer's tests. If the fix touches
   concurrency (in-flight slots, force/refresh, aborts), re-enumerate the
   interleavings on the FIXED code, not just the flagged symptom: can `force`
   start a second concurrent writer? can an older completion overwrite newer
   state? is there exactly one writer per slot?
   b. Re-read the top-of-file Purpose/header documentation block of every file
   the fix touched and update any that no longer match the code, even if the
   staleness predates the fix (hard rule in the repo's conventions file).
   c. Verify with a fail-fast chain: the project's typecheck, then the relevant
   unit tests, then lint on the changed files, then the formatter check on
   the changed files — using the exact commands the conventions file
   specifies, chained with `&&`, never `;`; a failing check MUST block the
   commit.
   d. Commit + push using the repo's commit-message format, with the TICKET key
   and a summary of the fix.
6. Reply on each SUBSTANTIVE thread with what changed (+ commit SHA) and resolve
   it (GraphQL `resolveReviewThread`; ids via `repository.pullRequest.reviewThreads`).
   Append the round to `.pr-loop/PR-$1.md`.
7. Decide: - Round had ZERO substantive comments (only minors) → terminal case
   `minors_only`. - counter < MAX_ROUNDS → re-request + wait (`gh copilot-review $1 --force --wait`), increment counter, interpret result (step 9), continue. - counter == MAX_ROUNDS → step 8.
8. AT THE CAP — final recheck, then self-diagnose:
   a. Before re-requesting, re-read every changed hunk in files that received at
   least one comment in any prior round and apply the SUBSTANTIVE bar from the
   repo's automated-review instructions file. If a new issue is found, fix it
   and commit before the final re-request (this catches issues the reviewer
   missed on earlier passes but may surface on a fresh look). Record this
   self-scan as a distinct section in the round log.
   b. Re-request once more and wait.
   c. Clean / no comments → terminal case `converged_on_recheck`.
   d. Comments remain → invoke the `pr-loop-analyzer` subagent (PR #$1 + log
   path). It writes an improvement report under `.pr-loop/reports/` and routes
   its command-improvement suggestions per "Enhancements" below. Terminal case
   `cap_not_converged`.
   e. error/timeout → handle per step 9.
9. Re-request result → terminal case: error placeholder
   (`/encountered an error and was unable to review/i`) → retry 3× ~60s apart,
   else `copilot_error`; new review w/ comments → continue; no comments →
   `clean`; `--wait` timeout → `wait_timeout`; `gh copilot-review` non-zero →
   `tool_error`.

## Metrics (ALWAYS, on every terminal case — success OR failure)

Before the final STOP, append ONE JSON line to `.pr-loop/metrics.jsonl`:
`{ "ts": <ISO8601>, "pr": $1, "ticket": "<TICKET>", "outcome":
"<clean|minors_only|converged_on_recheck|cap_not_converged|copilot_error|wait_timeout|tool_error>",
"rounds": <n>, "substantive_fixed": <n>, "minor_declined": <n>,
"fix_spawned_count": <n>, "themes": [<themes>], "dominant_root_cause":
"<cause|null>", "commits": [<shas>], "friction": "<one-line note on anything
that needed retries/manual nudging, or empty>", "analyzer_report": "<path|null>",
"enhancements": [<tracker issue keys or md paths>] }`
Then print a short human summary AND the metrics line. Never finish silently.

## Persist the loop record (LAST action, every terminal case)

After appending the metrics line, commit the loop's own bookkeeping so it is
versioned and analyzable later — this is the final action before STOP:

- Stage ONLY the loop's files: `.pr-loop/PR-$1.md`, `.pr-loop/metrics.jsonl`,
  and any `.pr-loop/reports/` or `.pr-loop/enhancements/` files written this
  run. Use explicit paths (`git add .pr-loop/PR-$1.md .pr-loop/metrics.jsonl …`),
  never `git add -A` or `git add .pr-loop` — do not sweep in product code or
  unrelated working-tree files.
- Commit on the PR head branch, using the repo's commit-message format, with a
  summary that identifies it as the loop's bookkeeping (e.g. `chore(pr-loop):
record review-loop log and metrics for PR #$1`), and include `[skip ci]` in
  the message so this docs-only commit does not re-trigger CI or a fresh
  automated review cycle. Keep it a SEPARATE commit from any product fixes so it
  is easy to identify or drop.
- Push. If the push or commit fails, or if `.pr-loop/` is git-ignored (check
  `git check-ignore`; if ignored, do NOT force-add), skip the commit and say so
  in the human summary instead of failing silently.

## Enhancements (future work + command improvements)

When you or the analyzer identify a future enhancement (declined MINOR worth
keeping) or a suggestion to improve `fix-pr-comments`/`pre-pr-review`/ the
repo's automated-review instructions file:

- If an issue-tracker mechanism is available (a tracker MCP tool, or a
  configured tracker CLI): create an issue — project `{{trackerProjectKey}}`,
  type Task, parent `{{trackerParentIssue}}`, label `tooling`/`tech-debt` — and
  record the issue key.
- Otherwise: write a paste-ready file to `.pr-loop/enhancements/<slug>.md`
  (title as `<type>(<scope>): <summary>`, plus Context / Proposed / Acceptance
  criteria) for the user to verify and paste into the tracker.
- Record each created key or file path in the metrics line's `enhancements`.

Guardrails:

- Reply before resolving; never silently resolve. Error placeholder is never "clean."
- Never force-push or change the PR base branch.
- If a comment contradicts the repo's conventions file, reply explaining and
  resolve.
- If the same substantive comment reappears after being addressed, stop and ask.
- The analyzer is report-only; never auto-apply its suggestions or auto-edit the
  workflow files — surface them as tracker issues / MD enhancements only.
