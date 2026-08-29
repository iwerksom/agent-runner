/**
 * Purpose: the run tree under one parent. A harness fans out a batch and a
 * command spawns subagents; both land here as child runs, each with its own
 * status, outcome and cost.
 *
 * Rendered as a nested list rather than another table because the parent's own
 * cost is the sum of these plus its own turns, and the indentation is what makes
 * that readable. The rolled-up total is shown in the header so an expensive
 * fan-out is visible without opening every child.
 */

import { GitFork } from "lucide-react";
import Link from "next/link";
import { ReasonCodeChip, RunStatusChip } from "@/components/badges";
import { RelativeTime } from "@/components/RelativeTime";
import { formatCostUsd, formatDuration } from "@/components/format";
import type { RunSummary } from "@/components/types";

export function RunChildren({
	runChildrenRuns,
	runChildrenExpectedCount,
}: {
	runChildrenRuns: RunSummary[];
	/** From the parent's childCount, which can lead the loaded children mid-fan-out. */
	runChildrenExpectedCount: number;
}) {
	const totalCostUsd = runChildrenRuns.reduce((sum, child) => sum + (child.costUsd ?? 0), 0);
	const missing = Math.max(0, runChildrenExpectedCount - runChildrenRuns.length);

	return (
		<section className="rounded-large border border-default-200 bg-content1">
			<header className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-2.5">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					<GitFork className="h-4 w-4 text-default-400" />
					Child runs
					<span className="text-xs font-normal text-default-400">
						{runChildrenRuns.length} of {runChildrenExpectedCount}
					</span>
				</h2>
				<span className="font-mono text-xs tabular-nums text-default-500">
					{formatCostUsd(totalCostUsd)} in children
				</span>
			</header>

			<ul className="flex flex-col">
				{runChildrenRuns.map((child) => {
					const firstOutcome = child.outcomes[0];
					return (
						<li
							key={child.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-divider/60 py-2.5 pl-8 pr-4 last:border-b-0"
						>
							{/* Short rail: makes the parent/child relation visible without a table. */}
							<span
								aria-hidden
								className="-ml-4 mr-1 h-3 w-3 self-center rounded-bl border-b border-l border-default-300"
							/>
							<RunStatusChip runStatus={child.status} />

							<Link
								href={`/runs/${child.id}`}
								className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary"
							>
								{child.label ?? child.agentName}
								<span className="ml-2 font-mono text-[10px] text-default-400">
									{child.id}
								</span>
							</Link>

							{firstOutcome ? (
								<span
									className={`font-mono text-[11px] ${
										firstOutcome.outcome === "unparsed"
											? "font-semibold text-danger"
											: "text-default-600"
									}`}
								>
									{firstOutcome.outcome}
								</span>
							) : undefined}
							{firstOutcome?.reasonCode ? (
								<ReasonCodeChip reasonCode={firstOutcome.reasonCode} />
							) : undefined}

							<span className="font-mono text-xs tabular-nums text-default-700">
								{formatCostUsd(child.costUsd)}
							</span>
							<span className="w-16 text-right font-mono text-[11px] tabular-nums text-default-400">
								{formatDuration(child.durationMs)}
							</span>
							<RelativeTime
								relativeTimeIso={child.startedAt ?? child.createdAt}
								relativeTimeClassName="w-20 text-right text-[11px] text-default-400"
							/>
						</li>
					);
				})}

				{missing > 0 ? (
					<li className="px-4 py-2.5 pl-8 text-xs text-default-400">
						{missing} more child run{missing === 1 ? "" : "s"} recorded but not returned
						with this payload — reload once the fan-out settles.
					</li>
				) : undefined}
			</ul>
		</section>
	);
}
