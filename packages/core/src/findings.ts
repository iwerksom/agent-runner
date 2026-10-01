/**
 * Purpose: findings as durable rows rather than a count in an outcome block.
 *
 * An agent's outcome JSON may carry a `findings` array (doc-drift does, #32).
 * After each run this module turns that array into `Finding` rows and
 * reconciles them with what earlier runs reported: a finding already known is
 * refreshed, not duplicated, and an open finding the latest full run no longer
 * reports is closed. Without the closing half, a findings count only ever rises.
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

/**
 * Which open findings may this run close? Only a run that looked at everything
 * a finding could live in. A `--docs=` subset closes findings in those
 * documents only, and a run that stopped at `--max-findings` closes nothing,
 * because the findings it did not get to are not findings that went away.
 */
export function closableScope(
	payload: unknown,
	args: Record<string, string> | undefined,
	reported: number,
): { files: Set<string> | "none" | "all" } {
	const record = (payload ?? {}) as Record<string, unknown>;
	const outcome = str(record.outcome);
	if (outcome === "unmeasurable" || outcome === "unparsed") return { files: "none" };
	const max = Number(args?.maxFindings);
	if (Number.isFinite(max) && max > 0 && reported >= max) return { files: "none" };
	const documents = record.documents;
	if (Array.isArray(documents) && documents.length > 0) {
		return { files: new Set(documents.map(str)) };
	}
	return { files: "all" };
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
		const args = run.args === null ? undefined : (JSON.parse(run.args) as Record<string, string>);
		const now = new Date();
		const result: ReconcileResult = { created: 0, refreshed: 0, closed: 0 };
		const seen = new Set<string>();

		for (const f of parsed) {
			const fingerprint = fingerprintFor(agentId, f.file, f.claim);
			seen.add(fingerprint);
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

		const scope = closableScope(payload, args, parsed.length);
		if (scope.files !== "none") {
			const open = await prisma.finding.findMany({
				where: { repoId, agentId, state: "open" },
			});
			for (const row of open) {
				if (seen.has(row.fingerprint)) continue;
				if (scope.files !== "all" && !scope.files.has(row.file)) continue;
				await prisma.finding.update({
					where: { id: row.id },
					data: { state: "closed", closedAt: now, lastRunId: runId },
				});
				result.closed += 1;
			}
		}
		return result;
	} catch {
		return undefined;
	}
}
