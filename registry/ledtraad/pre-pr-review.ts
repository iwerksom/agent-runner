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
	budget: { dailyCostCapUsd: 4, maxTurns: 40, maxWallClockMinutes: 25 },

	notes: [
		"Does not commit or push: no git write command is in the allow-list and the working-tree sandbox cannot write the mirror.",
		"Runs in the ledtraad sandbox layer: Python and the static CI job's dependencies, but no corpus (data/ is not in git) and no .venv, so the golden set and location tests are out of reach and must be reported as not run.",
		"Build the layer with pnpm sandbox:build before the first run.",
	],
};
