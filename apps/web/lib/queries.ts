/**
 * Purpose: the read queries behind Arnold's GET routes. Every Prisma `include`
 * the DTO mappers depend on lives here, so a route handler is only argument
 * parsing plus one call, and the include shapes cannot drift apart between the
 * run list, the run detail page, and the agent grid.
 *
 * Writes are not here: dispatch, cancel, and registry sync all belong to
 * @arnold/core and the routes call core directly.
 */

import { prisma } from "@arnold/core";
import {
	mapAgentSummary,
	mapRepo,
	mapRunDetail,
	mapRunSummary,
	type AgentSummary,
	type RepoDto,
	type RunDetail,
	type RunSummary,
} from "@/lib/dto";
import type { RunsQuery } from "@/lib/params";

/** The rolling window the agent cards report cost and run counts over. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Exactly the relations `mapRunSummary` reads. */
const runSummaryRelations = {
	agent: { select: { name: true } },
	repo: { select: { slug: true } },
	outcomes: { select: { outcome: true, reasonCode: true } },
	_count: { select: { artifacts: true, children: true } },
} as const;

export async function loadRepoDtos(): Promise<RepoDto[]> {
	const repoRows = await prisma.repo.findMany({
		orderBy: { slug: "asc" },
		include: { _count: { select: { agents: true, runs: true } } },
	});
	return repoRows.map(mapRepo);
}

/**
 * `repoSlug` is applied in memory rather than as a `where` clause on the join:
 * unregistered and orphaned agents can be missing their AgentRepo row entirely,
 * and the contract says they still show up (just with `runnable: false`). The
 * registry is single digits of rows in Phase 0, so this costs nothing.
 */
function matchesRepoFilter(agent: AgentSummary, repoSlug: string | undefined): boolean {
	if (repoSlug === undefined) return true;
	return agent.repoSlugs.includes(repoSlug) || agent.repoSlugs.includes("*");
}

export async function loadAgentSummaries(options: { repoSlug?: string }): Promise<AgentSummary[]> {
	const agentRows = await prisma.agent.findMany({
		orderBy: { name: "asc" },
		include: { repos: { include: { repo: { select: { slug: true } } } } },
	});

	const since = new Date(Date.now() - SEVEN_DAYS_MS);
	const windowRows = await prisma.run.groupBy({
		by: ["agentId"],
		where: { createdAt: { gte: since } },
		_sum: { costUsd: true },
		_count: { _all: true },
	});
	const windowByAgentId = new Map<
		string,
		{ agentWindowCostUsd: number; agentWindowRunCount: number }
	>();
	for (const windowRow of windowRows) {
		windowByAgentId.set(windowRow.agentId, {
			agentWindowCostUsd: windowRow._sum.costUsd ?? 0,
			agentWindowRunCount: windowRow._count._all,
		});
	}

	// One findFirst per agent: SQLite has no DISTINCT ON, and a single ordered
	// fetch would silently omit the last run of any agent that has been idle.
	const lastRunRows = await Promise.all(
		agentRows.map((agentRow) =>
			prisma.run.findFirst({
				where: { agentId: agentRow.id },
				orderBy: { createdAt: "desc" },
				include: runSummaryRelations,
			}),
		),
	);

	return agentRows
		.map((agentRow, index) => {
			const windowStats = windowByAgentId.get(agentRow.id);
			const lastRunRow = lastRunRows[index];
			return mapAgentSummary(agentRow, {
				agentCostUsd7d: windowStats?.agentWindowCostUsd ?? 0,
				agentRunCount7d: windowStats?.agentWindowRunCount ?? 0,
				agentLastRun: lastRunRow ? mapRunSummary(lastRunRow) : undefined,
			});
		})
		.filter((agent) => matchesRepoFilter(agent, options.repoSlug));
}

export async function loadRunSummaries(query: RunsQuery): Promise<RunSummary[]> {
	const runRows = await prisma.run.findMany({
		where: {
			...(query.agentId ? { agentId: query.agentId } : {}),
			...(query.repoSlug ? { repo: { slug: query.repoSlug } } : {}),
			...(query.status ? { status: query.status } : {}),
			...(query.parent === "root" ? { parentRunId: null } : {}),
		},
		orderBy: { createdAt: "desc" },
		take: query.limit,
		include: runSummaryRelations,
	});
	return runRows.map((runRow) => mapRunSummary(runRow));
}

/** Returns undefined when the run does not exist, so the route can answer 404. */
export async function loadRunDetail(runId: string): Promise<RunDetail | undefined> {
	const runRow = await prisma.run.findUnique({
		where: { id: runId },
		include: {
			agent: { include: { repos: { include: { repo: { select: { slug: true } } } } } },
			repo: { select: { slug: true } },
			outcomes: { select: { outcome: true, reasonCode: true } },
			events: { orderBy: { seq: "asc" } },
			artifacts: { orderBy: { createdAt: "asc" } },
			children: { orderBy: { createdAt: "asc" }, include: runSummaryRelations },
			_count: { select: { artifacts: true, children: true } },
		},
	});
	if (!runRow) return undefined;

	const since = new Date(Date.now() - SEVEN_DAYS_MS);
	const [agentWindow, agentLastRunRow, workspaceRow] = await Promise.all([
		prisma.run.aggregate({
			where: { agentId: runRow.agentId, createdAt: { gte: since } },
			_sum: { costUsd: true },
			_count: { _all: true },
		}),
		prisma.run.findFirst({
			where: { agentId: runRow.agentId },
			orderBy: { createdAt: "desc" },
			include: runSummaryRelations,
		}),
		// Run.workspaceId is a bare column, not a relation (a workspace outlives
		// the run that leased it), so the path needs its own lookup.
		runRow.workspaceId
			? prisma.workspace.findUnique({
					where: { id: runRow.workspaceId },
					select: { path: true },
				})
			: Promise.resolve(null),
	]);

	return mapRunDetail(runRow, {
		agent: mapAgentSummary(runRow.agent, {
			agentCostUsd7d: agentWindow._sum.costUsd ?? 0,
			agentRunCount7d: agentWindow._count._all,
			agentLastRun: agentLastRunRow ? mapRunSummary(agentLastRunRow) : undefined,
		}),
		children: runRow.children.map((childRow) => mapRunSummary(childRow)),
		workspacePath: workspaceRow?.path ?? undefined,
	});
}
