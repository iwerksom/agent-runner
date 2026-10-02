# Adding a new agent

How to register an agent so the console can run it. The contract an agent must
meet is in `docs/architecture.md`; worked examples are in
`docs/reference-agents.md`.

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
