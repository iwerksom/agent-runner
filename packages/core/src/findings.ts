/**
 * Purpose: findings as durable rows rather than a count in an outcome block.
 *
 * An agent's outcome JSON may carry a `findings` array (doc-drift does, #32).
 * After each run this module turns that array into `Finding` rows and
 * reconciles them with what earlier runs reported: a finding already known is
 * refreshed, not duplicated. Closing is done by the agent re-measuring: each run
 * is handed the open findings and reports `recheck` entries for them, and only
 * a `fixed` one closes. Leaving a finding out of a report closes nothing,
 * because the agent is not deterministic. Without a closing half, a findings
 * count only ever rises.
 *
 * Identity is the fingerprint: agent + file + normalised claim. Never the line,
 * because lines move and that is what drift is.
 */

import { createHash } from "node:crypto";
import { prisma } from "./db.js";

export interface ParsedFinding {
	file: string;
	line: number | null;
	claim: string;
	measured: string;
	command: string;
	verdict: string;
	note: string;
}

/** Case, whitespace and quote style are presentation; the words are the claim. */
export function normaliseClaim(claim: string): string {
	return claim
		.replace(/[‘’“”"'`]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

export function fingerprintFor(agentId: string, file: string, claim: string): string {
	return createHash("sha256")
		.update(`${agentId}\n${file.trim()}\n${normaliseClaim(claim)}`)
		.digest("hex")
		.slice(0, 32);
}

function str(value: unknown): string {
	return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

/**
 * Read the `findings` array from an outcome payload. Entries without a file or
 * a claim cannot be fingerprinted and are dropped. Returns undefined when the
 * payload carries no array at all (an older run, or an agent without findings),
 * which must not be mistaken for "found nothing" and close everything.
 */
export function parseFindings(payload: unknown): ParsedFinding[] | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const raw = (payload as Record<string, unknown>).findings;
	if (!Array.isArray(raw)) return undefined;
	const out: ParsedFinding[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const e = entry as Record<string, unknown>;
		const file = str(e.file).trim();
		const claim = str(e.claim).trim();
		if (file === "" || claim === "") continue;
		const line = typeof e.line === "number" && Number.isInteger(e.line) ? e.line : null;
		out.push({
			file,
			line,
			claim,
			measured: str(e.measured),
			command: str(e.command),
			verdict: str(e.verdict) || "unclear",
			note: str(e.note),
		});
	}
	return out;
}

export interface Recheck {
	id: string;
	status: "still-true" | "fixed" | "unmeasurable";
	measured: string;
}

/**
 * Read the `recheck` array: the agent's re-measurement of findings it was
 * handed. Unknown statuses are dropped, so a garbled entry changes nothing.
 */
export function parseRechecks(payload: unknown): Recheck[] {
	if (typeof payload !== "object" || payload === null) return [];
	const raw = (payload as Record<string, unknown>).recheck;
	if (!Array.isArray(raw)) return [];
	const out: Recheck[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const e = entry as Record<string, unknown>;
		const status = str(e.status);
		const id = str(e.id).trim();
		if (id === "" || (status !== "still-true" && status !== "fixed" && status !== "unmeasurable")) {
			continue;
		}
		out.push({ id, status, measured: str(e.measured) });
	}
	return out;
}

/**
 * The section appended to a `trackFindings` agent's prompt: every open finding
 * for this repo, with the command that measured it. Empty when there are none,
 * which is the first run.
 */
export async function knownFindingsContext(repoId: string, agentId: string): Promise<string> {
	const open = await prisma.finding.findMany({
		where: { repoId, agentId, state: "open" },
		orderBy: [{ file: "asc" }, { line: "asc" }],
	});
	if (open.length === 0) return "";
	const rows = open.map((f) =>
		JSON.stringify({
			id: f.id,
			file: f.file,
			line: f.line,
			claim: f.claim,
			command: f.command,
			lastMeasured: f.measured,
		}),
	);
	return [
		"",
		"## Known findings to re-check",
		"",
		"These findings were reported by earlier runs and are still open. Re-run each",
		"one's `command` and report it under `recheck` in your final JSON, by `id`:",
		"`still-true` when the document still says what the claim quotes and the repo",
		"still disagrees, `fixed` when the document now matches the repo (or the claim",
		"is gone), `unmeasurable` when you cannot measure it here. Do not list a known",
		"finding again under `findings`: that array is for problems not listed below.",
		"",
		...rows,
		"",
	].join("\n");
}

export interface ReconcileResult {
	created: number;
	refreshed: number;
	closed: number;
}

/**
 * Record a run's findings. Never throws: a bookkeeping failure here must not
 * turn a completed run into a failed one, same rule as outcome parsing.
 */
export async function recordFindings(
	runId: string,
	payload: unknown,
): Promise<ReconcileResult | undefined> {
	try {
		const parsed = parseFindings(payload);
		if (parsed === undefined) return undefined;
		const run = await prisma.run.findUnique({ where: { id: runId } });
		if (run === null || run.repoId === null) return undefined;
		const { repoId, agentId } = run;
		const now = new Date();
		const result: ReconcileResult = { created: 0, refreshed: 0, closed: 0 };

		for (const f of parsed) {
			const fingerprint = fingerprintFor(agentId, f.file, f.claim);
			const existing = await prisma.finding.findUnique({
				where: { repoId_agentId_fingerprint: { repoId, agentId, fingerprint } },
			});
			const fresh = {
				lastRunId: runId,
				lastSeenAt: now,
				line: f.line,
				measured: f.measured,
				command: f.command,
				verdict: f.verdict,
				note: f.note,
				state: "open",
				closedAt: null,
			};
			if (existing === null) {
				await prisma.finding.create({
					data: {
						repoId,
						agentId,
						fingerprint,
						sourceRunId: runId,
						title: f.claim.length > 120 ? `${f.claim.slice(0, 117)}...` : f.claim,
						file: f.file,
						claim: f.claim,
						firstSeenAt: now,
						...fresh,
					},
				});
				result.created += 1;
			} else {
				await prisma.finding.update({ where: { id: existing.id }, data: fresh });
				result.refreshed += 1;
			}
		}

		// Closing is a re-measurement, never an omission. A finding the run did not
		// mention stays open: the agent is not deterministic, and "did not look
		// there this time" is not "fixed".
		for (const check of parseRechecks(payload)) {
			if (check.status === "unmeasurable") continue;
			const row = await prisma.finding.findUnique({ where: { id: check.id } });
			if (row === null || row.repoId !== repoId || row.agentId !== agentId) continue;
			if (row.state !== "open") continue;
			if (check.status === "fixed") {
				await prisma.finding.update({
					where: { id: row.id },
					data: { state: "closed", closedAt: now, lastRunId: runId, measured: check.measured },
				});
				result.closed += 1;
			} else {
				await prisma.finding.update({
					where: { id: row.id },
					data: { lastRunId: runId, lastSeenAt: now, measured: check.measured },
				});
				result.refreshed += 1;
			}
		}
		return result;
	} catch {
		return undefined;
	}
}
