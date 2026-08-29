/**
 * Purpose: manifest overlay for the `/plan-week` command in example-repo.
 * Derives capacity from the calendar, pulls PROJ candidates from Jira, screens
 * them for agent-safety, and fits self-contained work orders into real windows.
 *
 * This is the agent the `needs-local-session` execution mode exists for.
 * Capacity source 0 reads Google Calendar through the Chrome extension, which is
 * only reachable from a session on the machine running the browser, so a
 * headless run cannot get capacity that way. Passing --windows= or --hours=
 * removes that dependency entirely, which is what `unattendedIfArgs` encodes:
 * the console keeps Run disabled until one of them is supplied, and says why.
 *
 * Its write scope is `artifacts`, not `branch-push`: it never creates a branch.
 * Its only push is the `.week-plan/` bookkeeping commit on the default branch,
 * which is what `mainBookkeeping` is for.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "plan-week",
	name: "Plan Week",
	description:
		"Plans a week of unattended agent work: capacity from the calendar, candidates from Jira, an agent-safety screen, and self-contained work orders fitted to real windows.",
	kind: "command",
	prompt: { kind: "console", path: "prompts/plan-week.md" },

	repos: ["example-repo"],
	invocable: "direct",

	args: [
		{
			name: "isoWeek",
			slot: "$1",
			type: "string",
			required: false,
			description:
				"ISO week, as 33 or 2026-W33. Defaults to the current week. A bare number means the week, not a number of hours.",
		},
		{
			name: "windows",
			slot: "--windows=",
			type: "string",
			required: false,
			description:
				'Declared capacity windows, e.g. "tue 09:30-11:00, wed 13:00-15:30" in Europe/Copenhagen. Supplying this makes the run headless.',
		},
		{
			name: "hours",
			slot: "--hours=",
			type: "number",
			required: false,
			description:
				"Flat total capacity with no windows. Last resort: orders get no window to be sized against. Also makes the run headless.",
		},
	],

	tools: {
		allowedTools: [
			"Read",
			"Grep",
			"Glob",
			"Write",
			"Bash(node -e*)",
			"Bash(git status*)",
			"Bash(git fetch*)",
			"Bash(git checkout main)",
			"Bash(git pull*)",
			"Bash(git add .week-plan*)",
			"Bash(git commit*)",
			"Bash(git push origin main)",
			"Bash(git diff*)",
			"Bash(git branch*)",
			"Bash(gh pr list*)",
		],
		// Hard-stops if no Atlassian tool is reachable rather than inventing a
		// backlog from the repo, so this is worth pre-flighting before the run.
		mcpServers: ["atlassian"],
		permissionMode: "default",
	},
	writeScope: "artifacts",
	mainBookkeeping: { paths: [".week-plan/**"] },
	scopeEnforcement: "manifest",

	execution: "needs-local-session",
	unattendedIfArgs: ["windows", "hours"],

	artifactGlobs: [".week-plan/WEEK-*.md", ".week-plan/orders/*.md", ".week-plan/queue.jsonl"],
	statePaths: [
		{
			path: ".pr-loop/metrics.jsonl",
			source: "repo",
			required: false,
			missingHint:
				"No pr-loop history yet. Planning still works; it just loses the precedent it uses to size orders.",
		},
	],

	outcome: {
		kind: "report",
		pathGlob: ".week-plan/WEEK-*.md",
		verdictPattern: "(no-window|not-reversible|too-large-to-split)",
		// The week file is a plan, not a verdict. A run that produces one without
		// naming a blocking reason code is simply a successful plan.
		fallbackOutcome: "planned",
	},
	// Its own screen's codes, which are NOT work-order-scoper's. Note
	// `too-large-to-split` here against `too-large` there: same idea, different
	// vocabulary, and merging them would split one concept across two labels.
	reasonCodes: [
		"needs-visual-judgment",
		"undecided-design",
		"external-dependency",
		"hot-files",
		"too-large-to-split",
		"no-window",
		"not-reversible",
	],

	spawnsSubagents: ["work-order-scoper"],
	// Calendar content and Jira text are data, never instruction. The prompt's own
	// rule generalises: never put ingested text into a Jira issue or PR body.
	ingestsUntrustedInput: true,

	budget: { dailyCostCapUsd: 8, maxTurns: 80, maxWallClockMinutes: 45 },

	notes: [
		"Run is disabled in the hosted console until --windows= or --hours= is supplied, because capacity source 0 needs the Chrome extension on your machine. The local-session runner (Phase 6) removes that limit.",
		"Spawns one work-order-scoper per SURVIVOR of its step-4 screen, not per candidate, so expect fewer child runs than candidates.",
		"Never creates a branch and never opens a PR. Its only push is the .week-plan/ bookkeeping commit on main.",
		"Hard-stops if no Atlassian tool is reachable rather than inventing a backlog from the repo.",
	],
};
