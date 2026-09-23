/**
 * Purpose: no tracker at all, as a first-class binding rather than an escape
 * hatch.
 *
 * This is the right answer more often than it looks. `registry/ledtraad/` is a
 * single-committer repo with no CI and no PR flow, and its index file already
 * states that nothing in it may write to the repo — a Jira-shaped board there is
 * ceremony, not process. Making "none" a binding instead of a skipped section
 * means the prompt reads the same on every repo and the difference lives in one
 * place.
 *
 * The precedent is that `work-queue` already tolerated this: `WORK_QUEUE_NO_JIRA`
 * existed for rehearsals, and the failure policy was already "the tracker never
 * blocks the code". This turns a flag into a declaration.
 *
 * What replaces the board is the queue itself. `queue.jsonl` already records
 * status, attempts and the PR URL per order, and `log.jsonl` records every
 * outcome — which is everything a board would have shown, minus a human having
 * to keep it in step.
 */

import type { TrackerBinding } from "./types.js";

export type NoTrackerConfig = {
	/**
	 * Why this repo has no tracker, quoted into the prompt. Not decoration: an
	 * agent that is told *why* there is no board does not go looking for one, and
	 * a reader of the rendered prompt can tell a deliberate choice from an
	 * unfinished binding.
	 */
	reason: string;
};

export function noTracker({ reason }: NoTrackerConfig): TrackerBinding {
	return {
		// The queue's own id. Uppercase-hyphen-digits, so notary.ts recognises it
		// with no tracker-specific pattern.
		ticketKeyShape: "WO-<number>",
		ticketExample: "WO-1",
		branchExample: "WO-1",
		branchGlob: "WO-*",
		mcpServers: [],
		// Nothing to grant. A no-tracker binding that widened the allow-list would
		// be granting reach for calls the prompt tells the agent not to make.
		syncAllowedTools: [],
		queryAllowedTools: [],
		// `queue.jsonl` is the board, and it is in the repo.
		syncWritesExternally: false,

		trackerSync: `
**This repo has no issue tracker.** ${reason}

So there is no board to keep in step, and this whole step is a no-op:

- Do not look for one. There are no credentials to read, no MCP server to
  resolve, and no REST call to make. Time spent hunting for a tracker is time
  the runway does not have.
- Apply the computed state to **nothing**. The state still matters — it is what
  the report prints — but it is not written anywhere outside \`queue.jsonl\`.
- \`queue.jsonl\` **is** the board. Its \`status\`, \`attempts\` and \`pr\`
  fields, plus \`log.jsonl\`, already record everything a tracker would have
  shown. Keep them accurate and you have kept the board in step.
- Omit the **Tracker** section from the final report entirely. Do not print an
  empty one and do not report "tracker skipped" — there is nothing skipped,
  because there is nothing there.

The \`ticket\` field in \`queue.jsonl\` carries the order's own id (\`WO-<n>\`)
rather than an external key, and the rule that recomputes a ticket's state from
all its sibling rows still applies — several orders can share one subject here
just as they can share one ticket elsewhere.
`.trim(),

		trackerQuery: `
**This repo has no issue tracker.** ${reason}

There is no backlog to gather and this step cannot run as written. Do not
substitute one: reading the repo and inventing candidate work is exactly the
failure this step's hard-stop exists to prevent — it produces plausible orders
nobody asked for, and they are expensive to discover downstream.

Stop here and say so, unless the caller handed you candidates explicitly. The
readiness audit in Step 6 is also skipped: with no backlog there is no supply to
measure against capacity, and a runway figure computed from nothing is worse
than an absent one.
`.trim(),
	};
}
