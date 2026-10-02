/**
 * Purpose: a `working-tree` agent for the throwaway `sandbox` repo, so the solo-mode
 * release of a held tier can be proven end to end through the console: dispatch,
 * the hold, the canary self-test, and a run inside the Docker sandbox that really
 * edits a file. It corrects one stale number in the README and runs no git commands.
 *
 * It carries no `disabled`: whether a working-tree agent may run is decided by the
 * environment (packages/core/src/hold.ts), not by the manifest.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "sandbox-readme-fix",
	name: "README fix (sandbox)",
	description:
		"Corrects the stale entry count in the sandbox README by editing it. Working-tree tier: it edits a file and runs no git commands.",
	kind: "command",
	prompt: { kind: "console", path: "prompts/sandbox-fix.md" },

	repos: ["sandbox"],
	invocable: "direct",

	args: [],

	tools: {
		allowedTools: ["Read", "Grep", "Glob", "Edit", "Bash(wc *)"],
		permissionMode: "default",
	},
	writeScope: "working-tree",
	scopeEnforcement: "manifest",
	execution: "unattended",

	artifactGlobs: [],
	statePaths: [
		{
			path: "README.md",
			source: "repo",
			required: true,
			missingHint: "README.md is the file this agent corrects.",
		},
	],

	outcome: { kind: "json-block" },
	reasonCodes: ["stale-counts", "none"],

	budget: { dailyCostCapUsd: 1, maxTurns: 12, maxWallClockMinutes: 5 },

	notes: ["Throwaway target. Safe to delete together with registry/sandbox/."],
};
