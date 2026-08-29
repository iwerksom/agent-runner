/**
 * Purpose: one agent, in full. The manifest rendered readably (arguments with
 * their slots, tool allow-list, artifact globs, state paths, reason codes,
 * budget, notes), then every run it has produced with the outcome and reason code
 * it emitted, and a 14-day spend sparkline.
 *
 * Server component. There is no /api/agents/[id] in the contract, so the agent
 * comes out of the list endpoint; the run history and the sparkline both come
 * from the same /api/runs?agentId= page of runs, which keeps this to three
 * requests.
 */

import { ArrowLeft, CircleDollarSign, History } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	AgentStateChip,
	ExecutionModeBadge,
	KindChip,
	ScopeEnforcementBadge,
	UntrustedInputBadge,
	WriteScopeBadge,
} from "@/components/badges";
import { AgentManifestPanel } from "@/components/AgentManifestPanel";
import { AgentRunButton } from "@/components/AgentRunButton";
import { CostSparkline, buildDailyCostBuckets } from "@/components/CostSparkline";
import { RunTable } from "@/components/RunTable";
import { fetchAgent, fetchRepos, fetchRuns } from "@/components/api";
import { formatCostUsd } from "@/components/format";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
	params,
}: {
	params: Promise<{ agentId: string }>;
}) {
	const { agentId } = await params;
	const agent = await fetchAgent(agentId);
	if (!agent) notFound();

	const [runs, repos] = await Promise.all([
		fetchRuns({ agentId: agent.id, limit: 50 }),
		fetchRepos(),
	]);

	// A manifest declared for "*" applies to every known repo, and a run has to be
	// dispatched against exactly one of them.
	const targetRepoSlugs = agent.repoSlugs.includes("*")
		? repos.map((repo) => repo.slug)
		: agent.repoSlugs;

	const buckets = buildDailyCostBuckets(runs, 14);
	const historyCostUsd = runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);

	return (
		<div className="flex flex-col gap-6">
			<Link
				href="/"
				className="flex w-fit items-center gap-1.5 text-xs text-default-400 hover:text-foreground"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				All agents
			</Link>

			<header className="flex flex-col gap-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col gap-1.5">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
							<KindChip agentKind={agent.kind} />
							{agent.state !== "active" ? (
								<AgentStateChip agentState={agent.state} />
							) : undefined}
						</div>
						<code className="font-mono text-[11px] text-default-400">{agent.id}</code>
						<p className="max-w-3xl text-sm text-default-500">{agent.description}</p>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						{targetRepoSlugs.length === 0 ? (
							<span className="text-xs text-default-400">
								No repo to run against.
							</span>
						) : (
							targetRepoSlugs.map((repoSlug) => (
								<AgentRunButton
									key={repoSlug}
									agentRunButtonAgent={agent}
									agentRunButtonRepoSlug={repoSlug}
									agentRunButtonLabel={
										targetRepoSlugs.length > 1 ? `Run on ${repoSlug}` : "Run"
									}
								/>
							))
						)}
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					<WriteScopeBadge writeScope={agent.writeScope} />
					<ExecutionModeBadge executionMode={agent.execution} />
					<ScopeEnforcementBadge scopeEnforcement={agent.scopeEnforcement} />
					{agent.ingestsUntrustedInput ? <UntrustedInputBadge /> : undefined}
				</div>

				{agent.notRunnableReason ? (
					<p className="w-fit rounded-medium border border-warning-400 bg-warning-50/10 px-3 py-2 text-xs text-warning-600">
						{agent.notRunnableReason}
					</p>
				) : undefined}
			</header>

			<div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
				<div className="min-w-0">
					<AgentManifestPanel agentManifestAgent={agent} />
				</div>

				<aside className="flex flex-col gap-4">
					<section className="rounded-large border border-default-200 bg-content1 p-4">
						<h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
							<CircleDollarSign className="h-4 w-4 text-default-400" />
							Budget
						</h2>
						<dl className="flex flex-col gap-2 text-xs">
							<div className="flex items-baseline justify-between gap-2">
								<dt className="text-default-400">Daily cap</dt>
								<dd className="font-mono tabular-nums text-foreground">
									{formatCostUsd(agent.budget.dailyCostCapUsd)}
								</dd>
							</div>
							<div className="flex items-baseline justify-between gap-2">
								<dt className="text-default-400">Max turns</dt>
								<dd className="font-mono tabular-nums text-foreground">
									{agent.budget.maxTurns}
								</dd>
							</div>
							<div className="flex items-baseline justify-between gap-2">
								<dt className="text-default-400">Wall clock</dt>
								<dd className="font-mono tabular-nums text-foreground">
									{agent.budget.maxWallClockMinutes} min
								</dd>
							</div>
							<div className="flex items-baseline justify-between gap-2 border-t border-divider pt-2">
								<dt className="text-default-400">Last 7 days</dt>
								<dd className="font-mono tabular-nums text-foreground">
									{formatCostUsd(agent.costUsd7d)} · {agent.runCount7d} run
									{agent.runCount7d === 1 ? "" : "s"}
								</dd>
							</div>
						</dl>
					</section>

					<section className="rounded-large border border-default-200 bg-content1 p-4">
						<CostSparkline
							costSparklineBuckets={buckets}
							costSparklineLabel="14-day cost"
						/>
						<p className="mt-2 text-[11px] text-default-400">
							Built from the {runs.length} most recent runs of this agent, bucketed by
							UTC day.
						</p>
					</section>

					<section className="rounded-large border border-default-200 bg-content1 p-4">
						<h2 className="mb-2 text-sm font-semibold">Repos</h2>
						<ul className="flex flex-wrap gap-1.5">
							{agent.repoSlugs.map((slug) => (
								<li
									key={slug}
									className="rounded bg-content2 px-2 py-1 font-mono text-[11px] text-default-700"
								>
									{slug}
								</li>
							))}
						</ul>
					</section>
				</aside>
			</div>

			<section className="flex flex-col gap-3">
				<header className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-2">
					<h2 className="flex items-center gap-2 text-base font-semibold">
						<History className="h-4 w-4 text-default-400" />
						Run history
						<span className="text-xs font-normal text-default-400">
							{runs.length} run{runs.length === 1 ? "" : "s"}
						</span>
					</h2>
					<span className="font-mono text-xs tabular-nums text-default-500">
						{formatCostUsd(historyCostUsd)} total
					</span>
				</header>

				<RunTable
					runTableRuns={runs}
					runTableShowAgent={false}
					runTableShowOutcome
					runTableAriaLabel={`${agent.name} run history`}
					runTableEmptyContent="This agent has never run."
				/>
			</section>
		</div>
	);
}
