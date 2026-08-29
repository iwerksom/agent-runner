"use client";

/*
 * Client component on purpose, same reason as AgentManifestPanel: HeroUI's Table
 * uses React Aria's collection builder, which cannot walk children created in a
 * Server Component. All props here are serialisable.
 */

/**
 * Purpose: the compact run list, shared by /runs and by an agent's run history.
 * One row per run: status, what it was, what came out of it, and what it cost.
 *
 * Outcome and reason code are optional columns because they only make sense next
 * to a single agent's vocabulary — work-order-scoper emits `too-large` where
 * plan-week emits `too-large-to-split`, and mixing both under one header would
 * imply they are the same code. Columns are therefore built per call site.
 *
 * Rows are rendered as element arrays rather than through HeroUI's render-function
 * collection API, because this is a server component and a function cannot cross
 * the server/client boundary as a prop. Every cell is a link or a formatted value,
 * so there is nothing here that needs a client bundle.
 */

import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/react";
import { GitFork, Paperclip } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ReasonCodeChip, RunStatusChip } from "@/components/badges";
import { RelativeTime } from "@/components/RelativeTime";
import { formatCostUsd, formatDuration, formatTokens } from "@/components/format";
import type { RunSummary } from "@/components/types";

type RunColumn = { key: string; label: string; numeric?: boolean };

export function RunTable({
	runTableRuns,
	runTableShowAgent = true,
	runTableShowRepo = true,
	runTableShowOutcome = false,
	runTableAriaLabel = "Runs",
	runTableEmptyContent = "No runs yet.",
}: {
	runTableRuns: RunSummary[];
	runTableShowAgent?: boolean;
	runTableShowRepo?: boolean;
	runTableShowOutcome?: boolean;
	runTableAriaLabel?: string;
	runTableEmptyContent?: string;
}) {
	const columns: RunColumn[] = [
		{ key: "status", label: "Status" },
		{ key: "run", label: "Run" },
		...(runTableShowAgent ? [{ key: "agent", label: "Agent" }] : []),
		...(runTableShowRepo ? [{ key: "repo", label: "Repo" }] : []),
		...(runTableShowOutcome
			? [
					{ key: "outcome", label: "Outcome" },
					{ key: "reason", label: "Reason code" },
				]
			: []),
		{ key: "cost", label: "Cost", numeric: true },
		{ key: "tokens", label: "Tokens", numeric: true },
		{ key: "turns", label: "Turns", numeric: true },
		{ key: "duration", label: "Duration", numeric: true },
		{ key: "started", label: "Started" },
		{ key: "tree", label: "Tree" },
	];

	function renderCell(run: RunSummary, columnKey: string): ReactNode {
		const firstOutcome = run.outcomes[0];

		switch (columnKey) {
			case "status":
				return <RunStatusChip runStatus={run.status} />;

			case "run":
				return (
					<Link href={`/runs/${run.id}`} className="flex flex-col hover:text-primary">
						<span className="font-medium text-foreground">
							{run.label ?? run.agentName}
						</span>
						<span className="font-mono text-[10px] text-default-400">{run.id}</span>
					</Link>
				);

			case "agent":
				return (
					<Link
						href={`/agents/${run.agentId}`}
						className="font-mono text-[11px] text-default-600 hover:text-primary"
					>
						{run.agentId}
					</Link>
				);

			case "repo":
				return (
					<span className="font-mono text-[11px] text-default-500">
						{run.repoSlug ?? "—"}
					</span>
				);

			case "outcome":
				if (!firstOutcome) return <span className="text-default-400">—</span>;
				// "unparsed" is a pipeline failure, not a result. It reads as danger.
				return (
					<span
						className={
							firstOutcome.outcome === "unparsed"
								? "font-mono text-[11px] font-semibold text-danger"
								: "font-mono text-[11px] text-default-700"
						}
					>
						{firstOutcome.outcome}
					</span>
				);

			case "reason":
				return firstOutcome?.reasonCode ? (
					<ReasonCodeChip reasonCode={firstOutcome.reasonCode} />
				) : (
					<span className="text-default-400">—</span>
				);

			case "cost":
				return <span className="font-mono tabular-nums">{formatCostUsd(run.costUsd)}</span>;

			case "tokens":
				return (
					<span className="font-mono tabular-nums text-default-500">
						{formatTokens(run.tokens)}
					</span>
				);

			case "turns":
				return (
					<span className="font-mono tabular-nums text-default-500">{run.numTurns}</span>
				);

			case "duration":
				return (
					<span className="font-mono tabular-nums text-default-500">
						{formatDuration(run.durationMs)}
					</span>
				);

			case "started":
				return (
					<RelativeTime
						relativeTimeIso={run.startedAt ?? run.createdAt}
						relativeTimeClassName="text-default-500"
					/>
				);

			case "tree":
				if (run.childCount === 0 && run.artifactCount === 0) {
					return <span className="text-default-400">—</span>;
				}
				return (
					<span className="flex items-center gap-2 text-default-400">
						{run.childCount > 0 ? (
							<span
								className="flex items-center gap-1"
								title={`${run.childCount} child runs`}
							>
								<GitFork className="h-3.5 w-3.5" />
								{run.childCount}
							</span>
						) : undefined}
						{run.artifactCount > 0 ? (
							<span
								className="flex items-center gap-1"
								title={`${run.artifactCount} artifacts`}
							>
								<Paperclip className="h-3.5 w-3.5" />
								{run.artifactCount}
							</span>
						) : undefined}
					</span>
				);

			default:
				return undefined;
		}
	}

	return (
		<Table
			aria-label={runTableAriaLabel}
			removeWrapper
			classNames={{
				th: "bg-content2 text-[10px] uppercase tracking-wider text-default-500",
				td: "border-b border-divider/60 py-2 text-xs align-middle",
			}}
		>
			<TableHeader>
				{columns.map((column) => (
					<TableColumn key={column.key} align={column.numeric ? "end" : "start"}>
						{column.label}
					</TableColumn>
				))}
			</TableHeader>

			<TableBody emptyContent={runTableEmptyContent}>
				{runTableRuns.map((run) => (
					<TableRow key={run.id}>
						{columns.map((column) => (
							<TableCell key={column.key}>{renderCell(run, column.key)}</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
