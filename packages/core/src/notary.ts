/**
 * Purpose: answer "what code did this run actually see, and what did it produce?"
 * after the fact, and link the run to the tickets it discussed.
 *
 * Every function here is safe on a read-only run: a worktree that produced no
 * branch, no commit and no PR still yields a head sha, and the PR lookup is
 * expected to fail. Nothing in this file may turn a successful run into a failed
 * one, so every external call is tolerated failing.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "./db.js";
import { stringifyJsonColumn } from "./json.js";

const execFileAsync = promisify(execFile);

export type RunProvenance = {
	/** Undefined on a detached worktree, which is how every lease starts. */
	provenanceBranch?: string;
	provenanceHeadSha?: string;
	provenancePrUrl?: string;
	provenancePrNumber?: number;
	provenanceTicketKeys: string[];
};

/** Jira-style keys: two to ten uppercase letters, a hyphen, digits. */
const TICKET_KEY_RE = /\b[A-Z]{2,10}-\d+\b/g;

/**
 * Ticket keys in first-seen order, scanned across `sources` in the order given.
 * Order is kept because the first key seen is almost always the one the run was
 * about, which is why the caller passes the declared arguments before the
 * transcript: an agent handed `ticketKey: PROJ-1690` is about PROJ-1690 even if it
 * never types the key, and it may well discuss other tickets before it does.
 */
export function extractTicketKeys(...sources: (string | undefined)[]): string[] {
	const seen = new Set<string>();
	const keys: string[] = [];
	for (const source of sources) {
		if (source === undefined) continue;
		for (const match of source.matchAll(TICKET_KEY_RE)) {
			const key = match[0];
			if (seen.has(key)) continue;
			seen.add(key);
			keys.push(key);
		}
	}
	return keys;
}

async function tryCommand(
	command: string,
	args: string[],
	cwd: string,
): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 4 * 1024 * 1024 });
		const text = stdout.toString().trim();
		return text === "" ? undefined : text;
	} catch {
		// Provenance is best-effort by design: no gh, no auth, no remote, or no PR
		// are all normal states for a read-only run.
		return undefined;
	}
}

async function detectPullRequest(
	workspacePath: string,
): Promise<{ prUrl?: string; prNumber?: number }> {
	const raw = await tryCommand("gh", ["pr", "view", "--json", "url,number"], workspacePath);
	if (raw === undefined) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const record = parsed as { url?: unknown; number?: unknown };
		const prUrl = typeof record.url === "string" ? record.url : undefined;
		const prNumber = typeof record.number === "number" ? record.number : undefined;
		if (prUrl === undefined && prNumber === undefined) return {};
		return {
			...(prUrl === undefined ? {} : { prUrl }),
			...(prNumber === undefined ? {} : { prNumber }),
		};
	} catch {
		return {};
	}
}

/**
 * Read provenance from the worktree, write it onto the Run row, and return it.
 * `transcriptText` is optional so a caller with no transcript (a cancelled run,
 * say) can still record the git facts.
 *
 * `declaredArgValues` is the run's own arguments, in the manifest's declared
 * order. Without them a run whose whole subject is an argument records no ticket
 * at all: work-order-scoper is dispatched with `ticketKey`, scopes that one
 * ticket, and answers in prose that need never repeat the key, so its first real
 * run recorded `ticketKeys: null` for a run entirely about PROJ-1690.
 */
export async function recordProvenance(
	runId: string,
	workspacePath: string,
	transcriptText?: string,
	declaredArgValues?: string[],
): Promise<RunProvenance> {
	const branchName = await tryCommand(
		"git",
		["rev-parse", "--abbrev-ref", "HEAD"],
		workspacePath,
	);
	// Leases are created with `worktree add --detach`, so "HEAD" here means the
	// agent never created a branch. That is not a branch name worth recording.
	const provenanceBranch =
		branchName === undefined || branchName === "HEAD" ? undefined : branchName;
	const provenanceHeadSha = await tryCommand("git", ["rev-parse", "HEAD"], workspacePath);
	const { prUrl, prNumber } = await detectPullRequest(workspacePath);
	// Arguments first, so the ticket the run was dispatched against leads the list
	// even when the transcript mentions others earlier.
	const provenanceTicketKeys = extractTicketKeys(...(declaredArgValues ?? []), transcriptText);

	await prisma.run.update({
		where: { id: runId },
		data: {
			branch: provenanceBranch ?? null,
			headSha: provenanceHeadSha ?? null,
			prUrl: prUrl ?? null,
			prNumber: prNumber ?? null,
			ticketKeys:
				provenanceTicketKeys.length === 0
					? null
					: stringifyJsonColumn(provenanceTicketKeys),
		},
	});

	return {
		...(provenanceBranch === undefined ? {} : { provenanceBranch }),
		...(provenanceHeadSha === undefined ? {} : { provenanceHeadSha }),
		...(prUrl === undefined ? {} : { provenancePrUrl: prUrl }),
		...(prNumber === undefined ? {} : { provenancePrNumber: prNumber }),
		provenanceTicketKeys,
	};
}
