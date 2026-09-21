/**
 * Purpose: the free tracker. GitHub Issues, driven entirely through `gh`.
 *
 * Chosen over Linear (250-issue free tier, plus a SaaS dependency) and
 * self-hosted Forgejo (real ops for one person) for one reason that outweighs
 * the feature comparison: **the executor is already authenticated to GitHub.**
 * `work-queue` shells `gh pr create` and `gh pr view` today, so issues cost zero
 * new credentials, zero new env vars, and no MCP server — where the Jira binding
 * needs four secrets and a REST client the agent hand-rolls.
 *
 * Two places GitHub does not line up with Jira, handled here rather than in the
 * prompt:
 *
 *   - **No workflow states.** Jira transitions become labels. Labels are a set,
 *     not a state machine, so every write is "add one, remove the others" and
 *     the binding has to say so or a ticket ends up carrying two states at once.
 *   - **No sprints.** A milestone is the closest thing. It is optional here:
 *     for a single-committer repo "open, and labelled ready" is the whole board,
 *     and inventing a sprint ceremony to match Jira's shape would be cargo cult.
 */

import type { TrackerBinding } from "./types.js";

export type GithubTrackerConfig = {
	/** "owner/repo". Passed to `gh` explicitly so a leased worktree's origin is never guessed. */
	repo: string;
	/**
	 * Milestone title standing in for the active sprint, or omitted when the repo
	 * does not use milestones — in which case the board is "open issues" and
	 * nothing is assigned.
	 */
	milestone?: string;
	/** Label marking an issue as screened and queueable. */
	readyLabel?: string;
};

/** Label per logical state. Values are the literal label names the agent writes. */
const STATE_LABELS: Record<string, string> = {
	"In Progress": "status:in-progress",
	Blocked: "status:blocked",
	Testing: "status:testing",
};

export function githubTracker({
	repo,
	milestone,
	readyLabel = "ready",
}: GithubTrackerConfig): TrackerBinding {
	const labelList = Object.values(STATE_LABELS)
		.map((label) => `\`${label}\``)
		.join(", ");

	const milestoneBlock = milestone
		? `**Putting it where it can be seen — the milestone.** This repo's board is
the \`${milestone}\` milestone:
\`gh issue edit <n> --repo ${repo} --milestone "${milestone}"\`. Assigning an
issue already on it is a no-op, so this is safe to repeat. If the milestone does
not exist, do **not** create one — log it and move on.`
		: `**There is no milestone on this repo**, so the board is simply the open
issues. Nothing to assign: apply the label and you are done. Do not create a
milestone to have somewhere to put it.`;

	return {
		ticketKeyShape: "#<number>",
		ticketExample: "#482",
		// `#` is legal in a git ref but hostile in a shell, so branches spell the
		// issue out. Kept in step with the branch rule in `trackerSync`.
		branchExample: "issue-482",
		branchGlob: "issue-*",
		// None. `gh` is a Bash allow-list entry, not a server to pre-flight.
		mcpServers: [],
		// Read, label, and (only when a milestone is configured) assign. `gh issue
		// create` and `gh issue close` are absent on purpose, not by oversight:
		// the prompt forbids both, and this is where that stops being prose.
		// `gh issue edit*` reads broader than it is: writeScope.ts refuses any
		// edit flag beyond labels and milestone, so `--title` and `--body` are
		// denied however the pattern matches.
		syncAllowedTools: [
			"Bash(gh issue view*)",
			"Bash(gh issue edit*)",
			"Bash(gh issue list*)",
			"Bash(gh label list*)",
			"Bash(gh label create*)",
		],
		// Exactly the commands `trackerQuery` names, all of them reads.
		queryAllowedTools: [
			"Bash(gh issue list*)",
			"Bash(gh issue view*)",
			"Bash(gh auth status*)",
		],
		// Labels and milestones live on github.com, not in the repo.
		syncWritesExternally: true,

		trackerSync: `
**Credentials.** None to read. \`gh\` is already authenticated in this
workspace — it is the same binary and the same token you use for
\`gh pr create\`. Never print the token and never run \`gh auth token\`.

**These moves are attributed to the account the \`gh\` token belongs to.** The
issue timeline will read as that person labelling the issue, so the PR link is
what tells a reader it was the agent — which is another reason the PR is posted
before this transition.

**State is a label, and labels are a set.** GitHub has no workflow states, so
the state you computed is written as exactly one of ${labelList}. Because a
label is not a transition, every write must add the one you want **and remove
the other two**, or an issue ends up claiming two states at once:

\`\`\`
gh issue view <n> --repo ${repo} --json state,labels,milestone
gh issue edit <n> --repo ${repo} --add-label "<the one>" --remove-label "<each other one the issue currently carries>"
\`\`\`

Read the issue first and pass \`--remove-label\` only for labels it actually
has. Skip the call entirely when it already carries the right label and neither
other one — that is what makes re-running a queue converge instead of writing
on every pass.

**Create the three labels once per run, not per order**, and only if missing:
\`gh label list --repo ${repo} --json name\`, then
\`gh label create "<name>" --repo ${repo} --color BFD4F2\` for each absent one.
\`gh label create\` fails on an existing label, so never call it blind.

${milestoneBlock}

**Never create an issue and never close one.** \`gh issue create\` and
\`gh issue close\` are not yours: you open draft PRs, and only a human closes an
issue once they have reviewed one. An issue you think should exist goes in the
report for a human to file. Do not edit an issue's title or body, and do not
comment on it — the PR is where the agent speaks.

**A note on keys.** A GitHub issue is \`#<number>\`, which is what
\`queue.jsonl\` carries in its \`ticket\` field. Do not put \`#\` in a branch
name: use \`issue-<number>-<kebab-slug>\` unless the project's conventions file
says otherwise.
`.trim(),

		trackerQuery: `
Use \`gh\`, and pass \`--repo ${repo}\` on every call so a leased worktree's
origin is never guessed. There is no MCP server to resolve and no token to read.

1. The board — candidates already screened and queueable:
   \`gh issue list --repo ${repo} --state open --label "${readyLabel}" --limit 60 --json number,title,body,labels,milestone,updatedAt\`${
		milestone
			? `
   Narrow it to the active board with \`--milestone "${milestone}"\`.`
			: ""
   }
2. Backlog sweep for the readiness audit in Step 6 — everything open, whether or
   not it is marked ready:
   \`gh issue list --repo ${repo} --state open --limit 60 --json number,title,body,labels,milestone,updatedAt\`
3. \`gh issue view <n> --repo ${repo} --json title,body,comments\` for every
   candidate that survives the cheap screen — you need the full description, the
   acceptance criteria, and the comment thread, because on GitHub the decision
   that unblocks a ticket is usually a comment rather than a field. A one-line
   issue with no acceptance criteria is a rejection, not a puzzle to solve.
4. If an issue links a spec, a wiki page, or another issue, read it
   (\`gh issue view\` for an issue; record an external link as unread and treat
   dependent detail as missing).

**GitHub has no priority field and no story points.** Do not invent an ordering
from label names that happen to sound urgent. Order by what the readiness screen
produces, and say in the report that priority was not available.

If \`gh\` is not authenticated (\`gh auth status\` fails), STOP — do not invent a
backlog from the repo.
`.trim(),
	};
}
