/**
 * Purpose: manifest overlay for the pr-loop-analyzer SUBAGENT in
 * example-repo — the second file behind the id collision that
 * `registry/example-repo/pr-loop-analyzer.ts` warns about.
 *
 * `.claude/commands/pr-loop-analyzer.md` and `.claude/agents/pr-loop-analyzer.md`
 * share a filename and diverge in behaviour. The command writes one report and
 * stops (`artifacts`). This one also files a Jira issue when a Jira mechanism is
 * reachable, and writes `.pr-loop/enhancements/<slug>.md` when it is not, which
 * puts it at `external-writes` — the widest scope registered.
 *
 * Registered under an explicit id rather than reconciled away, because the two
 * files are the target repo's to merge, not Arnold's. Until someone does, the id
 * that matches the filename belongs to the command (it is the one Phase 0 runs),
 * and this overlay exists so the subagent is VISIBLE rather than silently
 * shadowed: before this file, sync reported "unregistered: none" while an
 * external-writes prompt sat in the checkout undescribed.
 *
 * Held under the same Phase 3 rule as every other mutating agent.
 */

import type { AgentManifest } from "@arnold/core";
import { exampleRepoValues } from "./values.js";

export const manifest: AgentManifest = {
	id: "pr-loop-analyzer-subagent",
	name: "PR Loop Analyzer (subagent)",
	description:
		"Subagent form of the PR loop analyzer. Diagnoses non-convergence, writes a report, and additionally files a Jira issue or drafts .pr-loop/enhancements/<slug>.md. Wider write scope than the command of the same name.",
	kind: "subagent",
	prompt: { kind: "console", path: "prompts/pr-loop-analyzer-subagent.md" },

	repos: ["example-repo"],

	// Fills the {{...}} placeholders this prompt reads. Rendering fails if one is missing.
	values: {
		timezone: exampleRepoValues.timezone,
		trackerParentIssue: exampleRepoValues.trackerParentIssue,
		trackerProjectKey: exampleRepoValues.trackerProjectKey,
	},
	// Spawned by /fix-pr-comments at its round cap, not pressed by an operator.
	// Recorded as direct anyway so the disabled reason is what the UI prints:
	// "only runs as a child" would imply it is merely unreachable from here,
	// rather than deliberately held.
	invocable: "direct",

	disabled: {
		reason: "Held until Phase 3: files Jira issues and writes enhancement drafts, and the console has no auth or per-tier credentials yet.",
	},

	args: [
		{
			name: "prNumber",
			// Same literal-token convention as the command form: the body refers to
			// the PR as <PR>, not $1.
			slot: "<PR>",
			type: "number",
			required: true,
			description: "PR number whose .pr-loop round log should be analysed.",
		},
	],

	tools: {
		// The prompt file declares `tools: Read, Grep, Glob, Bash` with
		// unrestricted Bash and asserts report-only in prose. Narrowed here to the
		// reads it actually performs plus Write, whose location the write-scope
		// gate constrains to the globs below.
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
		deniedPaths: ["src/**", "docs/**", ".github/**", "package.json"],
	},
	writeScope: "external-writes",
	scopeEnforcement: "manifest",
	// It stops to ask when no Jira mechanism is reachable and the fallback draft
	// needs a home, and Phase 4 owns the answer path.
	execution: "needs-human",

	artifactGlobs: [".pr-loop/reports/PR-*.md", ".pr-loop/enhancements/*.md"],
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
	// Its own vocabulary, matching the command form's taxonomy. Kept as a separate
	// list rather than shared, per the rule that reason-code vocabularies stay per
	// agent even when two agents happen to agree today.
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
		"Shares a filename with the pr-loop-analyzer COMMAND but not its behaviour or write scope. Reconciling the two files in example-repo would let this overlay be deleted.",
		"Jira is reached through an Atlassian MCP tool or a jira/acli CLI, neither of which is granted here. Phase 3 decides how that credential is mounted.",
	],
};
