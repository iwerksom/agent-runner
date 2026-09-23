/**
 * Purpose: the Jira binding. This is the prose that used to live inside
 * `prompts/work-queue.md` and `prompts/plan-week.md`, lifted out unchanged
 * except for the parameters.
 *
 * Kept because it works and because the reference registry documents a real
 * Jira project — not because Jira is the default. `githubTracker` is the free
 * one, and `noTracker` is the honest answer for a single-committer repo.
 *
 * The one thing to preserve if this is ever rewritten: transitions are resolved
 * **by name**, never by id. Transition ids are per-board, so a hardcoded id is
 * a silent mis-transition the moment the agent is pointed at a second project.
 */

import type { TrackerBinding } from "./types.js";

export type JiraTrackerConfig = {
	/** e.g. "PROJ". Also the expected value of `JIRA_PROJECT_KEY`. */
	projectKey: string;
	/** The planning parent `plan-week` reads before judging a child under-specified. */
	parentIssue: string;
};

export function jiraTracker({ projectKey, parentIssue }: JiraTrackerConfig): TrackerBinding {
	return {
		ticketKeyShape: `${projectKey}-<number>`,
		ticketExample: `${projectKey}-1234`,
		branchExample: `${projectKey}-1234`,
		branchGlob: `${projectKey}-*`,
		mcpServers: ["atlassian"],
		// The REST calls in `trackerSync` need an HTTP client, and `work-queue`'s
		// allow-list has never had one. Broad as a pattern, because pinning it to a
		// host and header shape breaks the moment an argument is reordered — but
		// not broad as a grant: writeScope.ts counts any curl aimed off this
		// machine as an external write, so it is only usable by a manifest running
		// at `external-writes`, which `syncWritesExternally` below forces and which
		// takes an admin to trigger. An agent holding a Jira token and a curl is
		// still the residual risk, and the reason `githubTracker` needs no such grant.
		syncAllowedTools: ["Bash(curl -sS *)"],
		// The MCP tools `trackerQuery` names. Tool names are `mcp__<server>__<tool>`;
		// without them the planner's backlog read is denied at manifest enforcement.
		queryAllowedTools: [
			"mcp__atlassian__getAccessibleAtlassianResources",
			"mcp__atlassian__searchJiraIssuesUsingJql",
			"mcp__atlassian__getJiraIssue",
		],
		// Transitions and sprint moves are POSTs to Atlassian.
		syncWritesExternally: true,

		trackerSync: `
**Credentials.** Read the project's local env file (\`.env.local\`). Use
\`JIRA_EMAIL\` + \`JIRA_API_TOKEN\` — the host is \`JIRA_DOMAIN\` (stored with a
scheme; strip it), the board is \`JIRA_BOARD_ID\`, the project is
\`JIRA_PROJECT_KEY\`, which is expected to be \`${projectKey}\`. Basic
auth: \`Authorization: Basic base64(email:token)\`. The Atlassian MCP is **not**
an option here — it needs interactive OAuth and you run unattended. Never print
a token, and never write a credential into a PR body, a log line, or a park
file.

**These moves are attributed to the account whose token this is.** The Jira
history will read as that person moving the ticket, so the PR link is what
tells a reader it was the agent — which is another reason the PR is posted
before this transition.

**Resolve transitions by name, never by id.** \`GET
/rest/api/3/issue/<KEY>/transitions\`, then match \`to.name\` case-insensitively
against the state you computed and POST that transition's \`id\`:

\`\`\`
POST /rest/api/3/issue/<KEY>/transitions   {"transition":{"id":"<id>"}}
\`\`\`

Transition ids are per-board and differ between projects. A response of roughly
this shape — \`21 → In Progress\`, \`2 → Blocked\`, \`3 → Testing\`, \`31 → Done\`,
\`11 → To Do\` — is typical, and is a sanity check on what came back, never a
constant to hardcode. Confirm the issue types in \`${projectKey}\` carry
the statuses you need. If the name you need is absent from the response, do not
substitute a different one — log it and move on.

**Putting it where it can be seen — the active sprint.** Get it once per run:
\`GET /rest/agile/1.0/board/<JIRA_BOARD_ID>/sprint?state=active\` → take the
single \`values[]\` entry. Then
\`POST /rest/agile/1.0/sprint/<id>/issue  {"issues":["<KEY>"]}\`. Adding an issue
already in the sprint is a no-op, so this is safe to repeat. If more than one
active sprint comes back, do not choose — skip the sprint move and say so.

**Never create an issue and never transition anything to \`Done\`.** You open
draft PRs; only a human closes a ticket once they have reviewed one. A ticket
you think should exist goes in the report for a human to file.
`.trim(),

		trackerQuery: `
Use the issue-tracker MCP server's tools; resolve \`cloudId\` via
\`getAccessibleAtlassianResources\` first.

1. Active sprint:
   \`project = ${projectKey} AND sprint in openSprints() AND statusCategory != Done\`
   via \`searchJiraIssuesUsingJql\`. Read the Sprint customfield off a returned
   issue to learn the active sprint id.
2. Backlog sweep for the readiness audit in Step 6:
   \`project = ${projectKey} AND statusCategory != Done ORDER BY priority DESC, updated DESC\`,
   capped at ~60 issues.
3. \`getJiraIssue\` for every candidate that survives the cheap screen — you need
   the full description and acceptance criteria. A one-line ticket with no
   acceptance criteria is a rejection, not a puzzle to solve.
4. If a ticket links a spec or wiki page, read it (the wiki MCP tools if
   available; otherwise record the link as unread and treat dependent detail as
   missing). The planning parent for this project is
   \`${parentIssue}\` — read it and whatever breakdown page it links
   before judging any child ticket as under-specified.

If no issue-tracker MCP tool is reachable, STOP — do not invent a backlog from
the repo.
`.trim(),
	};
}
