/**
 * Purpose: binding for `/doc-drift` against ledtraad.
 *
 * The prompt is Arnold's (`prompts/doc-drift.md`) and contains no ledtraad
 * facts: it describes the auditing discipline, and everything repo-specific
 * arrives through `values`. That split is the point — the discipline is
 * identical on any repo, the measurements never are. Onboarding a second repo
 * to this agent means writing a file like this one and nothing else.
 *
 * The measurements below are the claims ledtraad's own history shows going
 * stale: two commits in ten are "refresh the stale counts" and "fix wrong
 * findings in RUNBOOK", and the README's counts table carries a footnote
 * telling the reader to re-measure rather than trust it. That footnote is the
 * job description for this agent.
 */

import type { AgentManifest } from "@arnold/core";

/**
 * Claim families and the command that settles each. Kept as one prose block
 * rather than structured data because it lands in the prompt body verbatim, and
 * the model needs the reasoning next to the command, not a schema.
 */
const measurements = `
| Claim family | Where it is written | Command that settles it |
|---|---|---|
| Catalogue entries | README counts table, CLAUDE.md prose | \`wc -l < data/entries.jsonl\` |
| Documents OCR'd | README counts table | \`wc -l < data/corpus/palme_corpus.jsonl\` |
| Retrieval chunks | README counts table | \`wc -l < data/chunks/palme_chunks.jsonl\` |
| Bilingual summaries, and the % of OCR'd documents | README counts table | \`wc -l < data/summaries.jsonl\`, as a percentage of the corpus count |
| Colliding nummers ("63 numbers are reused", "62 of them...", "drive_id has 11 collisions") | CLAUDE.md traps section | count over \`data/entries.jsonl\`, keyed as \`_docid.colliding_nummers\` defines it — nummers appearing on more than one entry **that has a drive_id** |
| Front-end file size ("one 136 KB HTML file") | README stack section, CLAUDE.md | \`wc -c web/index.html\` |
| Every \`scripts/*.py\` named in prose | RUNBOOK, README, CLAUDE.md, ROADMAP | \`ls scripts/\` |
| Every \`docs/*.md\` and root document named in prose | all four documents | \`ls docs/\` and the repo root |
| RUNBOOK section cross-references ("RUNBOOK.md §5", "§7", "§10") | README, CLAUDE.md, ROADMAP | \`grep -n '^## ' RUNBOOK.md\` — check the number exists **and** that its heading matches what the citing sentence claims it covers |
| ROADMAP phase statuses (P6 Done, P7 Up next, P12 In progress) | ROADMAP table and its own section headings | do the deliverables each phase lists exist under \`scripts/\` or \`tests/\`? The table and the per-phase headings must also agree with each other |
| Documented command-line flags | RUNBOOK §3 and §5, script docstrings | read the script's \`argparse\` setup — never run the command |
`.trim();

const measurementNotes = `
- **The runtime corpus is not in git.** \`docs/DATA.md\` lists the three
  hand-edited files that are versioned; everything else under \`data/\` is
  generated and ships by rsync. On a checkout without it, every count above is
  **unmeasurable here**, not drift. Report those once, under "could not verify",
  and audit the path and cross-reference claims instead — those are always
  checkable and are where the actionable findings usually are.
- **One venv, \`.venv\` at the project root.** Outside it there is no \`python\`,
  only \`python3\`. Prefer \`python3\` with the standard library for counting; the
  audit must not depend on the venv being built.
- **\`nummer\` is not a unique key.** Any count you compute per document must be
  keyed on \`(nummer, drive_id)\`, per \`scripts/_docid.py\`. Counting distinct
  nummers will disagree with the documented figures by roughly 63, and the
  documents are right.
- **Do not start the API, and do not run anything under \`scripts/\`.** If
  \`GET localhost:8000/health\` answers because a server is already up, its counts
  are fair evidence; if nothing is listening, that is not a finding.
- Counts in the README carry a measurement date in a \`<sub>\` note. A stale count
  whose note is also old is one finding, not two.
`.trim();

export const manifest: AgentManifest = {
	id: "doc-drift",
	name: "Doc Drift",
	description:
		"Re-measures the counts, path references, cross-references and status tables in README, CLAUDE.md, RUNBOOK and ROADMAP against the repo, and reports which have gone stale. Read-only.",
	kind: "command",
	// Arnold owns this prompt: the discipline is reusable, only the values below
	// are ledtraad's.
	prompt: { kind: "console", path: "prompts/doc-drift.md" },

	repos: ["ledtraad"],
	invocable: "direct",

	values: {
		docFiles: "`README.md`, `CLAUDE.md`, `RUNBOOK.md`, `ROADMAP.md`, `docs/DATA.md`",
		measurements,
		measurementNotes,
	},

	args: [
		{
			name: "docs",
			slot: "--docs=",
			type: "string",
			required: false,
			description:
				"Comma-separated subset of documents to audit. Default: all five declared in the binding.",
		},
		{
			name: "maxFindings",
			slot: "--max-findings=",
			type: "number",
			required: false,
			default: "30",
			description: "Stop after this many findings and say so.",
		},
	],

	tools: {
		// The prompt says "you never edit a document" and "never run the pipeline".
		// Nothing enforced either until this allow-list did. Bash is narrowed to
		// the measuring commands the binding actually names: counting, listing and
		// testing for existence. No `python3 scripts/...`, so the pipeline is out
		// of reach even if the model decides it would be helpful.
		allowedTools: [
			"Read",
			"Grep",
			"Glob",
			"Bash(wc *)",
			"Bash(ls *)",
			"Bash(test *)",
			"Bash(head *)",
			"Bash(tail *)",
			"Bash(grep *)",
			"Bash(python3 -c *)",
			"Bash(curl -s --max-time * http://localhost:8000/health)",
		],
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
			missingHint:
				"README.md is one of the documents this agent audits. Without it there is nothing to check.",
		},
		{
			path: "data",
			source: "repo",
			required: false,
			missingHint:
				"No data/ directory in this checkout. Expected — the runtime corpus is not in git. The count claims will be reported as unverifiable and the path and cross-reference audit still runs.",
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

	// Measured, not guessed. The first full run over all five documents cost
	// $1.78 in 39 turns — the counters really are wc and grep, but reading
	// RUNBOOK.md (50 KB) and adjudicating 118 claims is not. An earlier $1.50 cap
	// sized from the counters alone refused the *second* run of the day, which is
	// the wrong thing to be strict about: this agent is cheap per finding and its
	// whole value is being run often. Four full runs a day, and the turn cap is
	// what stops a wandering one.
	budget: { dailyCostCapUsd: 8, maxTurns: 45, maxWallClockMinutes: 15 },

	notes: [
		"The prompt is repo-agnostic. To run this against another repo, add a sibling binding with its own measurements — do not copy the prompt.",
		"Reports only. Deciding whether the document or the code is wrong is a judgement with consequences, and the agent is explicitly told to say when it cannot tell.",
	],
};
