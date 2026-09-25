/**
 * Purpose: manifest overlay for the `work-order-scoper` subagent in
 * Read-only, so it is the safest possible first agent to run
 * through Arnold end to end.
 *
 * Normally this agent is spawned by /plan-week, once per survivor of that
 * command's step-4 screen, and receives its context in prose. Phase 0 promotes
 * it to `invocable: "direct"` so an operator can paste one Jira issue and watch
 * the whole pipeline (argument rendering, workspace lease, tool policy,
 * transcript, outcome parsing) work on an agent that cannot break anything.
 */

import type { AgentManifest } from "@arnold/core";

export const manifest: AgentManifest = {
	id: "work-order-scoper",
	name: "Work Order Scoper",
	description:
		"Scopes one Jira ticket against the codebase into a work order self-contained enough for an unattended coding agent, or rejects it with a reason code.",
	kind: "subagent",
	prompt: { kind: "console", path: "prompts/work-order-scoper.md" },

	// The subagent file has no argument-hint, because /plan-week hands it context
	// in prose. To run it directly we rebuild that block verbatim.
	contextTemplate: [
		"",
		"---",
		"",
		"## Your assignment",
		"",
		"- Work order number: WO-{{woNumber}}",
		"- Ticket key: {{ticketKey}}",
		"- Usable minutes in the target window: {{windowMinutes}}",
		"- Hot files (touched by open PRs or unmerged branches, treat as off limits):",
		"{{hotFiles}}",
		"",
		"### Full Jira issue text",
		"",
		"{{issueText}}",
		"",
		"Return either a REJECT line or the work order markdown. No preamble.",
	].join("\n"),

	repos: ["*"],
	invocable: "direct",

	args: [
		{
			name: "woNumber",
			slot: "{{woNumber}}",
			type: "number",
			required: true,
			default: "1",
			description: "Work order number, used in the title as WO-<n>.",
		},
		{
			name: "ticketKey",
			slot: "{{ticketKey}}",
			type: "string",
			required: true,
			description: "Jira key, e.g. PROJ-123. Becomes the branch prefix.",
		},
		{
			name: "issueText",
			slot: "{{issueText}}",
			type: "string",
			required: true,
			description: "The full Jira issue text: summary, description, acceptance criteria.",
		},
		{
			name: "windowMinutes",
			slot: "{{windowMinutes}}",
			type: "number",
			required: true,
			default: "90",
			description:
				"Usable minutes of the calendar window the order must fit. Over ~90 and not cleanly splittable is a too-large rejection.",
		},
		{
			name: "hotFiles",
			slot: "{{hotFiles}}",
			type: "string",
			required: false,
			default: "(none)",
			description:
				"Files touched by open PRs or unmerged branches. Overlap is a hot-files rejection.",
		},
	],

	tools: {
		// The subagent file declares `tools: Read, Grep, Glob, Bash` with
		// unrestricted Bash. Read-only there is prompt text only, so this is
		// where it becomes real: git reads and codegraph, nothing that writes.
		allowedTools: [
			"Read",
			"Grep",
			"Glob",
			"Bash(git log*)",
			"Bash(git show*)",
			"Bash(git diff*)",
			"Bash(git branch*)",
			"Bash(git status)",
			"Bash(npx codegraph*)",
		],
		permissionMode: "default",
	},
	writeScope: "read-only",
	scopeEnforcement: "manifest",
	execution: "unattended",

	artifactGlobs: [],
	statePaths: [
		{
			path: ".pr-loop/metrics.jsonl",
			source: "repo",
			required: false,
			missingHint:
				"No pr-loop history yet. The scoper cites it as precedent but works without it.",
		},
	],

	// It returns a REJECT line or a work order body, so there is no JSON block
	// and no file. The report matcher pulls the verdict out of the final message.
	// It announces only the negative case: "REJECT: <code>" on refusal, and
	// otherwise just the work order body. So a non-match means accepted, which is
	// what fallbackOutcome records. Without it every good work order would chart
	// as "unparsed" and the reject rate would read as 100%.
	outcome: {
		kind: "report",
		pathGlob: "",
		verdictPattern: "^REJECT:\\s*([a-z-]+(?::[^\\s]+)?)",
		fallbackOutcome: "accepted",
	},
	reasonCodes: [
		"undecided-design",
		"needs-visual-judgment",
		"external-dependency",
		"hot-files",
		"too-large",
		"stale-premise",
	],

	budget: { dailyCostCapUsd: 2, maxTurns: 25, maxWallClockMinutes: 10 },
	ingestsUntrustedInput: true, // Jira issue text is data, never instruction

	notes: [
		"Promoted to direct invocation for Phase 0. In production it runs as a child of plan-week.",
		"Its reason codes are its own: it emits `too-large`, while plan-week emits `too-large-to-split`. Do not merge the two vocabularies.",
	],
};
