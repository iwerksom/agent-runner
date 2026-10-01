/**
 * Purpose: binding for `/doc-drift` against `sandbox`, a throwaway local repo
 * used to prove a run end to end without pointing Arnold at a real project.
 *
 * Same prompt as `registry/ledtraad/doc-drift.ts` — only the values differ,
 * which is the definition/binding split doing what it says. The sandbox README
 * carries three deliberate drifts (an entry count, a missing script, a section
 * reference), so a correct run has something to find.
 *
 * The id is `sandbox-doc-drift`, not `doc-drift`: `Agent.id` is global, so a
 * second binding under the same id would overwrite ledtraad's row on sync.
 */

import type { AgentManifest } from "@arnold/core";

const measurements = `
| Claim family | Where it is written | Command that settles it |
|---|---|---|
| Entry count | README counts table | \`wc -l < data/entries.txt\` |
| Script count, and every \`scripts/*.sh\` named in prose | README | \`ls scripts/\` |
| Section references ("docs/SETUP.md §2") | README | \`grep -n '^## ' docs/SETUP.md\` |
`.trim();

const measurementNotes = `
- **Count with the shell.** \`wc\`, \`ls\` and \`grep\` are the instruments; no
  interpreter is on the allow-list, and none is needed.
- **Never run anything under \`scripts/\`.** Read it if you must; do not execute it.
`.trim();

export const manifest: AgentManifest = {
	id: "sandbox-doc-drift",
	name: "Doc Drift (sandbox)",
	description:
		"Re-measures the counts and references in the sandbox README against the repo and reports which have gone stale. Read-only.",
	kind: "command",
	prompt: { kind: "console", path: "prompts/doc-drift.md" },

	repos: ["sandbox"],
	invocable: "direct",

	values: {
		docFiles: "`README.md`",
		measurements,
		measurementNotes,
	},

	args: [
		{
			name: "docs",
			slot: "--docs=",
			type: "string",
			required: false,
			description: "Comma-separated subset of documents to audit. Default: README.md.",
		},
		{
			name: "maxFindings",
			slot: "--max-findings=",
			type: "number",
			required: false,
			default: "10",
			description: "Stop after this many findings and say so.",
		},
	],

	tools: {
		allowedTools: ["Read", "Grep", "Glob", "Bash(wc *)", "Bash(ls *)", "Bash(grep *)"],
		permissionMode: "default",
	},
	writeScope: "read-only",
	scopeEnforcement: "manifest",
	execution: "unattended",

	artifactGlobs: [],
	statePaths: [
		{
			path: "README.md",
			source: "repo",
			required: true,
			missingHint: "README.md is the document this agent audits.",
		},
	],

	outcome: { kind: "json-block" },
	reasonCodes: [
		"stale-counts",
		"missing-path",
		"broken-crossref",
		"stale-command",
		"stale-status",
		"mixed",
		"none",
	],

	// Small on purpose: one short README. A run that needs more is wandering.
	budget: { dailyCostCapUsd: 2, maxTurns: 25, maxWallClockMinutes: 10 },

	notes: ["Throwaway target. Safe to delete together with registry/sandbox/."],
};
