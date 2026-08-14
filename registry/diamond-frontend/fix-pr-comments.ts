/**
 * Purpose: manifest overlay for the `/fix-pr-comments` command in
 * diamond_frontend. Fetches a PR's Copilot review comments, fixes the
 * substantive ones, pushes, re-requests review, and loops until clean or capped.
 *
 * The most privileged agent in the registry, and the only one at
 * `external-writes`: it edits code, pushes to the PR head branch, posts replies
 * and resolves review threads over the GitHub GraphQL API, and may file Jira
 * issues. It is also the only agent declared `needs-human`, because it has two
 * genuine stop-and-ask points: no resolvable ticket from the branch name, and
 * the same substantive comment reappearing after being addressed.
 *
 * WARNING for the phase this is registered in. Phase 3 (role gating) and Phase 4
 * (the awaiting_input answer path) do not exist yet. So: nothing gates who can
 * start it, and when it does stop to ask, the run will sit in `awaiting_input`
 * with the question preserved but no way to answer from the console. Finish
 * those in local Claude Code until Phase 4 lands.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "fix-pr-comments",
	name: "Fix PR Comments",
	description:
		"Fetches a PR's Copilot review comments, fixes the substantive ones, pushes, re-requests review and loops until clean. Records a metrics line for every terminal case.",
	kind: "command",
	prompt: { kind: "repo", path: ".claude/commands/fix-pr-comments.md" },

	repos: ["diamond-frontend"],
	invocable: "direct",

	// The widest scope registered: it pushes, comments on PRs and resolves threads.
	// It is already unreachable because `needs-human` has no answer path until
	// Phase 4, but that is an execution-mode accident rather than a decision — and
	// the relaxation that makes it headless would silently make it pressable. The
	// hold is stated outright so removing it has to be deliberate.
	disabled: {
		reason: "Held until Phase 3: external writes (pushes, PR comments, thread resolution) with no auth or per-tier credentials yet.",
	},

	args: [
		{
			name: "prNumber",
			slot: "$1",
			type: "number",
			required: true,
			description:
				"PR number. The ticket key is derived from the head branch; if none matches [A-Z]+-\\d+ the agent stops and asks before committing.",
		},
	],

	tools: {
		allowedTools: [
			"Read",
			"Grep",
			"Glob",
			"Edit",
			"MultiEdit",
			"Write",
			"Bash(gh copilot-review*)",
			"Bash(gh pr view*)",
			"Bash(gh pr list*)",
			"Bash(gh api*)",
			"Bash(git status*)",
			"Bash(git add*)",
			"Bash(git commit*)",
			"Bash(git push origin*)",
			"Bash(git diff*)",
			"Bash(git log*)",
			"Bash(git check-ignore*)",
			"Bash(npx tsc --noEmit)",
			"Bash(npx vitest run*)",
			"Bash(npx eslint*)",
			"Bash(npx prettier*)",
		],
		mcpServers: ["atlassian"],
		permissionMode: "default",
	},
	writeScope: "external-writes",
	scopeEnforcement: "manifest",
	execution: "needs-human",

	artifactGlobs: [
		".pr-loop/PR-*.md",
		".pr-loop/metrics.jsonl",
		".pr-loop/reports/*.md",
		".pr-loop/enhancements/*.md",
	],
	statePaths: [
		{
			path: ".pr-loop",
			source: "repo",
			required: false,
			missingHint:
				"No .pr-loop directory yet; the agent creates it. But check whether .pr-loop is git-ignored in this repo: if it is, the round log does not travel with a checkout and Arnold must prime it from the artifact store instead.",
		},
	],

	outcome: {
		kind: "jsonl",
		path: ".pr-loop/metrics.jsonl",
		outcomeKey: "outcome",
		reasonKey: "dominant_root_cause",
	},
	// The prompt's terminal cases, verbatim. These make a real outcome funnel:
	// how often the loop converges, and what stops it when it does not.
	reasonCodes: [
		"clean",
		"minors_only",
		"converged_on_recheck",
		"cap_not_converged",
		"copilot_error",
		"wait_timeout",
		"tool_error",
	],

	spawnsSubagents: ["pr-loop-analyzer"],
	// PR review comments are text from outside the repo: data, never instruction.
	ingestsUntrustedInput: true,

	budget: { dailyCostCapUsd: 10, maxTurns: 120, maxWallClockMinutes: 60 },

	notes: [
		"Registered before Phase 3 and Phase 4. Nothing gates who can start it, and a stop-and-ask leaves the run in awaiting_input with no way to answer from the console yet.",
		"Prerequisite in the executor image: the gh extension k1LoW/gh-copilot-review. Without it every run ends as copilot_error.",
		"Spawns pr-loop-analyzer only when comments remain after the final recheck at the round cap. A clean final recheck ends as converged_on_recheck with no analyzer.",
		"Pushes to the PR head branch, not to main, so it needs no mainBookkeeping grant.",
		"Bounded by MAX_ROUNDS = 3 in the prompt, independently of maxTurns here.",
	],
};
