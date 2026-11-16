/**
 * Purpose: the run screen's header. Identity (agent, label, repo), the live
 * status, and the four numbers the Ledger cares about — duration, cost, tokens,
 * turns — plus the cancel control, which exists only while the run can still be
 * stopped.
 *
 * Client component because the status arrives over SSE and the elapsed time
 * ticks: a running agent with a frozen duration reads as a hung one.
 */

"use client";

import { Button, Chip } from "@heroui/react";
import { CircleStop, Clock, CircleDollarSign, Hash, Repeat2, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { RunStatusChip } from "@/components/badges";
import { RelativeTime } from "@/components/RelativeTime";
import { formatCostUsd, formatDuration, formatTokens } from "@/components/format";
import { isTerminalRunStatus, type RunDetail, type RunStatus } from "@/components/types";
import { useCancelRun } from "@/hooks/useCancelRun";

function Metric({
	metricLabel,
	metricValue,
	metricIcon,
}: {
	metricLabel: string;
	metricValue: ReactNode;
	metricIcon: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-default-400">
				{metricIcon}
				{metricLabel}
			</span>
			<span className="font-mono text-sm tabular-nums text-foreground">{metricValue}</span>
		</div>
	);
}

/**
 * Where the cost went, per model and token class (#75). The total alone hid that
 * a $2.61 review was mostly cache reads of a growing conversation plus thinking,
 * which is what made the fix (hand the agent its context, cap effort) obvious.
 * Thinking is inside "output": the SDK does not report it separately.
 */
function RunUsageByClass({ runUsageRows }: { runUsageRows: RunDetail["usageByClass"] }) {
	const header = [
		"Model",
		"Input",
		"Cache read",
		"Cache write",
		"Output (incl. thinking)",
		"Cost",
	];
	return (
		<div className="overflow-x-auto border-t border-divider pt-3">
			<table className="w-full min-w-[480px] text-left font-mono text-[11px] tabular-nums">
				<thead>
					<tr className="text-[10px] uppercase tracking-wider text-default-400">
						{header.map((label) => (
							<th key={label} className="pb-1 pr-3 font-normal">
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody className="text-default-700">
					{runUsageRows.map((row) => (
						<tr key={row.usageModel}>
							<td className="pr-3">{row.usageModel}</td>
							<td className="pr-3">{formatTokens(row.usageInputTokens)}</td>
							<td className="pr-3">{formatTokens(row.usageCacheReadTokens)}</td>
							<td className="pr-3">{formatTokens(row.usageCacheWriteTokens)}</td>
							<td className="pr-3">{formatTokens(row.usageOutputTokens)}</td>
							<td>{formatCostUsd(row.usageCostUsd)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function RunHeader({
	runHeaderRun,
	runHeaderLiveStatus,
}: {
	runHeaderRun: RunDetail;
	runHeaderLiveStatus: RunStatus;
}) {
	const run = runHeaderRun;
	const terminal = isTerminalRunStatus(runHeaderLiveStatus);
	const { cancelRunPending, cancelRunError, cancelRunSucceeded, cancelRunSubmit } = useCancelRun(
		run.id,
	);

	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		if (terminal) return;
		const handle = window.setInterval(() => setNowMs(Date.now()), 1000);
		return () => window.clearInterval(handle);
	}, [terminal]);

	const startedMs = run.startedAt ? new Date(run.startedAt).getTime() : undefined;
	const durationMs =
		run.durationMs ??
		(startedMs !== undefined && !Number.isNaN(startedMs) && !terminal
			? nowMs - startedMs
			: undefined);

	return (
		<header className="flex flex-col gap-4 rounded-large border border-default-200 bg-content1 p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<Link
							href={`/agents/${run.agentId}`}
							className="text-lg font-semibold leading-tight text-foreground hover:text-primary"
						>
							{run.agentName}
						</Link>
						<RunStatusChip runStatus={runHeaderLiveStatus} runStatusSize="md" />
						{run.repoSlug ? (
							<Chip
								size="sm"
								variant="flat"
								classNames={{ content: "font-mono text-[11px]" }}
							>
								{run.repoSlug}
							</Chip>
						) : undefined}
					</div>
					{run.label ? (
						<p className="text-sm text-default-500">{run.label}</p>
					) : undefined}
					<div className="flex flex-wrap items-center gap-2 text-[11px] text-default-400">
						<span className="font-mono">{run.id}</span>
						<span>·</span>
						<span className="flex items-center gap-1">
							<Repeat2 className="h-3.5 w-3.5" />
							{run.trigger}
						</span>
						<span>·</span>
						<RelativeTime
							relativeTimeIso={run.startedAt ?? run.createdAt}
							relativeTimePrefix="started"
						/>
					</div>
				</div>

				{!terminal ? (
					<Button
						size="sm"
						color="danger"
						variant="flat"
						startContent={<CircleStop className="h-4 w-4" />}
						isLoading={cancelRunPending}
						isDisabled={cancelRunSucceeded}
						onPress={() => void cancelRunSubmit()}
					>
						{cancelRunSucceeded ? "Cancelling…" : "Cancel run"}
					</Button>
				) : undefined}
			</div>

			{cancelRunError ? (
				<p className="rounded-medium border border-danger-400 bg-danger-50/10 px-3 py-2 font-mono text-[11px] text-danger">
					{cancelRunError}
				</p>
			) : undefined}

			<div
				className="grid grid-cols-2 gap-4 border-t border-divider pt-3 sm:grid-cols-4"
				suppressHydrationWarning
			>
				<Metric
					metricLabel="Duration"
					metricIcon={<Clock className="h-3 w-3" />}
					metricValue={formatDuration(durationMs)}
				/>
				<Metric
					metricLabel="Cost"
					metricIcon={<CircleDollarSign className="h-3 w-3" />}
					metricValue={formatCostUsd(run.costUsd)}
				/>
				<Metric
					metricLabel="Tokens"
					metricIcon={<Zap className="h-3 w-3" />}
					metricValue={formatTokens(run.tokens)}
				/>
				<Metric
					metricLabel="Turns"
					metricIcon={<Hash className="h-3 w-3" />}
					metricValue={`${run.numTurns} / ${run.agent.budget?.maxTurns ?? "—"}`}
				/>
			</div>

			{run.usageByClass.length > 0 ? (
				<RunUsageByClass runUsageRows={run.usageByClass} />
			) : undefined}

			{run.exitReason && terminal ? (
				<p className="text-xs text-default-500">
					Exit reason:{" "}
					<span className="font-mono text-default-700">{run.exitReason}</span>
				</p>
			) : undefined}
		</header>
	);
}
