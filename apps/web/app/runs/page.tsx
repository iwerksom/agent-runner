/**
 * Purpose: every run, newest first, filterable by status. The Ledger's list view:
 * one compact row per run so a day's activity and its spend fit on one screen.
 *
 * Root runs only (`parent=root`). Child runs belong to their parent's tree on the
 * run detail screen, and mixing a harness's 30 children into this list would bury
 * everything else.
 *
 * The repo switcher narrows this list too, so "what did this repo cost this week"
 * is one selection rather than a filter that only exists on the agents grid.
 *
 * Server component; the filter is a client component that writes to the URL, so a
 * filtered view is linkable and survives a reload.
 */

import { ListOrdered } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { RunStatusFilter } from "@/components/RunStatusFilter";
import { RunTable } from "@/components/RunTable";
import { fetchRepos, fetchRuns } from "@/components/api";
import { formatCostUsd } from "@/components/format";
import { resolveRepoSelection } from "@/lib/repoSelection";
import { RUN_STATUSES, type RunStatus } from "@/components/types";

export const dynamic = "force-dynamic";

function parseStatus(raw: string | string[] | undefined): RunStatus | undefined {
	const candidate = Array.isArray(raw) ? raw[0] : raw;
	if (!candidate) return undefined;
	return (RUN_STATUSES as readonly string[]).includes(candidate)
		? (candidate as RunStatus)
		: undefined;
}

export default async function RunsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const resolved = await searchParams;
	const status = parseStatus(resolved.status);

	const repos = await fetchRepos();
	const { selectedRepo, staleSelection } = await resolveRepoSelection(repos, resolved.repo);

	const runs = await fetchRuns({
		parent: "root",
		limit: 50,
		...(status ? { status } : {}),
		...(selectedRepo ? { repoSlug: selectedRepo.slug } : {}),
	});

	const totalCostUsd = runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
	const counts = runs.reduce<Partial<Record<RunStatus, number>>>((accumulator, run) => {
		accumulator[run.status] = (accumulator[run.status] ?? 0) + 1;
		return accumulator;
	}, {});

	return (
		<div className="flex flex-col gap-5">
			<header className="flex flex-col gap-3">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
							<ListOrdered className="h-5 w-5 text-default-400" />
							Runs
						</h1>
						<p className="text-sm text-default-500">
							{runs.length} root run{runs.length === 1 ? "" : "s"}
							{status ? ` with status ${status}` : ""}
							{selectedRepo ? ` in ${selectedRepo.name}` : ""} ·{" "}
							{formatCostUsd(totalCostUsd)}
						</p>
					</div>

					{selectedRepo ? (
						<Link
							href="/runs?repo=all"
							className="rounded-medium border border-default-200 px-3 py-2 text-xs text-default-500 transition-colors hover:text-foreground"
						>
							Scoped to <span className="font-mono">{selectedRepo.slug}</span> · show
							all repos
						</Link>
					) : undefined}
				</div>

				{staleSelection ? (
					<div className="rounded-medium border border-warning-400 px-3 py-2 text-xs text-warning-600">
						No active repo with slug <span className="font-mono">{staleSelection}</span>
						. It may have been archived or removed, so every repo&apos;s runs are shown.
					</div>
				) : undefined}

				<RunStatusFilter
					runStatusFilterActive={status}
					// Counts describe the loaded page, so they are only shown when the
					// list is unfiltered and the page is therefore a fair sample.
					runStatusFilterCounts={status ? undefined : counts}
				/>
			</header>

			{runs.length === 0 ? (
				<EmptyState
					emptyStateTitle={status ? `No ${status} runs` : "No runs yet"}
					emptyStateDescription={
						status
							? "Nothing in the most recent runs matches this status. Clear the filter to see everything."
							: "Trigger an agent from the agents grid and its run will appear here."
					}
					emptyStateIcon={<ListOrdered className="h-6 w-6" />}
				/>
			) : (
				<div className="rounded-large border border-default-200 bg-content1 p-1">
					<RunTable
						runTableRuns={runs}
						runTableShowOutcome
						runTableAriaLabel="All runs"
					/>
				</div>
			)}

			<p className="text-[11px] text-default-400">
				Newest first, capped at 50. Child runs are shown inside their parent&apos;s run
				tree.
			</p>
		</div>
	);
}
