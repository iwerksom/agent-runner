/**
 * Purpose: the contract between a prompt that keeps a board in step and the
 * tracker it happens to be pointed at.
 *
 * This is the same split `registry/ledtraad/doc-drift.ts` makes for
 * measurements, applied to trackers: **the discipline of keeping a board in
 * step is identical on any tracker; the API calls never are.** So the prompts
 * keep the discipline — when to move a ticket, how to recompute its state from
 * all of an order's siblings, that a failed board write must never park an
 * order — and everything tracker-specific arrives through this binding.
 *
 * Before this existed, `prompts/work-queue.md` carried 24 lines of Atlassian
 * REST: basic-auth assembly, transition-id resolution, the agile sprint
 * endpoint. A repo without a Jira account could not run the agent at all, and
 * the only escape was an env var (`WORK_QUEUE_NO_JIRA`) that skipped the whole
 * section. See docs/DECISIONS.md #20.
 *
 * Each field names the placeholder it fills, because a mismatch between the
 * key here and the `{{name}}` in the prompt body is caught only at render time.
 */

/** The logical states `work-queue` computes. A binding maps these to its tracker. */
export const TRACKER_STATES = ["In Progress", "Blocked", "Testing"] as const;
export type TrackerState = (typeof TRACKER_STATES)[number];

export type TrackerBinding = {
	/**
	 * Fills `{{trackerSync}}` in `prompts/work-queue.md`: how to authenticate,
	 * how to apply one of `TRACKER_STATES` to a ticket, and how to put it where
	 * a human will see it. Must also say, in its own words, that the agent never
	 * creates an issue and never marks anything done — the prompt says it too,
	 * but this block is what a reader checks against.
	 */
	trackerSync: string;
	/**
	 * Fills `{{trackerQuery}}` in `prompts/plan-week.md`: how to list candidate
	 * work, how to read one in full, and what to do when the tracker is
	 * unreachable.
	 */
	trackerQuery: string;
	/**
	 * How a ticket is written in `queue.jsonl`, order filenames and branch names.
	 * Recorded here because `packages/core/src/notary.ts` has to recognise it in
	 * a transcript, and a tracker whose keys that regex does not match records
	 * `ticketKeys: null` on every run without erroring.
	 */
	ticketKeyShape: string;
	/**
	 * Fills `{{ticketExample}}` — one concrete key, used in the `queue.jsonl`
	 * example `plan-week` writes. An example in the wrong shape is copied
	 * faithfully into a real queue, so this is not decoration.
	 */
	ticketExample: string;
	/**
	 * Fills `{{branchExample}}` — the same ticket spelled as one branch-safe word,
	 * used for the example's `branch` and `order_file`. Separate from
	 * `ticketExample` because the two differ on GitHub: `#482` is the key, but
	 * `#` in a branch name starts a comment in an unquoted `git checkout`, and
	 * would not match `branchGlob` either. Must match `branchGlob`.
	 */
	branchExample: string;
	/**
	 * Fills `{{branchGlob}}` — the pattern matching branches this tracker's work
	 * creates, used to build the hot-file set. Too narrow and an in-flight branch
	 * is missed, which is how two orders collide on one file.
	 */
	branchGlob: string;
	/**
	 * MCP servers the tracker needs, for the manifest's `tools.mcpServers`.
	 * Part of the binding rather than the manifest because it is the one
	 * remaining place a tracker leaks into a manifest: leave `["atlassian"]`
	 * hardcoded next to a GitHub binding and the run is pre-flighted against a
	 * server it will never call, failing before it starts.
	 */
	mcpServers: string[];
	/**
	 * Tool patterns the sync block's own commands need, merged into
	 * `work-queue`'s `tools.allowedTools`.
	 *
	 * This closed a real gap rather than anticipating one. `work-queue`'s
	 * allow-list is `git`, `gh pr`, and the project's checks — nothing that can
	 * reach a network API — while its prompt instructed the agent to POST Jira
	 * transitions. At `scopeEnforcement: "manifest"` those calls were refused by
	 * the very policy the prompt was written against, so every board update
	 * would have failed as a tool denial and been logged as a tracker outage.
	 */
	syncAllowedTools: string[];
	/**
	 * Tool patterns the query block's commands need, merged into `plan-week`'s
	 * `tools.allowedTools`. Read-only by construction and kept apart from
	 * `syncAllowedTools` so the planner, which never moves a ticket, is never
	 * granted what moves one.
	 */
	queryAllowedTools: string[];
	/**
	 * True when the sync block writes to a system outside the repo. A board
	 * update is an external write in `writeScope.ts`'s terms, denied below
	 * `external-writes`, so a manifest that syncs through this binding has to
	 * run at that scope — or every board update is refused and logged as a
	 * tracker outage.
	 */
	syncWritesExternally: boolean;
};
