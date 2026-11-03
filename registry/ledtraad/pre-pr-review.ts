/**
 * Purpose: binding for `pre-pr-review` against ledtraad (ROADMAP feature 3.1).
 *
 * Same prompt as `registry/example-repo/pre-pr-review.ts`; the prompt says to use
 * "the commands the conventions file defines", so only the allow-list differs.
 * ledtraad is Python: its static CI job (`.github/workflows/checks.yml`) is the
 * verification chain, and the allow-list names those commands and nothing else.
 *
 * They run in the ledtraad sandbox layer (`sandbox/images/ledtraad.Dockerfile`),
 * which has Python and the CI job's light dependencies but not the corpus under
 * `data/` (not in git) or the pipeline stack. So the golden set and the location
 * tests cannot run here, and the agent must say so instead of claiming them.
 *
 * `working-tree`, like the reference manifest: it edits files and never commits.
 * The id is `ledtraad-pre-pr-review` because `Agent.id` is global (#16).
 *
 * Cost (#75). The first run on `feat/bm25s-42`, a two-file 40-line diff, cost
 * $2.61 in 47 turns on the default model: 21 Bash and 15 Read calls just to find
 * the diff, the conventions and the CI commands, 27k of 38k output tokens spent
 * thinking, and two subagents each starting a fresh context. So:
 *   - `prepare` hands it the diff, the review-instructions file and the output of
 *     every CI check, computed before the model starts. CLAUDE.md is not inlined:
 *     `settingSources: ["project"]` already loads it into the system prompt.
 *   - `model: "sonnet"` and `effort: "medium"`. The one finding that must not be
 *     missed (the pyflakes failure) now arrives as check output, not as something
 *     the model has to think its way to.
 *   - No subagents, and `maxTurns` 30 instead of 40. A first re-run at 20 spent its turns on
 *     tool discovery, venv reading and compound Bash the gate refuses, and hit the cap
 *     before the summary ($0.52, failed). The cap is for stopping a runaway, not for
 *     squeezing cost; the prompt tells the agent not to redo what the context shows.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "ledtraad-pre-pr-review",
	name: "Pre-PR Review (ledtraad)",
	description:
		"Reviews the branch diff against ledtraad's conventions, fixes the substantive issues in the working tree and runs its static checks. Never commits or pushes.",
	kind: "command",
	prompt: { kind: "console", path: "prompts/pre-pr-review.md" },

	repos: ["ledtraad"],
	values: { defaultBranch: "main" },
	invocable: "direct",

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
		// The CI job's commands (checks.yml), spelled exactly so a wildcard cannot
		// widen them into running an arbitrary script. No `pip`, no `python -c`:
		// the image already has the dependencies, and an interpreter one-liner can
		// write anywhere the worktree allows.
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
			"Bash(python -m compileall -q scripts tests .github)",
			"Bash(python tests/test_reports.py)",
			"Bash(python tests/test_query_stream.py)",
			"Bash(python .github/validate_json.py)",
			"Bash(pyflakes scripts tests .github)",
			"Bash(bash -n scripts/deploy_data.sh)",
		],
		permissionMode: "default",
		// A review is one context. A subagent starts a fresh one and re-reads the repo.
		disallowedTools: ["Agent", "Task"],
	},
	model: "sonnet",
	effort: "medium",
	// The same commands as the allow-list, run by Arnold before the model starts.
	// The allow-list keeps them, so the agent can re-run one after an edit.
	prepare: {
		diff: { baseArg: "baseBranch" },
		files: [".github/copilot-instructions.md"],
		checks: [
			{ name: "pyflakes", command: ["pyflakes", "scripts", "tests", ".github"] },
			{
				name: "compileall",
				command: ["python", "-m", "compileall", "-q", "scripts", "tests", ".github"],
			},
			{ name: "test_reports", command: ["python", "tests/test_reports.py"] },
			{ name: "test_query_stream", command: ["python", "tests/test_query_stream.py"] },
			{ name: "validate_json", command: ["python", ".github/validate_json.py"] },
			{ name: "deploy_data.sh syntax", command: ["bash", "-n", "scripts/deploy_data.sh"] },
		],
	},
	writeScope: "working-tree",
	scopeEnforcement: "manifest",
	execution: "unattended",

	artifactGlobs: [],
	statePaths: [
		{
			path: "CLAUDE.md",
			source: "repo",
			required: true,
			missingHint:
				"ledtraad's conventions file. The review applies every rule it states and takes the verification commands from it.",
		},
		{
			path: ".github/copilot-instructions.md",
			source: "repo",
			required: false,
			missingHint:
				"No copilot-instructions.md in this checkout. The review still runs, but it loses the bar it is meant to review against.",
		},
	],

	reasonCodes: [],
	budget: { dailyCostCapUsd: 4, maxTurns: 30, maxWallClockMinutes: 25 },

	notes: [
		"Does not commit or push: no git write command is in the allow-list and the working-tree sandbox cannot write the mirror.",
		"Runs in the ledtraad sandbox layer: Python and the static CI job's dependencies, but no corpus (data/ is not in git) and no .venv, so the golden set and location tests are out of reach and must be reported as not run.",
		"Build the layer with pnpm sandbox:build before the first run.",
		"Runs on sonnet at medium effort with the diff and CI check output precomputed (#75). The checks run on the unmodified branch before the model starts.",
	],
};
