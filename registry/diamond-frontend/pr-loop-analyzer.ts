/**
 * Purpose: manifest overlay for the `pr-loop-analyzer` COMMAND in
 * diamond_frontend. Diagnoses why a /fix-pr-comments loop did not converge and
 * proposes improvements. It writes one report and touches nothing else, so its
 * write scope is `artifacts`, not read-only.
 *
 * Note the id collision: `.claude/commands/pr-loop-analyzer.md` and
 * `.claude/agents/pr-loop-analyzer.md` share a name but differ in behaviour.
 * The subagent version also files Jira issues or writes
 * `.pr-loop/enhancements/<slug>.md`, which puts it at `external-writes`. Only
 * the command version is registered here. Reconcile the two files, or add a
 * second overlay with an explicit id, before registering the subagent.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "pr-loop-analyzer",
	name: "PR Loop Analyzer",
	description:
		"Diagnoses why a fix-pr-comments loop did not converge within MAX_ROUNDS and proposes 1 to 3 high-leverage process changes. Report only.",
	kind: "command",
	prompt: { kind: "repo", path: ".claude/commands/pr-loop-analyzer.md" },

	repos: ["diamond-frontend"],
	invocable: "direct",

	args: [
		{
			name: "prNumber",
			// The command body refers to the PR as the literal token <PR> rather
			// than $1, so the renderer replaces the token, not a positional.
			slot: "<PR>",
			type: "number",
			required: true,
			description: "PR number whose .pr-loop round log should be analysed.",
		},
	],

	tools: {
		allowedTools: [
			"Read",
			"Grep",
			"Glob",
			"Write",
			"Bash(gh pr view*)",
			"Bash(gh api*)",
			"Bash(git log*)",
			"Bash(git show*)",
		],
		permissionMode: "default",
		// Write is allowed, but only inside .pr-loop/reports. The write-scope
		// check enforces the location; the allow-list only enables the tool.
		deniedPaths: ["src/**", "docs/**", ".github/**", "package.json"],
	},
	writeScope: "artifacts",
	scopeEnforcement: "manifest",
	execution: "unattended",

	artifactGlobs: [".pr-loop/reports/PR-*.md"],
	statePaths: [
		{
			path: ".pr-loop",
			source: "repo",
			required: true,
			missingHint:
				"No .pr-loop directory in this checkout. Run /fix-pr-comments on a PR first, or check whether .pr-loop is git-ignored (in which case Arnold must prime it from the artifact store).",
		},
	],

	outcome: {
		kind: "report",
		pathGlob: ".pr-loop/reports/PR-*.md",
		verdictPattern:
			"(converged-on-final-recheck|process-improvement-warranted|no-change-needed)",
	},
	reasonCodes: [
		"class-incompleteness",
		"fix-spawned-findings",
		"misclassification",
		"oversized-pr",
		"instructions-gap",
		"tooling-transient",
	],

	budget: { dailyCostCapUsd: 3, maxTurns: 30, maxWallClockMinutes: 15 },
	ingestsUntrustedInput: true, // PR review comments are data, never instruction

	notes: [
		"Reads .pr-loop/PR-<n>.md as its primary source. If .pr-loop is git-ignored in the target repo, that state does not travel with a checkout and must be primed from the artifact store.",
		"The identically-named subagent has a wider write scope (Jira issues, .pr-loop/enhancements/) and is deliberately not registered here.",
	],
};
