/**
 * Purpose: an `artifacts`-tier agent for the throwaway `sandbox` repo, so the
 * Docker sandbox (ROADMAP feature 2.1) can be proven end to end at the one tier
 * whose profile mounts a writable directory. It reads the README and writes one
 * file under `reports/`; nothing else may change.
 *
 * Its glob names a directory (`reports/`) on purpose: the sandbox mounts only that
 * directory writable and refuses a glob at the workspace root.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "sandbox-readme-report",
	name: "README report (sandbox)",
	description:
		"Summarises the sandbox README's sections into reports/readme-summary.md. Artifacts tier: its only write is that one file.",
	kind: "command",
	prompt: { kind: "console", path: "prompts/sandbox-report.md" },

	repos: ["sandbox"],
	invocable: "direct",

	args: [],

	tools: {
		allowedTools: ["Read", "Grep", "Glob", "Write"],
		permissionMode: "default",
	},
	writeScope: "artifacts",
	scopeEnforcement: "manifest",
	execution: "unattended",

	artifactGlobs: ["reports/*.md"],
	statePaths: [
		{
			path: "README.md",
			source: "repo",
			required: true,
			missingHint: "README.md is the document this agent summarises.",
		},
	],

	outcome: { kind: "json-block" },
	reasonCodes: ["none", "no-readme"],

	budget: { dailyCostCapUsd: 1, maxTurns: 12, maxWallClockMinutes: 5 },

	notes: ["Throwaway target. Safe to delete together with registry/sandbox/."],
};
