/**
 * Purpose: manifest overlay for the `/ai-smell-scan` command in example-repo.
 *
 * Registered as `invocable: "child"`, because this is not a scan: it is the
 * read-only per-batch worker that `scripts/ai-smell-runner.py` invokes once per
 * batch of files, sharing a daily budget, with the runner (not the agent)
 * appending to the report and filing Jira tickets over the REST API. Pressing
 * "Run" on this would scan one batch and tell you nothing about the codebase.
 *
 * The unit an operator actually wants is that runner, registered as a `harness`
 * whose run is a parent with one child per batch. That is Phase 2 work, and it
 * needs the script read first: its real argument surface, budget mechanism and
 * Jira behaviour are asserted by this agent's prompt but only verifiable in the
 * script itself.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "ai-smell-scan",
	name: "AI Smell Scan (batch worker)",
	description:
		"Read-only per-batch worker for scripts/ai-smell-runner.py. Scans only the files it is handed against docs/ai-smells.md and returns findings as JSON.",
	kind: "command",
	prompt: { kind: "repo", path: ".claude/commands/ai-smell-scan.md" },

	repos: ["example-repo"],
	// Child only: the harness owns the report file, the daily budget and the
	// ticket filing. Registering it direct would put the console one level below
	// the button anyone wants to press.
	invocable: "child",

	args: [
		{
			name: "jiraProjectKey",
			slot: "$1",
			type: "string",
			required: true,
			default: "PROJ",
			description: "Jira project key the runner files findings under.",
		},
		{
			name: "reportPath",
			slot: "$2",
			type: "string",
			required: true,
			description:
				"Path of the report the runner appends to. Read-only context for the agent: it never writes this file.",
		},
		{
			name: "batchFilePath",
			slot: "$3",
			type: "string",
			required: true,
			description: "Path to the newline-delimited list of the only in-scope files.",
		},
	],

	tools: {
		// The prompt asserts "You have no write tools". Nothing enforced that, so
		// this allow-list is where it becomes true. tsc is capped at one call per
		// invocation by the prompt; eslint is not, and knip must not be re-run
		// because reports/knip.json is read instead.
		allowedTools: ["Read", "Grep", "Glob", "Bash(npx tsc --noEmit)", "Bash(npx eslint*)"],
		permissionMode: "default",
	},
	writeScope: "read-only",
	scopeEnforcement: "manifest",
	execution: "unattended",

	artifactGlobs: [],
	statePaths: [
		{
			path: "docs/ai-smells.md",
			source: "repo",
			required: true,
			missingHint:
				"docs/ai-smells.md is the catalogue this agent scans against. Without it there is nothing to detect.",
		},
		{
			path: "reports/knip.json",
			source: "repo",
			required: false,
			missingHint:
				"No knip report in this checkout. The agent prefers reading it over re-running knip, and works without it.",
		},
	],

	// The runner extracts the LAST fenced json block from the final message.
	outcome: { kind: "json-block" },

	budget: { dailyCostCapUsd: 2, maxTurns: 20, maxWallClockMinutes: 12 },

	notes: [
		"Not runnable on its own by design. Register scripts/ai-smell-runner.py as a harness (Phase 2) to get a whole scan behind one button.",
		"Plugin-provided MCP servers do not load in the headless `claude -p` process, which is why this agent files nothing itself. Arnold's executor uses the SDK rather than the CLI, so MCP availability must be re-verified rather than assumed either way.",
		"Emits findings only. It must never emit a `tickets` key: the runner owns Jira.",
	],
};
