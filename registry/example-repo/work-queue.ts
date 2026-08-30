/**
 * Purpose: manifest overlay for the `/work-queue` command in example-repo.
 * Executes queued work orders unattended: branch, implement, verify, commit,
 * push, open a draft PR, then move to the next.
 *
 * This is the reference `draft-pr` agent and the most privileged thing Arnold
 * can run without reaching outside the repo. Two things about it are worth
 * holding on to:
 *
 *   - It needs `mainBookkeeping` as well as its tier. It commits `.week-plan/`
 *     state to the default branch both before the first order and before
 *     stopping, so a flat "the deploy key cannot push to main" rule would make
 *     it unrunnable. The guarded-push helper is what keeps that honest.
 *   - Its prompt guardrails are reproduced in the allow-list below rather than
 *     trusted as prose. `git push --force`, `gh pr merge` and `gh pr ready` are
 *     absent on purpose, not by oversight.
 *
 * WARNING for the phase this is registered in: role gating is Phase 3 and does
 * not exist yet. Anyone who can reach the console can start this, and it pushes
 * branches and opens PRs against the real remote.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "work-queue",
	name: "Work Queue",
	description:
		"Executes queued work orders unattended: branch off origin/main, implement, verify, commit, push, open a draft PR. Parks anything ambiguous instead of guessing.",
	kind: "command",
	prompt: { kind: "console", path: "prompts/work-queue.md" },

	repos: ["example-repo"],
	invocable: "direct",

	// Phase 4 registers the mutating agents; Phase 3 is what makes them safe to
	// press. This one branches, commits, pushes and opens a draft PR, and it also
	// holds mainBookkeeping. The leased worktree carries the target repo's own
	// .claude/settings.local.json, which pre-approves `git push` and `gh pr`
	// outright, so nothing but this hold stands between the button and a push.
	disabled: {
		reason: "Held until Phase 3: it pushes branches and opens PRs, and the console has no auth or per-tier credentials yet.",
	},

	args: [
		{
			name: "runwayMinutes",
			slot: "${1:-120}",
			type: "number",
			required: false,
			default: "120",
			description:
				"Minutes of runway. It stops when this is spent, when no ready order fits the time left, or after three consecutive parks.",
		},
		{
			name: "startFromWorkOrder",
			slot: "$2",
			type: "string",
			required: false,
			description:
				"WO id to start from, e.g. WO-3. Defaults to the first ready order in the queue.",
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
			"Bash(git status*)",
			"Bash(git fetch*)",
			"Bash(git checkout*)",
			"Bash(git add*)",
			"Bash(git commit*)",
			"Bash(git push origin*)",
			"Bash(git diff*)",
			"Bash(git log*)",
			"Bash(gh pr create --draft*)",
			"Bash(gh pr list*)",
			"Bash(gh pr view*)",
			"Bash(npx tsc --noEmit)",
			"Bash(npx vitest run*)",
			"Bash(npx eslint*)",
			"Bash(npm run knip:production)",
		],
		// Guardrails from the prompt, made structural. The global denials in
		// GLOBAL_DENIED_WRITE_GLOBS already cover .claude/, .env* and CI config.
		deniedPaths: ["docs/**"],
		permissionMode: "default",
	},
	writeScope: "draft-pr",
	mainBookkeeping: { paths: [".week-plan/**"] },
	scopeEnforcement: "manifest",
	execution: "unattended",

	artifactGlobs: [".week-plan/log.jsonl", ".week-plan/queue.jsonl", ".week-plan/parked/*.md"],
	statePaths: [
		{
			path: ".week-plan/queue.jsonl",
			source: "repo",
			required: true,
			missingHint:
				"No .week-plan/queue.jsonl in this checkout. Run /plan-week first: this agent only ever works on orders that are already queued.",
		},
	],

	outcome: {
		kind: "jsonl",
		path: ".week-plan/log.jsonl",
		outcomeKey: "outcome",
		reasonKey: "reason",
	},
	reasonCodes: ["stale-premise", "branch-exists", "needs-decision", "verification-failed"],

	budget: { dailyCostCapUsd: 15, maxTurns: 200, maxWallClockMinutes: 150 },

	notes: [
		"Registered before Phase 3, so nothing gates who can start it. It pushes branches and opens draft PRs against the real remote.",
		"Never force-pushes, never changes a PR base, never marks ready for review, never merges, never runs /fix-pr-comments. Those commands are absent from the allow-list, not merely discouraged.",
		"Needs mainBookkeeping for its .week-plan/ commits; the guarded-push helper must validate the staged diff against those globs before the push is allowed.",
		"Turns ambiguity into a park, never a question: it is written for the case where nobody is watching.",
	],
};
