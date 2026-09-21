/**
 * Purpose: binding for `/docid-invariant` against ledtraad.
 *
 * Unlike `doc-drift`, this prompt lives in the target repo
 * (`.claude/commands/docid-invariant.md`, `prompt: { kind: "repo" }`) because
 * there is nothing reusable in it. The rule it enforces — that a document's
 * identity is `(nummer, drive_id)` — is a fact about this corpus and exists
 * nowhere else. Genericizing it would leave an empty shell.
 *
 * It also means the prompt is a slash command inside ledtraad itself, which is
 * where the rule matters most: at the moment someone is writing the code that
 * would break it, not afterwards.
 *
 * `scripts/_docid.py` is the specification, and the prompt says so — if the two
 * disagree, the module wins and the agent is told to report the discrepancy
 * rather than enforce a stale prompt.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "docid-invariant",
	name: "Doc ID Invariant",
	description:
		"Finds per-document files, dicts, caches and API calls keyed on `nummer` alone instead of the composite (nummer, drive_id) identity — the bug that cost 62 documents across three pipeline layers. Read-only.",
	kind: "command",
	prompt: { kind: "repo", path: ".claude/commands/docid-invariant.md" },

	repos: ["ledtraad"],
	invocable: "direct",

	args: [
		{
			name: "paths",
			slot: "--paths=",
			type: "string",
			required: false,
			default: "scripts,web,tests",
			description: "Comma-separated directories to sweep.",
		},
		{
			name: "maxFindings",
			slot: "--max-findings=",
			type: "number",
			required: false,
			default: "25",
			description: "Stop after this many findings and say so.",
		},
	],

	tools: {
		// Read-only, and deliberately without a general Bash escape. The prompt's
		// one computed measurement — colliding nummers in entries.jsonl — is a
		// grep | sort | uniq -d | wc pipeline, so no interpreter is needed.
		// `python3 -c` used to be allowed for it, and could write files or start
		// the pipeline this agent audits; the allow-list is what makes
		// "read-only" true, so it has none.
		allowedTools: [
			"Read",
			"Grep",
			"Glob",
			"Bash(grep *)",
			"Bash(ls *)",
			"Bash(wc *)",
			"Bash(test *)",
		],
		permissionMode: "default",
	},
	writeScope: "read-only",
	scopeEnforcement: "manifest",
	execution: "unattended",

	artifactGlobs: [],
	statePaths: [
		{
			path: "scripts/_docid.py",
			source: "repo",
			required: true,
			missingHint:
				"scripts/_docid.py defines the identity rule this agent enforces. Without it there is no specification to audit against, and the audit would be the prompt's opinion.",
		},
		{
			path: "data/entries.jsonl",
			source: "repo",
			required: false,
			missingHint:
				"No catalogue in this checkout, which is normal — data/ is not in git. The collision count is reported as null and the code audit runs unchanged.",
		},
	],

	outcome: { kind: "json-block" },
	reasonCodes: [
		"path-key",
		"dict-key",
		"join-key",
		"missing-drive-id",
		"api-omits-drive-id",
		"mixed",
		"none",
	],

	budget: { dailyCostCapUsd: 2, maxTurns: 40, maxWallClockMinutes: 12 },

	notes: [
		"Reports only. A fix changes how documents are identified and carries a data migration, so it is a decision rather than an edit.",
		"Repo-owned prompt on purpose: it is also a /docid-invariant slash command inside ledtraad, usable while the offending code is being written.",
	],
};
