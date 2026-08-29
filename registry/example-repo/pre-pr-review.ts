/**
 * Purpose: manifest overlay for the `/pre-pr-review` command in example-repo.
 * Reviews the current branch's diff as Copilot would and fixes the substantive
 * findings before a PR is opened.
 *
 * The first agent registered here that changes code. Its ceiling is
 * `working-tree`: the prompt is explicit that it does not push or open the PR
 * unless asked, so the executor must not mount a push credential for it. In a
 * leased worktree that makes it about as safe as a mutating agent gets, since
 * the edits live and die with a disposable checkout.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "pre-pr-review",
	name: "Pre-PR Review",
	description:
		"Reviews the branch diff against the repo's conventions and adversarial checklist, fixes the substantive issues in the working tree, and leaves the branch ready. Never pushes.",
	kind: "command",
	prompt: { kind: "repo", path: ".claude/commands/pre-pr-review.md" },

	repos: ["example-repo"],
	invocable: "direct",

	// Phase 4 registers the mutating agents; Phase 3 is what makes them safe to
	// press. Until roles gate triggering and credentials are mounted per tier,
	// this writes to a real working tree from a console with no auth. The leased
	// worktree also carries the target repo's own .claude/settings.local.json,
	// which pre-approves git write commands, so "working-tree" is narrower in the
	// manifest than in the environment the run actually gets.
	disabled: {
		reason: "Held until Phase 3: it writes to the working tree, and the console has no auth or per-tier credentials yet.",
	},

	args: [
		{
			name: "baseBranch",
			slot: "${1:-main}",
			type: "string",
			required: false,
			default: "main",
			description: "Branch to diff against. The prompt itself defaults to main.",
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
			"Bash(git fetch*)",
			"Bash(git diff*)",
			"Bash(git status)",
			"Bash(git log*)",
			"Bash(npx tsc --noEmit)",
			"Bash(npx vitest run*)",
			"Bash(npx eslint*)",
			"Bash(npx prettier*)",
			"Bash(npm run knip:production)",
		],
		permissionMode: "default",
	},
	// No git write commands in the allow-list, so the ceiling is enforced twice:
	// the tool policy refuses the command and the executor mounts no credential.
	writeScope: "working-tree",
	scopeEnforcement: "manifest",
	execution: "unattended",

	// It writes no files of its own; the value is the diff it leaves behind and
	// the printed summary of what it deliberately did not change.
	artifactGlobs: [],
	statePaths: [
		{
			path: ".github/copilot-instructions.md",
			source: "repo",
			required: false,
			missingHint:
				"No copilot-instructions.md in this checkout. The review still runs, but it loses the bar it is meant to review against.",
		},
	],

	// The prompt ends with a summary rather than a structured record, so there is
	// nothing to chart yet. Give it a JSONL line in the prompt if that changes.
	reasonCodes: [],

	budget: { dailyCostCapUsd: 4, maxTurns: 40, maxWallClockMinutes: 25 },

	notes: [
		"Does not push or open the PR. That is the prompt's rule and the manifest's: no git write command is in the allow-list.",
		"Runs the full verification chain (tsc, vitest, eslint, prettier, knip:production), so give it wall-clock room.",
		"Produces no artifact and no structured outcome, so it will show a transcript and a cost but nothing to chart.",
	],
};
