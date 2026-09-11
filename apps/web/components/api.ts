/**
 * Purpose: server-side readers for the pages. Every page in Arnold is a Server
 * Component, and these are the only functions they call to get data.
 *
 * These used to `fetch()` Arnold's own HTTP routes over localhost. That is a
 * self-request: the server asks itself, over TCP, for data it can already read.
 * It cost four extra round trips per page render, needed `headers()` to guess its
 * own origin, and in dev it serialised badly against on-demand route compilation
 * (the agent detail page was taking 17s, most of it Next overhead). So these now
 * call the query layer in lib/queries.ts directly, and the HTTP routes stay what
 * they should be: the interface for the browser and for anything outside this
 * process.
 *
 * The signatures are unchanged, so no page needed editing.
 *
 * Reads still degrade instead of throwing. A failure returns an empty collection
 * so the surrounding page renders its shell and its empty state, which is what an
 * operator needs in order to see *that* something is wrong. The reason is now
 * logged, because a silently swallowed error made a broken tier look exactly like
 * an idle one.
 */

import type { AgentSummary, RepoDto, RunDetail, RunStatus, RunSummary } from "@/components/types";
import { loadAgentSummaries, loadRepoDtos, loadRunDetail, loadRunSummaries } from "@/lib/queries";

/** Never throws. Logs and returns the caller's fallback, which the UI renders as an empty state. */
async function read<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
	try {
		return await run();
	} catch (caught: unknown) {
		console.error(`[arnold] ${label} failed:`, caught);
		return fallback;
	}
}

/**
 * Active repos only unless asked otherwise. Archived repos still exist and still
 * own their run history; they are simply not somewhere a new run can be sent.
 */
export async function fetchRepos(options: { includeArchived?: boolean } = {}): Promise<RepoDto[]> {
	return read("fetchRepos", () => loadRepoDtos(options), []);
}

export async function fetchAgents(repoSlug?: string): Promise<AgentSummary[]> {
	return read(
		"fetchAgents",
		() => loadAgentSummaries(repoSlug === undefined ? {} : { repoSlug }),
		[],
	);
}

export async function fetchAgent(agentId: string): Promise<AgentSummary | undefined> {
	// There is no single-agent query in the contract, so the detail page filters
	// the list. Cheap in Phase 0 (tens of agents) and it keeps one mapping path
	// for list and detail, which is what stops the two screens disagreeing.
	const agents = await fetchAgents();
	return agents.find((agent) => agent.id === agentId);
}

export type RunQuery = {
	agentId?: string;
	repoSlug?: string;
	status?: RunStatus;
	/** "root" hides child runs, which belong to their parent's run tree. */
	parent?: "root";
	limit?: number;
};

export async function fetchRuns(query: RunQuery = {}): Promise<RunSummary[]> {
	return read(
		"fetchRuns",
		() =>
			loadRunSummaries({
				...(query.agentId === undefined ? {} : { agentId: query.agentId }),
				...(query.repoSlug === undefined ? {} : { repoSlug: query.repoSlug }),
				...(query.status === undefined ? {} : { status: query.status }),
				// The route's zod schema defaults these; a direct call must supply them.
				parent: query.parent ?? "root",
				limit: query.limit ?? 50,
			}),
		[],
	);
}

export async function fetchRun(runId: string): Promise<RunDetail | undefined> {
	return read("fetchRun", () => loadRunDetail(runId), undefined);
}
