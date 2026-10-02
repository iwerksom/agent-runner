/**
 * Purpose: manifest overlay for the `/work-queue` command in example-repo.
 * Executes queued work orders unattended: branch, implement, verify, commit,
 * push, open a draft PR, then move to the next.
 *
 * This is the reference `draft-pr` agent — at `external-writes` when its tracker
 * binding keeps a board outside the repo, since moving a ticket is an external
 * write. Two things about it are worth holding on to:
 *
 *   - It needs `mainBookkeeping` as well as its tier. It commits `.week-plan/`
 *     state to the default branch both before the first order and before
 *     stopping, so a flat "the deploy key cannot push to main" rule would make
 *     it unrunnable. The guarded-push helper is what keeps that honest.
 *   - Its prompt guardrails are reproduced in the allow-list below rather than
 *     trusted as prose. `git push --force`, `gh pr merge` and `gh pr ready` are
 *     absent on purpose, not by oversight.
 *
 * WARNING for the phase this is registered in: role gating is Phase 8 and does
 * not exist yet. Anyone who can reach the console can start this, and it pushes
 * branches and opens PRs against the real remote.
 */

import type { AgentManifest } from "@arnold/core";
import { exampleRepoTracker, exampleRepoValues } from "./values.js";

export const manifest: AgentManifest = {
	id: "work-queue",
	name: "Work Queue",
	description:
		"Executes queued work orders unattended: branch off origin/main, implement, verify, commit, push, open a draft PR. Parks anything ambiguous instead of guessing.",
	kind: "command",
	prompt: { kind: "console", path: "prompts/work-queue.md" },

	repos: ["example-repo"],

	// Fills the {{...}} placeholders this prompt reads. Rendering fails if one is missing.
	// `trackerSync` replaced `trackerProjectKey` here: the prompt no longer names a
	// tracker at all, so the whole Atlassian mechanic arrives as one block from the
	// binding. Point this at githubTracker or noTracker and nothing else changes.
	values: {
		defaultBranch: exampleRepoValues.defaultBranch,
		timezone: exampleRepoValues.timezone,
		trackerSync: exampleRepoTracker.trackerSync,
	},
	invocable: "direct",

	// No `disabled` here: the hold is computed from the environment (hold.ts). At
	// `draft-pr` solo mode with the Docker sandbox releases it; with a tracker that
	// writes externally the scope is `external-writes`, which has no sandbox profile
	// yet and stays held. This one branches, commits, pushes and opens a draft PR,
	// and it also holds mainBookkeeping; the leased worktree carries the target
	// repo's own .claude/settings.local.json, which pre-approves `git push` and
	// `gh pr` outright, so nothing but the sandbox stands between the button and a push.

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
			// Whatever this repo's tracker binding needs to keep the board in step.
			// Jira contributes an HTTP client here; GitHub contributes `gh issue`
			// and `gh label`; a no-tracker repo contributes nothing at all.
			...exampleRepoTracker.syncAllowedTools,
		],
		// Guardrails from the prompt, made structural. The global denials in
		// GLOBAL_DENIED_WRITE_GLOBS already cover .claude/, .env* and CI config.
		deniedPaths: ["docs/**"],
		permissionMode: "default",
	},
	// A board update is an external write, refused below external-writes, so a
	// binding that syncs off-repo lifts this agent to that scope (and to an admin
	// to trigger it). With noTracker the board is queue.jsonl and draft-pr is
	// enough.
	writeScope: exampleRepoTracker.syncWritesExternally ? "external-writes" : "draft-pr",
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
		"Registered before role gating (Phase 8), so nothing gates who can start it. It pushes branches and opens draft PRs against the real remote.",
		"Never force-pushes, never changes a PR base, never marks ready for review, never merges, never runs /fix-pr-comments. Those commands are absent from the allow-list, not merely discouraged.",
		"Needs mainBookkeeping for its .week-plan/ commits; the guarded-push helper must validate the staged diff against those globs before the push is allowed.",
		"Turns ambiguity into a park, never a question: it is written for the case where nobody is watching.",
	],
};
