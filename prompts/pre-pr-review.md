---
description: Review the current branch's diff locally (as Copilot would) and fix substantive issues before opening/pushing the PR.
argument-hint: "[base-branch, default: main]"
---

Do a thorough local pre-PR review of this branch so the eventual automated
review has little to flag. Base branch is $1 (defaults to the repo's default
branch, `{{defaultBranch}}`, if omitted).

1. Show the diff vs the base: `git fetch origin ${1:-main}` then
   `git diff origin/${1:-main}...HEAD` (and list changed files).
2. Review every change against BOTH:
    - The substantive bar in the repo's automated-review instructions file (the
      file the automated reviewer reads for its house rules) — correctness,
      security, real error handling, type holes, contract regressions, missing
      tests for new non-trivial logic.
    - The repo conventions in `CLAUDE.md` / `AGENTS.md` at the repo root — read
      that file and apply every rule it states, including its structural rules,
      naming rules, documentation-block requirements, and the commands it
      defines for typecheck, tests, lint, formatting, and dead-code checks.
    - The repo's architecture/structure docs (whatever the conventions file
      points at, e.g. `docs/architecture.md`), whenever the diff adds, moves,
      renames, or deletes a file. Check the destination against the documented
      layout: an added folder that is not an existing documented domain or the
      documented `shared/` bucket is a substantive finding, as is a new file at
      the root of a directory the docs say must be partitioned, or an addition
      to a bucket the docs freeze. A new folder without a matching entry in the
      docs' structure lists and its own domain doc is a violation, not a new
      domain. Verify domain-vs-`shared/` by counting importers — two or more
      domains means `shared/`.
    - Test bar for new concurrency-bearing hooks/utils: any NEW hook or util
      with in-flight dedup, force reload, abort, or out-of-order completion MUST
      ship hook-level coverage in the project's test runner (rendering the hook
      directly, not only through a component) exercising at least
      request-in-flight + force, an older completion finishing after
      replacement, and an error during force. Treat absence as a substantive
      finding to fix before the PR.
3. Adversarial pass — REQUIRED for any function that reads data it did not
   itself produce: persisted state (localStorage/IndexedDB), network/API
   payloads, URL/query params, message-passing, or anything deserialized. For
   each, ask and check explicitly:
    - What if a field is missing, the wrong type, or `null` where the type says
      otherwise? (string `"true"` for a boolean, number for a string, etc.)
    - What if the object carries a `__proto__` / `constructor` key? (use
      `Object.create(null)` or guard before writing into a plain object.)
    - What if two pieces of state contradict each other — e.g. a terminal
      `phase` with a stale `running`/`cancelled`/`error` flag? Is there ONE
      place that enforces the invariant, or is it re-derived ad hoc at each
      call site?
    - Does any UI gate on a different field than the one normalization sets?
      Treat anything that survives a corrupted/hostile payload incorrectly as
      substantive, even if the call sites today only pass clean data.
    - Concurrency: what if two async operations interleave? Can an older
      completion overwrite newer state, or can `force` start a second concurrent
      writer to the same slot? Is there exactly ONE writer per slot?
    - Async aggregation: for any function that aggregates results from multiple
      async operations (`Promise.allSettled`, `Promise.all`, reduce over settled
      results): verify EVERY failure path inside each operation either throws or
      returns an explicit failure value (e.g. `{ ok: false }`). An early return
      without throwing is invisible to the aggregator and makes the aggregate
      success/failure check produce a wrong answer. This is a correctness bug.
    - New response/error shapes: any NEW error or response path the diff adds is
      data another layer consumes. Locate its consumer (parser, schema, caller)
      and confirm the new shape parses against that contract — e.g. that a new
      error response still goes through the project's error-envelope parser and
      matches the envelope type its consumers expect — before opening the PR.
    - CI/tooling config: for any changed `*.config.ts`, `*.config.js`, or JSON
      build/test config, verify string values that reference package names
      (reporters, plugins, presets, transforms) exactly match the installed
      package name in the manifest (`package.json` or the language's
      equivalent). A mismatch silently falls back or throws at runtime.
    - Accessibility sweep for ALL new or changed interactive UI in the diff, not
      just one component: every control has an accessible name in every render
      mode; nothing visually hidden, collapsed, or translated off-screen stays
      focusable (use `inert` + `aria-hidden`); show/hide of panels and drawers
      manages focus. Treat failures as substantive.
4. Doc-drift pass — for every function whose behavior changed, re-read its
   top-of-file Purpose/header documentation block and any inline WHY comments.
   If a comment now states behavior the code no longer has, FIX the comment
   (this is substantive per the repo's automated-review instructions file — a
   wrong comment is not a wording nit). Pure phrasing improvements with no
   inaccuracy are out of scope.
5. Fix the substantive issues directly in the working tree. When you find a
   defect, ask whether it is an instance of a class (same invariant violated in
   several places). If so, fix the invariant ONCE at a single enforcing exit
   (e.g. a normalize/validate helper) and add a test covering the class —
   rather than patching each site. This is what stops the `/fix-pr-comments`
   loop from re-surfacing the same theme round after round.
6. For anything that's only subjective/minor, note it in the summary but do NOT
   change code for it (avoid churn that just invites more review comments).
7. Verify with the project's own commands, as defined in the conventions file:
   the typecheck, the relevant unit tests for the changed paths, lint on the
   changed files, and the dead-code check. Fix real failures (ignore dead-code
   false positives that are pre-existing infra).
8. Summarize: what you fixed, what you deliberately left (with reasons), and
   confirm the verification results. Do NOT push or open the PR unless asked —
   just leave the branch clean and ready.

Goal: make the first automated review pass converge quickly. Front-load the
substantive fixes here — especially the adversarial and doc-drift passes, which
are the classes the automated reviewer catches that a convention-only review
misses — so the `/fix-pr-comments` loop runs at most once or twice.
