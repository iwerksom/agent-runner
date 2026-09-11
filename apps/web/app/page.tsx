/**
 * Purpose: the agents grid, grouped by repo. The console's front door: what can
 * be run here, what it is allowed to change, and whether that permission is
 * actually enforced.
 *
 * Server component. Repos and agents are fetched together, then agents are
 * grouped locally rather than with one /api/agents?repo= call per repo, so the
 * page renders in two round trips regardless of how many repos exist. An agent
 * declared for `*` appears under every repo, because that is what the manifest
 * means.
 *
 * The repo switcher in the nav narrows this page to one repo. Grouping is kept
 * either way: a one-repo view is the same screen with one group, so nothing about
 * the layout depends on the selection.
 *
 * The header counts prompt-only enforcement on purpose. That number is a to-do
 * list, not a statistic: every agent in it has a write scope that is currently a
 * sentence in a prompt.
 */

import { Bot, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { AgentCard } from "@/components/AgentCard";
import { EmptyState } from "@/components/EmptyState";
import { RegistrySyncButton } from "@/components/RegistrySyncButton";
import { fetchAgents, fetchRepos } from "@/components/api";
import { formatCostUsd } from "@/components/format";
import { resolveRepoSelection } from "@/lib/repoSelection";
import type { AgentSummary, RepoDto } from "@/components/types";

export const dynamic = "force-dynamic";

/**
 * A repo heading. Looser than RepoDto because a slug can reach this page from an
 * agent's `repoSlugs` without a repo row behind it — an agent registered against
 * a repo the console has not been pointed at yet still has to be visible.
 */
type RepoGroup = { slug: string; name?: string; defaultBranch?: string };

/** Groups to show, in order: the repo list, plus any slug only agents mention. */
function resolveRepoOrder(repos: RepoDto[], agents: AgentSummary[]): RepoGroup[] {
	const known = new Map<string, RepoGroup>();
	for (const repo of repos) {
		known.set(repo.slug, {
			slug: repo.slug,
			name: repo.name,
			defaultBranch: repo.defaultBranch,
		});
	}

	for (const agent of agents) {
		for (const slug of agent.repoSlugs) {
			if (slug === "*" || known.has(slug)) continue;
			known.set(slug, { slug });
		}
	}
	return [...known.values()];
}

function agentsForRepo(agents: AgentSummary[], repoSlug: string): AgentSummary[] {
	return agents.filter(
		(agent) => agent.repoSlugs.includes(repoSlug) || agent.repoSlugs.includes("*"),
	);
}

export default async function AgentsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const resolvedParams = await searchParams;
	const repos = await fetchRepos();
	const { selectedRepo, staleSelection } = await resolveRepoSelection(repos, resolvedParams.repo);

	// Filtering by slug in the query means an agent declared for `*` is still
	// included, because loadAgentSummaries applies the same rule the grouping
	// below does.
	const agents = await fetchAgents(selectedRepo?.slug);

	const visibleRepos = selectedRepo === undefined ? repos : [selectedRepo];
	const repoOrder = selectedRepo === undefined ? resolveRepoOrder(repos, agents) : visibleRepos;
	const promptOnlyCount = agents.filter(
		(agent) => agent.scopeEnforcement === "prompt-only",
	).length;
	const runnableCount = agents.filter((agent) => agent.runnable).length;
	const weekCostUsd = agents.reduce((sum, agent) => sum + (agent.costUsd7d ?? 0), 0);

	return (
		<div className="flex flex-col gap-8">
			<header className="flex flex-col gap-3">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h1 className="text-xl font-semibold tracking-tight">Agents</h1>
						<p className="text-sm text-default-500">
							{agents.length} registered, {runnableCount} runnable ·{" "}
							{formatCostUsd(weekCostUsd)} over 7 days
						</p>
					</div>

					{selectedRepo ? (
						<Link
							href="/?repo=all"
							className="rounded-medium border border-default-200 px-3 py-2 text-xs text-default-500 transition-colors hover:text-foreground"
						>
							Scoped to <span className="font-mono">{selectedRepo.slug}</span> · show
							all repos
						</Link>
					) : undefined}

					{promptOnlyCount > 0 ? (
						<div className="arnold-unenforced flex items-center gap-2 rounded-medium border border-warning-400 px-3 py-2 text-xs text-warning-600">
							<ShieldAlert className="h-4 w-4 shrink-0" />
							<span>
								{promptOnlyCount} of {agents.length} agent
								{agents.length === 1 ? "" : "s"} enforce their write scope by prompt
								text only.
							</span>
						</div>
					) : undefined}
				</div>
			</header>

			{staleSelection ? (
				<div className="rounded-medium border border-warning-400 px-3 py-2 text-xs text-warning-600">
					No active repo with slug <span className="font-mono">{staleSelection}</span>. It
					may have been archived or removed, so the console is showing every repo instead.
				</div>
			) : undefined}

			{agents.length === 0 ? (
				<EmptyState
					emptyStateTitle="No agents registered"
					emptyStateDescription="Arnold discovers agents by reconciling a repo's .claude directory against the registry. Sync a repo to pick up its commands and subagents."
					emptyStateIcon={<Bot className="h-6 w-6" />}
					emptyStateAction={
						repoOrder[0] ? (
							<RegistrySyncButton registrySyncButtonRepoSlug={repoOrder[0].slug} />
						) : undefined
					}
				/>
			) : undefined}

			{repoOrder.map((repo) => {
				const repoAgents = agentsForRepo(agents, repo.slug);
				if (repoAgents.length === 0) return undefined;

				return (
					<section key={repo.slug} className="flex flex-col gap-3">
						<header className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-2">
							<div className="flex flex-wrap items-baseline gap-2">
								<h2 className="text-base font-semibold">
									{repo.name ?? repo.slug}
								</h2>
								<code className="font-mono text-[11px] text-default-400">
									{repo.slug}
								</code>
								{repo.defaultBranch ? (
									<span className="font-mono text-[11px] text-default-400">
										@ {repo.defaultBranch}
									</span>
								) : undefined}
								<span className="text-[11px] text-default-400">
									{repoAgents.length} agent{repoAgents.length === 1 ? "" : "s"}
								</span>
							</div>
							<RegistrySyncButton registrySyncButtonRepoSlug={repo.slug} />
						</header>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
							{repoAgents.map((agent) => (
								<AgentCard
									key={`${repo.slug}-${agent.id}`}
									agentCardAgent={agent}
									agentCardRepoSlug={repo.slug}
								/>
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}
